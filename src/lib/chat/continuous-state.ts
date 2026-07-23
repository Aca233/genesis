import type { Prisma, PrismaClient } from "@prisma/client";
import type { ImmediateChange } from "./continuous-meta";

export type TemporalState = {
  era: string;
  time: string;
};

export function mergeTemporalState(
  current: TemporalState,
  patch?: { era?: string; time?: string },
): TemporalState {
  return {
    era: patch?.era?.trim() || current.era,
    time: patch?.time?.trim() || current.time,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveTemporalState(input: {
  realityState: unknown;
  observerState: unknown;
  epochName?: string | null;
  yearLabel?: string | null;
  latestChronicleTime?: string | null;
  eraSystem?: string | null;
}): TemporalState {
  const reality = record(input.realityState);
  const observer = record(input.observerState);
  const storedEra = nonEmpty(reality.currentEra);
  const storedTime = nonEmpty(observer.timeLabel);
  return {
    era: storedEra
      ?? nonEmpty(input.epochName)
      ?? nonEmpty(input.eraSystem)
      ?? "未名纪元",
    time: storedTime
      ?? nonEmpty(input.latestChronicleTime)
      ?? nonEmpty(input.yearLabel)
      ?? "此刻",
  };
}

const SECTION_KEYS: Record<string, ReadonlySet<string>> = {
  faction: new Set(["overview", "territory", "polity", "faith", "keyFigures", "military"]),
  character: new Set([
    "overview", "identity", "affiliation", "lifespan", "personality",
    "faithHistory", "relationToPlayer",
  ]),
  race: new Set(["overview", "lifespan", "distribution", "divineTies", "innerFactions"]),
  place: new Set(["overview", "kind", "allegiance", "geography", "majorEvents"]),
  artifact: new Set(["overview", "kind", "holder", "powers", "origin", "whereabouts"]),
  cult: new Set(["overview", "deity", "doctrine", "holySites", "structure", "heresies", "secularTies"]),
};

type ContinuousStateTx = Prisma.TransactionClient;

export type ApplyContinuousStateInput = {
  worldId: string;
  timelineId: string;
  temporalPatch?: { era?: string; time?: string };
  changes?: readonly ImmediateChange[];
};

async function requireEntity(
  tx: ContinuousStateTx,
  timelineId: string,
  entityId: string,
) {
  const entity = await tx.entity.findFirst({
    where: { id: entityId, timelineId },
    include: { sections: true },
  });
  if (!entity) throw new Error("轻变化目标不属于当前现实");
  return entity;
}

export async function applyContinuousStateInTransaction(
  tx: ContinuousStateTx,
  input: ApplyContinuousStateInput,
): Promise<TemporalState> {
  const world = await tx.world.findUnique({
    where: { id: input.worldId },
    select: { activeTimelineId: true },
  });
  if (world?.activeTimelineId !== input.timelineId) {
    throw new Error("该现实已被冻结");
  }
  const timeline = await tx.timeline.findUnique({
    where: { id: input.timelineId },
    select: { realityState: true, observerState: true },
  });
  if (!timeline) throw new Error("活动现实不存在");

  const reality = record(timeline.realityState);
  const observer = record(timeline.observerState);
  const current = resolveTemporalState({
    realityState: reality,
    observerState: observer,
  });
  const temporal = mergeTemporalState(current, input.temporalPatch);
  const nextReality = { ...reality, currentEra: temporal.era };
  let nextObserver = { ...observer, timeLabel: temporal.time };

  for (const change of input.changes ?? []) {
    if (change.kind === "set_scene_presence") {
      await requireEntity(tx, input.timelineId, change.entityId);
      await tx.entity.update({
        where: { id: change.entityId },
        data: { scenePresence: change.present },
      });
      continue;
    }

    if (change.kind === "set_active_avatar") {
      if (change.entityId !== null) {
        const avatar = await requireEntity(tx, input.timelineId, change.entityId);
        if (!avatar.isCreatorAvatar) throw new Error("轻变化目标不是当前现实化身");
      }
      nextObserver = { ...nextObserver, activeAvatarId: change.entityId };
      continue;
    }

    if (change.kind === "set_observer_focus") {
      if (change.focusType === "world") {
        if (change.focusId !== null) throw new Error("世界焦点不能带目标 ID");
      } else if (change.focusType === "god") {
        const god = change.focusId
          ? await tx.god.findFirst({
              where: { id: change.focusId, timelineId: input.timelineId },
              select: { id: true },
            })
          : null;
        if (!god) throw new Error("轻变化目标不属于当前现实");
      } else {
        if (!change.focusId) throw new Error("实体焦点缺少目标 ID");
        const entity = await requireEntity(tx, input.timelineId, change.focusId);
        if (change.focusType === "place" && entity.type !== "place") {
          throw new Error("观察焦点类型不匹配");
        }
        if (change.focusType === "avatar" && !entity.isCreatorAvatar) {
          throw new Error("观察焦点类型不匹配");
        }
      }
      nextObserver = {
        ...nextObserver,
        focusType: change.focusType,
        focusId: change.focusId,
      };
      continue;
    }

    const entity = await requireEntity(tx, input.timelineId, change.entityId);
    if (!SECTION_KEYS[entity.type]?.has(change.key)) {
      throw new Error("轻变化栏目不适用于目标实体");
    }
    const section = entity.sections.find((item) => item.key === change.key);
    if (!section || section.playerLocked) {
      throw new Error("轻变化栏目不存在或已由玩家锁定");
    }
    const previous = record(section.content);
    await tx.entitySection.update({
      where: { id: section.id },
      data: {
        content: {
          ...previous,
          text: change.content,
        } as Prisma.InputJsonValue,
      },
    });
  }

  await tx.timeline.update({
    where: { id: input.timelineId },
    data: {
      realityState: nextReality as Prisma.InputJsonValue,
      observerState: nextObserver as Prisma.InputJsonValue,
    },
  });
  return temporal;
}

export async function applyContinuousState(
  client: PrismaClient,
  input: ApplyContinuousStateInput,
): Promise<TemporalState> {
  return client.$transaction((tx) => applyContinuousStateInTransaction(tx, input));
}

