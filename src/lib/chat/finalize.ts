import type { Prisma } from "@prisma/client";
import type { Scale } from "@/lib/cards/schemas";
import type { NarratorMeta } from "@/lib/prompts/narrator";
import { WorldModeSchema, type WorldMode } from "@/lib/world-mode";
import { FrozenRealityError, parseGenerationRequestMeta, type GenerationRequestMeta } from "./request";
import {
  revealAbilityInTransaction,
  type AbilityMutationTx,
} from "@/lib/abilities/mutations";

export type NarrationFinalizationTx = Omit<AbilityMutationTx, "message" | "ability"> & {
  world: {
    findUnique(args: {
      where: { id: string };
      select: { activeTimelineId: true; mode: true };
    }): Promise<{ activeTimelineId: string | null; mode: WorldMode } | null>;
  };
  generationRequest: {
    findUnique(args: { where: { id: string } }): Promise<unknown>;
    update(args: {
      where: { id: string };
      data: {
        status: string; narratorMessageId: string; resultMeta: Prisma.InputJsonValue;
        error: null; leaseExpiresAt: null;
      };
    }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; status: string; attempt: number };
      data: { leaseExpiresAt: Date };
    }): Promise<{ count: number }>;
  };
  message: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      chapterId: string;
      index?: number;
      role?: string;
      scale: string;
      meta?: unknown;
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  ability: AbilityMutationTx["ability"] & {
    findFirst(args: {
      where: { id: string; timelineId: string };
    }): Promise<({ version: number; rumorText: string | null } &
      Awaited<ReturnType<AbilityMutationTx["ability"]["findUnique"]>>) | null>;
  };
  chronicleEntry: {
    updateMany(args: {
      where: {
        id: { in: string[] };
        timelineId: string;
        revealed: false;
      };
      data: { revealed: true; revealedAtChapter: number };
    }): Promise<unknown>;
  };
};

export type NarrationFinalizationClient = {
  $transaction<T>(operation: (tx: NarrationFinalizationTx) => Promise<T>): Promise<T>;
};

export async function finalizeNarration(
  client: NarrationFinalizationClient,
  input: {
    generationId: string;
    chapterId: string;
    chapterIndex: number;
    timelineId: string;
    worldId: string;
    expectedActiveTimelineId: string;
    narratorIndex: number;
    attempt?: number;
    requestMeta?: GenerationRequestMeta;
    prose: string;
    meta: NarratorMeta;
    scale: Scale;
    signal?: AbortSignal;
    logInvalidReveal?: (details: { abilityId: string; generationId: string }) => void;
  },
): Promise<{ messageId: string; reused: boolean }> {
  const checkCancelled = () => input.signal?.throwIfAborted();
  checkCancelled();
  return client.$transaction(async (tx) => {
    checkCancelled();
    const world = await tx.world.findUnique({
      where: { id: input.worldId },
      select: { activeTimelineId: true, mode: true },
    });
    if (!world || world.activeTimelineId !== input.expectedActiveTimelineId ||
        input.timelineId !== input.expectedActiveTimelineId) {
      throw new FrozenRealityError();
    }
    const worldMode = WorldModeSchema.parse(world.mode);
    if (input.attempt !== undefined) {
      const owned = await tx.generationRequest.updateMany({
        where: { id: input.generationId, status: "pending", attempt: input.attempt },
        data: { leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) },
      });
      if (owned.count !== 1) throw new Error("叙事生成 lease 已被接管");
    }
    const existing = await tx.message.findUnique({
      where: { id: input.generationId },
    });
    if (existing) {
      const request = parseGenerationRequestMeta(existing.meta);
      if (
        existing.chapterId !== input.chapterId || existing.scale !== input.scale ||
        existing.role !== "narrator" || existing.index !== input.narratorIndex ||
        !request || request.narratorMessageId !== input.generationId ||
        request.playerMessageId !== (input.requestMeta?.playerMessageId ?? null)
      ) {
        throw new Error("generationId 已被其他叙事请求占用");
      }
      return { messageId: existing.id, reused: true };
    }

    const saved = await tx.message.create({
      data: {
        id: input.generationId,
        chapterId: input.chapterId,
        index: input.narratorIndex,
        role: "narrator",
        content: input.prose,
        scale: input.scale,
        variants: [{ content: input.prose, meta: input.meta, chosen: true }] as Prisma.InputJsonValue,
        meta: {
          ...input.meta,
          ...(input.requestMeta ? { generationRequest: input.requestMeta } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    checkCancelled();

    const reveals = new Map<string, NonNullable<NarratorMeta["abilityReveals"]>[number]>();
    for (const reveal of input.meta.abilityReveals ?? []) {
      const existingReveal = reveals.get(reveal.abilityId);
      if (!existingReveal || reveal.visibility === "known") {
        reveals.set(reveal.abilityId, reveal);
      }
    }
    const visibilityRank = { hidden: 0, rumored: 1, known: 2 } as const;
    for (const reveal of reveals.values()) {
      checkCancelled();
      const ability = await tx.ability.findFirst({
        where: { id: reveal.abilityId, timelineId: input.timelineId },
      });
      if (!ability) {
        input.logInvalidReveal?.({ abilityId: reveal.abilityId, generationId: input.generationId });
        continue;
      }
      const currentVisibility = ability.visibility as keyof typeof visibilityRank;
      if (visibilityRank[currentVisibility] >= visibilityRank[reveal.visibility]) continue;
      await revealAbilityInTransaction(tx, {
        abilityId: ability.id,
        version: ability.version,
        visibility: reveal.visibility,
        ...(reveal.visibility === "rumored"
          ? { rumorText: ability.rumorText ?? reveal.evidence }
          : {}),
        event: {
          chapterId: input.chapterId,
          messageId: saved.id,
          evidence: reveal.evidence,
          scale: input.scale,
          dedupeKey: `narrator-reveal:${input.generationId}:${ability.id}:${reveal.visibility}`,
        },
      });
      checkCancelled();
    }

    checkCancelled();
    if (worldMode !== "creator" && input.meta.revealedEventIds?.length) {
      await tx.chronicleEntry.updateMany({
        where: {
          id: { in: input.meta.revealedEventIds },
          timelineId: input.timelineId,
          revealed: false,
        },
        data: { revealed: true, revealedAtChapter: input.chapterIndex },
      });
    }
    checkCancelled();

    await tx.generationRequest.update({
      where: { id: input.generationId },
      data: {
        status: "completed",
        error: null,
        leaseExpiresAt: null,
        narratorMessageId: saved.id,
        resultMeta: input.meta as unknown as Prisma.InputJsonValue,
      },
    });
    checkCancelled();

    return { messageId: saved.id, reused: false };
  });
}
