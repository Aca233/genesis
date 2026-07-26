import type { Prisma } from "@prisma/client";
import type { Scale } from "@/lib/cards/schemas";
import type { NarratorMeta } from "@/lib/prompts/narrator";
import { WorldModeSchema, type WorldMode } from "@/lib/world-mode";
import { applyContinuousStateInTransaction } from "./continuous-state";
import { decideSettlement } from "./settlement-policy";
import type { GenerationCompletion, StoredGenerationResult } from "./follow-up";
import {
  createRealityRewriteInTransaction,
} from "@/lib/reality/create-task";
import {
  FrozenRealityError,
  parseGenerationRequestMeta,
  type GenerationRequestMeta,
  type StoredNarratorOutput,
} from "./request";
import {
  revealAbilityInTransaction,
  type AbilityMutationTx,
} from "@/lib/abilities/mutations";
import {
  applyWorldActivityInTransaction,
  type WorldActivityApplyTx,
} from "@/lib/world-activity/apply";

export type NarrationFinalizationTx = Omit<AbilityMutationTx, "message" | "ability">
  & WorldActivityApplyTx & {
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
        stage: string; stageUpdatedAt: Date; error: null; safeError: null;
        retryable: boolean; leaseExpiresAt: null;
      };
    }): Promise<unknown>;
    updateMany(args: {
      where: {
        id: string;
        status: string;
        attempt: number;
        stage: { in: string[] };
      };
      data: { stage: string; stageUpdatedAt: Date; leaseExpiresAt: Date };
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
    update(args: {
      where: { id: string };
      data: { meta: Prisma.InputJsonValue };
    }): Promise<unknown>;
    count(args: {
      where: { chapterId: string; role: string };
    }): Promise<number>;
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
  omenQueue: {
    updateMany(args: {
      where: { id: { in: string[] }; consumed: false };
      data: { consumed: true };
    }): Promise<unknown>;
  };
  realityRewrite: {
    findUnique(args: { where: { idempotencyKey: string } }): Promise<{
      id: string;
      worldId: string;
      sourceTimelineId: string;
      sourceChapterId: string;
      decree: string;
      scope: string;
      status: string;
    } | null>;
    create(args: { data: Record<string, unknown> }): Promise<{
      id: string;
      worldId: string;
      sourceTimelineId: string;
      sourceChapterId: string;
      decree: string;
      scope: string;
      status: string;
    }>;
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
    allowedEventIds?: readonly string[];
    /** 本轮上下文注入的征兆 id；叙事成功落库后才标记消费（两阶段消费） */
    consumedOmenIds?: readonly string[];
    logInvalidReveal?: (details: { abilityId: string; generationId: string }) => void;
  },
): Promise<GenerationCompletion & { reused: boolean }> {
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
        where: {
          id: input.generationId,
          status: "pending",
          attempt: input.attempt,
          stage: { in: ["output_stored", "applying"] },
        },
        data: {
          stage: "applying",
          stageUpdatedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
      if (owned.count !== 1) throw new Error("叙事生成 lease 已被接管");
    }

    if (
      input.meta.operation === "retroactive_rewrite"
      && worldMode === "creator"
    ) {
      const decree = input.requestMeta?.content?.trim();
      if (!decree) throw new Error("追溯改写缺少原始创世主意图");
      const { task } = await createRealityRewriteInTransaction(tx as never, {
        worldId: input.worldId,
        sourceTimelineId: input.timelineId,
        sourceChapterId: input.chapterId,
        decree,
        scope: "retroactive",
        idempotencyKey: `chat:${input.generationId}`,
      });
      const completion: StoredGenerationResult = {
        version: 1,
        messageId: null,
        meta: input.meta,
        followUp: { kind: "rewrite", taskId: task.id },
      };
      await tx.generationRequest.update({
        where: { id: input.generationId },
        data: {
          status: "completed",
          stage: "completed",
          stageUpdatedAt: new Date(),
          error: null,
          safeError: null,
          retryable: true,
          leaseExpiresAt: null,
          narratorMessageId: input.generationId,
          resultMeta: completion as unknown as Prisma.InputJsonValue,
        },
      });
      return { ...completion, reused: false };
    }
    const effectiveMeta = worldMode === "pantheon"
      && input.meta.operation === "retroactive_rewrite"
      ? { ...input.meta, operation: "continue" as const }
      : input.meta;
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
      return {
        messageId: existing.id,
        meta: input.meta,
        followUp: { kind: "none" },
        reused: true,
      };
    }

    if (
      input.requestMeta?.playerMessageId
      && input.requestMeta.playerIndex !== null
    ) {
      const existingPlayer = await tx.message.findUnique({
        where: { id: input.requestMeta.playerMessageId },
      });
      if (!existingPlayer) {
        await tx.message.create({
          data: {
            id: input.requestMeta.playerMessageId,
            chapterId: input.chapterId,
            index: input.requestMeta.playerIndex,
            role: "player",
            content: input.requestMeta.content,
            scale: input.scale,
            meta: {
              generationRequest: input.requestMeta,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (effectiveMeta.temporalState || effectiveMeta.immediateChanges.length > 0) {
      await applyContinuousStateInTransaction(tx as never, {
        worldId: input.worldId,
        timelineId: input.timelineId,
        temporalPatch: effectiveMeta.temporalState,
        changes: effectiveMeta.immediateChanges,
      });
    }
    const narratorCountBefore = await tx.message.count({
      where: { chapterId: input.chapterId, role: "narrator" },
    });
    const temporalChanged = effectiveMeta.temporalState !== undefined;
    const settlement = decideSettlement({
      scale: input.scale,
      narratorCountAfter: narratorCountBefore + 1,
      temporalChanged,
      eraChanged: effectiveMeta.temporalState?.era !== undefined,
      significantEvent: effectiveMeta.significantEvent,
      settlementReasons: effectiveMeta.settlementReasons,
    });
    if (
      effectiveMeta.significantEvent
      && effectiveMeta.settlementReasons.length === 0
      && !settlement.required
    ) {
      console.warn("significant_event 被忽略：缺少 settlement_reasons", {
        generationId: input.generationId,
      });
    }
    const followUp = settlement.required
      ? { kind: "settlement" as const, segmentId: input.chapterId }
      : { kind: "none" as const };

    const saved = await tx.message.create({
      data: {
        id: input.generationId,
        chapterId: input.chapterId,
        index: input.narratorIndex,
        role: "narrator",
        content: input.prose,
        scale: input.scale,
        variants: [{ content: input.prose, meta: effectiveMeta, chosen: true }] as Prisma.InputJsonValue,
        meta: {
          ...effectiveMeta,
          settlementRequired: settlement.required,
          settlementReasons: settlement.reasons,
          ...(input.requestMeta ? { generationRequest: input.requestMeta } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    checkCancelled();

    // 两阶段消费：叙事消息成功落库后才把注入过的征兆标记为已消费。
    if (input.consumedOmenIds?.length) {
      await tx.omenQueue.updateMany({
        where: { id: { in: [...input.consumedOmenIds] }, consumed: false },
        data: { consumed: true },
      });
    }
    checkCancelled();

    const activityApply = await applyWorldActivityInTransaction(tx, {
      timelineId: input.timelineId,
      generationId: input.generationId,
      sourceMessageId: saved.id,
      meta: effectiveMeta,
      allowedEventIds: input.allowedEventIds,
    });
    await tx.message.update({
      where: { id: saved.id },
      data: {
        meta: {
          ...effectiveMeta,
          activityApply,
          settlementRequired: settlement.required,
          settlementReasons: settlement.reasons,
          ...(input.requestMeta ? { generationRequest: input.requestMeta } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    checkCancelled();

    const reveals = new Map<string, NonNullable<NarratorMeta["abilityReveals"]>[number]>();
    for (const reveal of effectiveMeta.abilityReveals ?? []) {
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
    if (worldMode !== "creator" && effectiveMeta.revealedEventIds?.length) {
      await tx.chronicleEntry.updateMany({
        where: {
          id: { in: effectiveMeta.revealedEventIds },
          timelineId: input.timelineId,
          revealed: false,
        },
        data: { revealed: true, revealedAtChapter: input.chapterIndex },
      });
    }
    checkCancelled();

    const completion: StoredGenerationResult = {
      version: 1,
      messageId: saved.id,
      meta: effectiveMeta,
      followUp,
    };
    await tx.generationRequest.update({
      where: { id: input.generationId },
      data: {
        status: "completed",
        stage: "completed",
        stageUpdatedAt: new Date(),
        error: null,
        safeError: null,
        retryable: true,
        leaseExpiresAt: null,
        narratorMessageId: saved.id,
        resultMeta: completion as unknown as Prisma.InputJsonValue,
      },
    });
    checkCancelled();

    return { ...completion, reused: false };
  });
}

export async function applyStoredNarration(
  client: NarrationFinalizationClient,
  input: Omit<Parameters<typeof finalizeNarration>[1], "prose" | "meta"> & {
    output: StoredNarratorOutput;
  },
) {
  const { output, ...rest } = input;
  return finalizeNarration(client, {
    ...rest,
    prose: output.prose,
    meta: output.parsedMeta,
  });
}
