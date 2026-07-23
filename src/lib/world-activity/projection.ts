import {
  canViewWorldKnowledge,
  knowledgeLabelForViewer,
  type RealityViewer,
  type WorldKnowledgeLabel,
  type WorldKnowledgeVisibility,
} from "@/lib/reality/visibility";

type DateLike = Date | string;

export type WorldEventProjectionRow = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  phase: string;
  visibility: WorldKnowledgeVisibility;
  participantIds: string[];
  createdAt: DateLike;
  updatedAt: DateLike;
  resolvedAt: DateLike | null;
};

export type WorldActivityProjectionRow = {
  id: string;
  eventId: string | null;
  recordType: string;
  kind: string;
  text: string;
  visibility: WorldKnowledgeVisibility;
  actorId: string | null;
  targetIds: string[];
  subjectIds: string[];
  eraLabel: string;
  timeLabel: string;
  createdAt: DateLike;
};

export type ProjectedWorldEvent = Omit<
  WorldEventProjectionRow,
  "createdAt" | "updatedAt" | "resolvedAt"
> & {
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  knowledgeLabel?: WorldKnowledgeLabel;
};

export type ProjectedWorldActivity = Omit<
  WorldActivityProjectionRow,
  "createdAt"
> & {
  createdAt: string;
  knowledgeLabel?: WorldKnowledgeLabel;
};

export type WorldActivityProjectionInput = {
  focusedEventId: string | null;
  events: readonly WorldEventProjectionRow[];
  activities: readonly WorldActivityProjectionRow[];
};

export type ProjectedWorldActivityFeed = {
  focusedEvent: ProjectedWorldEvent | null;
  events: ProjectedWorldEvent[];
  activities: ProjectedWorldActivity[];
};

function iso(value: DateLike): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: DateLike | null): string | null {
  return value === null ? null : iso(value);
}

function projectEvent(
  row: WorldEventProjectionRow,
  viewer: RealityViewer,
): ProjectedWorldEvent | null {
  if (!canViewWorldKnowledge(viewer, row.visibility)) return null;
  const knowledgeLabel = knowledgeLabelForViewer(viewer, row.visibility);
  return {
    ...row,
    participantIds: [...row.participantIds],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    resolvedAt: optionalIso(row.resolvedAt),
    ...(knowledgeLabel ? { knowledgeLabel } : {}),
  };
}

function projectActivity(
  row: WorldActivityProjectionRow,
  viewer: RealityViewer,
): ProjectedWorldActivity | null {
  if (!canViewWorldKnowledge(viewer, row.visibility)) return null;
  const knowledgeLabel = knowledgeLabelForViewer(viewer, row.visibility);
  return {
    ...row,
    targetIds: [...row.targetIds],
    subjectIds: [...row.subjectIds],
    createdAt: iso(row.createdAt),
    ...(knowledgeLabel ? { knowledgeLabel } : {}),
  };
}

/**
 * Projects complete rows rather than redacting fields in-place. Hidden rows and
 * every identifier carried by them therefore disappear together.
 */
export function projectWorldActivity(
  input: WorldActivityProjectionInput,
  viewer: RealityViewer,
): ProjectedWorldActivityFeed {
  const events = input.events.flatMap((row) => {
    const projected = projectEvent(row, viewer);
    return projected ? [projected] : [];
  });
  const activities = input.activities.flatMap((row) => {
    const projected = projectActivity(row, viewer);
    return projected ? [projected] : [];
  });
  return {
    focusedEvent: events.find((event) => event.id === input.focusedEventId) ?? null,
    events,
    activities,
  };
}
