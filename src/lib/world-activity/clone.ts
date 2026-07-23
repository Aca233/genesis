import type { Prisma } from "@prisma/client";

export type WorldActivityCloneMaps = {
  event: ReadonlyMap<string, string>;
  activity: ReadonlyMap<string, string>;
  message: ReadonlyMap<string, string>;
  god: ReadonlyMap<string, string>;
  entity: ReadonlyMap<string, string>;
};

export type WorldEventCloneRow = {
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
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

export type WorldActivityCloneRow = {
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
  createdAt: Date;
};

type WorldActivityGraph = {
  events: readonly WorldEventCloneRow[];
  activities: readonly WorldActivityCloneRow[];
  observerState: Prisma.JsonValue | null;
};

export function assertWorldEventParentAcyclic(
  events: readonly Pick<WorldEventCloneRow, "id" | "parentEventId">[],
): void {
  const parentByEventId = new Map(events.map((event) => [event.id, event.parentEventId]));
  for (const event of events) {
    const visited = new Set<string>([event.id]);
    let parentEventId = event.parentEventId;
    while (parentEventId !== null) {
      if (visited.has(parentEventId)) {
        throw new Error("世界事件父链不得形成循环");
      }
      visited.add(parentEventId);
      parentEventId = parentByEventId.get(parentEventId) ?? null;
    }
  }
}

function requireMapped(
  map: ReadonlyMap<string, string>,
  sourceId: string,
  label: string,
): string {
  const mapped = map.get(sourceId);
  if (mapped === undefined) throw new Error(`${label}缺少克隆映射：${sourceId}`);
  return mapped;
}

function remapSubject(sourceId: string, maps: WorldActivityCloneMaps, label: string): string {
  const mapped = maps.god.get(sourceId) ?? maps.entity.get(sourceId);
  if (mapped === undefined) throw new Error(`${label}缺少克隆映射：${sourceId}`);
  return mapped;
}

function remapFocusedEvent(
  value: Prisma.JsonValue | null,
  eventMap: ReadonlyMap<string, string>,
): Prisma.InputJsonValue | null {
  if (value === null) return null;
  const cloned = structuredClone(value);
  if (typeof cloned !== "object" || Array.isArray(cloned)) return cloned;
  const observer = cloned as Record<string, Prisma.JsonValue>;
  if (typeof observer.focusedEventId === "string") {
    observer.focusedEventId = requireMapped(
      eventMap,
      observer.focusedEventId,
      "关注事件",
    );
  }
  return observer as Prisma.InputJsonValue;
}

export function remapWorldActivityGraph(
  source: WorldActivityGraph,
  maps: WorldActivityCloneMaps,
  timelineId: string,
): {
  events: WorldEventCloneRow[];
  activities: WorldActivityCloneRow[];
  observerState: Prisma.InputJsonValue | null;
} {
  const events = source.events.map((event) => ({
    ...event,
    id: requireMapped(maps.event, event.id, "世界事件"),
    timelineId,
    participantIds: event.participantIds.map((id) =>
      remapSubject(id, maps, "事件参与者")
    ),
    originMessageId: requireMapped(maps.message, event.originMessageId, "事件来源消息"),
    originActivityId: event.originActivityId === null
      ? null
      : requireMapped(maps.activity, event.originActivityId, "事件来源动态"),
    latestMessageId: requireMapped(maps.message, event.latestMessageId, "事件最新消息"),
    parentEventId: event.parentEventId === null
      ? null
      : requireMapped(maps.event, event.parentEventId, "父事件"),
  }));
  const activities = source.activities.map((activity) => ({
    ...activity,
    id: requireMapped(maps.activity, activity.id, "世界动态"),
    timelineId,
    eventId: activity.eventId === null
      ? null
      : requireMapped(maps.event, activity.eventId, "动态所属事件"),
    actorId: activity.actorId === null
      ? null
      : remapSubject(activity.actorId, maps, "动态行动者"),
    targetIds: activity.targetIds.map((id) => remapSubject(id, maps, "动态目标")),
    subjectIds: activity.subjectIds.map((id) => remapSubject(id, maps, "动态主体")),
    sourceMessageId: requireMapped(maps.message, activity.sourceMessageId, "动态来源消息"),
  }));
  return {
    events,
    activities,
    observerState: remapFocusedEvent(source.observerState, maps.event),
  };
}
