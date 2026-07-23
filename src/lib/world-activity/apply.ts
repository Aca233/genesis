import type { WorldActivityMeta } from "./contracts";

type TimelineActivitySnapshot = {
  id: string;
  realityState: unknown;
  observerState: unknown;
  gods: { id: string }[];
  entities: { id: string }[];
  worldEvents: {
    id: string;
    timelineId: string;
    kind: string;
    phase: string;
    resolvedAt: Date | null;
  }[];
};

export type WorldActivityApplyTx = {
  timeline: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        realityState: true;
        observerState: true;
        gods: { select: { id: true } };
        entities: { select: { id: true } };
        worldEvents: {
          where: { resolvedAt: null };
          select: {
            id: true;
            timelineId: true;
            kind: true;
            phase: true;
            resolvedAt: true;
          };
        };
      };
    }): Promise<TimelineActivitySnapshot | null>;
  };
  worldActivity: {
    findUnique(args: { where: { id: string } }): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  worldEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export type WorldActivityApplyResult = {
  acceptedActions: number;
  rejectedActions: number;
  acceptedActivities: number;
  rejectedActivities: number;
  eventMutationAccepted: boolean;
};

export type ApplyWorldActivityInput = {
  timelineId: string;
  generationId: string;
  sourceMessageId: string;
  meta: WorldActivityMeta;
  allowedEventIds?: readonly string[];
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function label(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function everyMember(ids: readonly string[], members: ReadonlySet<string>): boolean {
  return ids.every((id) => members.has(id));
}

async function createOnce(
  tx: WorldActivityApplyTx,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const existing = await tx.worldActivity.findUnique({ where: { id } });
  if (!existing) await tx.worldActivity.create({ data: { id, ...data } });
}

export async function applyWorldActivityInTransaction(
  tx: WorldActivityApplyTx,
  input: ApplyWorldActivityInput,
): Promise<WorldActivityApplyResult> {
  const timeline = await tx.timeline.findUnique({
    where: { id: input.timelineId },
    select: {
      id: true,
      realityState: true,
      observerState: true,
      gods: { select: { id: true } },
      entities: { select: { id: true } },
      worldEvents: {
        where: { resolvedAt: null },
        select: {
          id: true,
          timelineId: true,
          kind: true,
          phase: true,
          resolvedAt: true,
        },
      },
    },
  });
  if (!timeline) throw new Error("活动现实不存在");

  const godIds = new Set(timeline.gods.map((item) => item.id));
  const entityIds = new Set(timeline.entities.map((item) => item.id));
  const memberIds = new Set([...godIds, ...entityIds]);
  const reality = record(timeline.realityState);
  const observer = record(timeline.observerState);
  const eraLabel = label(reality.currentEra, "未名纪元");
  const timeLabel = label(observer.timeLabel, "此刻");
  const common = {
    timelineId: input.timelineId,
    sourceMessageId: input.sourceMessageId,
    eraLabel,
    timeLabel,
  };
  const result: WorldActivityApplyResult = {
    acceptedActions: 0,
    rejectedActions: 0,
    acceptedActivities: 0,
    rejectedActivities: 0,
    eventMutationAccepted: false,
  };

  for (const [index, action] of (input.meta.worldActions ?? []).entries()) {
    const actors = action.actorType === "god" ? godIds : entityIds;
    if (!actors.has(action.actorId) || !everyMember(action.targetIds, memberIds)) {
      result.rejectedActions += 1;
      continue;
    }
    result.acceptedActions += 1;
    await createOnce(tx, `activity:${input.generationId}:action:${index}`, {
      ...common,
      eventId: null,
      recordType: "action",
      kind: action.actorType,
      text: action.action,
      visibility: action.visibility,
      actorId: action.actorId,
      targetIds: action.targetIds,
      subjectIds: [action.actorId, ...action.targetIds],
    });
  }

  const acceptedActivityIds = new Set<string>();
  for (const [index, activity] of (input.meta.activityEntries ?? []).entries()) {
    const id = `activity:${input.generationId}:activity:${index}`;
    if (!everyMember(activity.subjectIds, memberIds)) {
      result.rejectedActivities += 1;
      continue;
    }
    result.acceptedActivities += 1;
    acceptedActivityIds.add(id);
    await createOnce(tx, id, {
      ...common,
      eventId: null,
      recordType: "activity",
      kind: activity.kind,
      text: activity.text,
      visibility: activity.visibility,
      actorId: null,
      targetIds: [],
      subjectIds: activity.subjectIds,
    });
  }

  const mutation = input.meta.importantEventMutation;
  if (!mutation) return result;
  const progressId = `activity:${input.generationId}:event:0`;
  if (await tx.worldActivity.findUnique({ where: { id: progressId } })) {
    result.eventMutationAccepted = true;
    return result;
  }
  if (!everyMember(mutation.participantIds, memberIds)) return result;

  let eventId: string;
  let eventKind: string;
  if (mutation.operation === "create") {
    if (
      mutation.originActivityId !== undefined
      && !acceptedActivityIds.has(mutation.originActivityId)
    ) {
      return result;
    }
    eventId = `event:${input.generationId}:0`;
    eventKind = mutation.kind;
    await tx.worldEvent.create({
      data: {
        id: eventId,
        timelineId: input.timelineId,
        kind: mutation.kind,
        title: mutation.title,
        summary: mutation.summary,
        phase: mutation.phase,
        visibility: mutation.visibility,
        participantIds: mutation.participantIds,
        originMessageId: input.sourceMessageId,
        originActivityId: mutation.originActivityId ?? null,
        latestMessageId: input.sourceMessageId,
        parentEventId: null,
        resolvedAt: null,
      },
    });
  } else {
    const allowed = new Set(input.allowedEventIds ?? []);
    const event = timeline.worldEvents.find((item) =>
      item.id === mutation.eventId
      && item.timelineId === input.timelineId
      && item.resolvedAt === null);
    if (!event || !allowed.has(mutation.eventId)) return result;
    eventId = event.id;
    eventKind = event.kind;
    await tx.worldEvent.update({
      where: { id: event.id },
      data: {
        phase: mutation.phase,
        summary: mutation.summary,
        visibility: mutation.visibility,
        participantIds: mutation.participantIds,
        latestMessageId: input.sourceMessageId,
        resolvedAt: mutation.phase === "resolved" ? new Date() : null,
      },
    });
  }

  await tx.worldActivity.create({
    data: {
      id: progressId,
      ...common,
      eventId,
      recordType: "event_progress",
      kind: eventKind,
      text: mutation.progressText,
      visibility: mutation.visibility,
      actorId: null,
      targetIds: [],
      subjectIds: mutation.participantIds,
    },
  });
  result.eventMutationAccepted = true;
  return result;
}
