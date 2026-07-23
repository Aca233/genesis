import type {
  SettlementEventMutation,
  SettlementWorldActivity,
} from "@/lib/prompts/settlement";

type IdentifierSet = readonly string[] | ReadonlySet<string>;

export type SettlementKnownIds = {
  activityIds: IdentifierSet;
  eventIds: IdentifierSet;
  participantIds: IdentifierSet;
};

export type NormalizedSettlementActivity = {
  mergedActivities: string[];
  eventMutations: SettlementEventMutation[];
};

export type SettlementActivityRow = {
  id: string;
  timelineId: string;
  eventId: string | null;
  recordType: string;
  kind: string;
  text: string;
  visibility: string;
  actorId: string | null;
  targetIds: string[];
  subjectIds: string[];
  sourceMessageId: string;
  eraLabel: string;
  timeLabel: string;
};

export type SettlementEventRow = {
  id: string;
  timelineId: string;
  kind: string;
  title: string;
  summary: string;
  phase: string;
  visibility: string;
  participantIds: string[];
  originMessageId: string;
  originActivityId: string | null;
  latestMessageId: string;
  parentEventId: string | null;
  resolvedAt: Date | null;
};

type TimelineRow = {
  id: string;
  realityState: unknown;
  observerState: unknown;
  gods: { id: string }[];
  entities: { id: string }[];
};

export type SettlementActivityTx = {
  timeline: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        realityState: true;
        observerState: true;
        gods: { select: { id: true } };
        entities: { select: { id: true } };
      };
    }): Promise<TimelineRow | null>;
    update(args: {
      where: { id: string };
      data: { observerState: unknown };
    }): Promise<unknown>;
  };
  worldActivity: {
    findMany(args: {
      where: {
        id: { in: string[] };
        timelineId: string;
        recordType: "activity";
      };
    }): Promise<SettlementActivityRow[]>;
    findUnique(args: { where: { id: string } }): Promise<SettlementActivityRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(args: {
      where: { id: { in: string[] }; timelineId: string };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { id: { in: string[] }; timelineId: string };
    }): Promise<{ count: number }>;
  };
  worldEvent: {
    findMany(args: {
      where: {
        id: { in: string[] };
        timelineId: string;
        resolvedAt: null;
      };
    }): Promise<SettlementEventRow[]>;
    findUnique(args: { where: { id: string } }): Promise<SettlementEventRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export type ApplySettlementActivityInput = {
  timelineId: string;
  chapterId: string;
  sourceMessageId: string;
  worldActivity: SettlementWorldActivity | undefined;
};

function asSet(ids: IdentifierSet): ReadonlySet<string> {
  return ids instanceof Set ? ids : new Set(ids);
}

function uniqueKnown(ids: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(ids)].filter((id) => known.has(id));
}

function allKnown(ids: readonly string[], known: ReadonlySet<string>): boolean {
  return ids.every((id) => known.has(id));
}

export function normalizeSettlementActivity(
  activity: SettlementWorldActivity | undefined,
  known: SettlementKnownIds,
): NormalizedSettlementActivity {
  if (!activity) return { mergedActivities: [], eventMutations: [] };
  const activityIds = asSet(known.activityIds);
  const eventIds = asSet(known.eventIds);
  const participantIds = asSet(known.participantIds);
  const mergedActivities = uniqueKnown(activity.mergeActivityIds, activityIds);
  const eventMutations = activity.eventMutations.filter((mutation) => {
    if (!allKnown(mutation.participantIds, participantIds)) return false;
    if (mutation.operation === "create") {
      return allKnown(mutation.sourceActivityIds, activityIds);
    }
    return eventIds.has(
      mutation.operation === "advance" ? mutation.eventId : mutation.parentEventId,
    );
  });
  return { mergedActivities, eventMutations };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function label(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableEventId(chapterId: string, index: number): string {
  return `settlement:${chapterId}:${index}`;
}

function stableProgressId(chapterId: string, index: number): string {
  return `${stableEventId(chapterId, index)}:progress`;
}

async function createProgressOnce(
  tx: SettlementActivityTx,
  input: ApplySettlementActivityInput,
  timeline: TimelineRow,
  index: number,
  eventId: string,
  kind: string,
  text: string,
  visibility: string,
  subjectIds: string[],
  source?: SettlementActivityRow,
): Promise<void> {
  const id = stableProgressId(input.chapterId, index);
  if (await tx.worldActivity.findUnique({ where: { id } })) return;
  const reality = record(timeline.realityState);
  const observer = record(timeline.observerState);
  await tx.worldActivity.create({
    data: {
      id,
      timelineId: input.timelineId,
      eventId,
      recordType: "event_progress",
      kind,
      text,
      visibility,
      actorId: null,
      targetIds: [],
      subjectIds,
      sourceMessageId: input.sourceMessageId,
      eraLabel: source?.eraLabel ?? label(reality.currentEra, "未名纪元"),
      timeLabel: source?.timeLabel ?? label(observer.timeLabel, "此刻"),
    },
  });
}

/**
 * Applies deep event maintenance inside the caller's settlement transaction.
 * Stable chapter/index identifiers make retries safe after any durable stage.
 */
export async function applySettlementActivity(
  tx: SettlementActivityTx,
  input: ApplySettlementActivityInput,
): Promise<NormalizedSettlementActivity> {
  const requested = input.worldActivity ?? {
    mergeActivityIds: [],
    eventMutations: [],
  };
  const activityRefs = [...new Set([
    ...requested.mergeActivityIds,
    ...requested.eventMutations.flatMap((mutation) =>
      mutation.operation === "create" ? mutation.sourceActivityIds : []),
  ])];
  const eventRefs = [...new Set(requested.eventMutations.flatMap((mutation) => {
    if (mutation.operation === "advance") return [mutation.eventId];
    if (mutation.operation === "derive") return [mutation.parentEventId];
    return [];
  }))];
  const [timeline, activities, events] = await Promise.all([
    tx.timeline.findUnique({
      where: { id: input.timelineId },
      select: {
        id: true,
        realityState: true,
        observerState: true,
        gods: { select: { id: true } },
        entities: { select: { id: true } },
      },
    }),
    activityRefs.length
      ? tx.worldActivity.findMany({
        where: {
          id: { in: activityRefs },
          timelineId: input.timelineId,
          recordType: "activity",
        },
      })
      : Promise.resolve([]),
    eventRefs.length
      ? tx.worldEvent.findMany({
        where: {
          id: { in: eventRefs },
          timelineId: input.timelineId,
          resolvedAt: null,
        },
      })
      : Promise.resolve([]),
  ]);
  if (!timeline) throw new Error("活动现实不存在");

  const participantIds = [
    ...timeline.gods.map((item) => item.id),
    ...timeline.entities.map((item) => item.id),
  ];
  const normalized = normalizeSettlementActivity(requested, {
    activityIds: activities.map((item) => item.id),
    eventIds: events.map((item) => item.id),
    participantIds,
  });
  const acceptedMutations = new Set(normalized.eventMutations);
  const activityById = new Map(activities.map((item) => [item.id, item]));
  const eventById = new Map(events.map((item) => [item.id, item]));
  const linkedEvents = new Map<string, string>();
  const resolvedEventIds = new Set<string>();

  for (const [index, mutation] of requested.eventMutations.entries()) {
    const progressId = stableProgressId(input.chapterId, index);
    if (
      !acceptedMutations.has(mutation)
      && !await tx.worldActivity.findUnique({ where: { id: progressId } })
    ) {
      continue;
    }

    if (mutation.operation === "advance") {
      if (await tx.worldActivity.findUnique({ where: { id: progressId } })) continue;
      const event = eventById.get(mutation.eventId);
      if (!event) continue;
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
      await createProgressOnce(
        tx,
        input,
        timeline,
        index,
        event.id,
        event.kind,
        mutation.progressText,
        mutation.visibility,
        mutation.participantIds,
      );
      if (mutation.phase === "resolved") resolvedEventIds.add(event.id);
      continue;
    }

    const id = stableEventId(input.chapterId, index);
    const existing = await tx.worldEvent.findUnique({ where: { id } });
    if (!existing) {
      const source = mutation.operation === "create"
        ? activityById.get(mutation.sourceActivityIds[0]!)
        : undefined;
      await tx.worldEvent.create({
        data: {
          id,
          timelineId: input.timelineId,
          kind: mutation.kind,
          title: mutation.title,
          summary: mutation.summary,
          phase: mutation.operation === "create" ? mutation.phase : "emerging",
          visibility: mutation.visibility,
          participantIds: mutation.participantIds,
          originMessageId: source?.sourceMessageId ?? input.sourceMessageId,
          originActivityId: source?.id ?? null,
          latestMessageId: input.sourceMessageId,
          parentEventId: mutation.operation === "derive" ? mutation.parentEventId : null,
          resolvedAt: null,
        },
      });
      await createProgressOnce(
        tx,
        input,
        timeline,
        index,
        id,
        mutation.kind,
        mutation.summary,
        mutation.visibility,
        mutation.participantIds,
        source,
      );
    }
    if (mutation.operation === "create") {
      for (const activityId of mutation.sourceActivityIds) linkedEvents.set(activityId, id);
    }
  }

  const mergeRows = normalized.mergedActivities
    .map((id) => activityById.get(id))
    .filter((row): row is SettlementActivityRow => row !== undefined);
  if (mergeRows.length > 1) {
    const canonical = mergeRows[0]!;
    const linkedEventId = mergeRows
      .map((row) => linkedEvents.get(row.id) ?? row.eventId)
      .find((eventId): eventId is string => eventId !== null && eventId !== undefined);
    if (linkedEventId) {
      await tx.worldActivity.updateMany({
        where: { id: { in: [canonical.id] }, timelineId: input.timelineId },
        data: { eventId: linkedEventId },
      });
    }
    await tx.worldActivity.deleteMany({
      where: {
        id: { in: mergeRows.slice(1).map((row) => row.id) },
        timelineId: input.timelineId,
      },
    });
  } else {
    for (const [activityId, eventId] of linkedEvents) {
      if (!activityById.has(activityId)) continue;
      await tx.worldActivity.updateMany({
        where: { id: { in: [activityId] }, timelineId: input.timelineId },
        data: { eventId },
      });
    }
  }

  if (resolvedEventIds.size > 0) {
    const observer = record(timeline.observerState);
    if (
      typeof observer.focusedEventId === "string"
      && resolvedEventIds.has(observer.focusedEventId)
    ) {
      await tx.timeline.update({
        where: { id: input.timelineId },
        data: {
          observerState: {
            ...observer,
            focusedEventId: null,
          },
        },
      });
    }
  }
  return normalized;
}
