import { prisma } from "@/lib/db";
import type { WorldMode } from "@/lib/world-mode";

export type WorldActivityVisibility = "public" | "player_known" | "hidden";
export type WorldActivityContextViewer =
  | "pantheon"
  | "creator_limited"
  | "creator_omniscient";

export type WorldEventContextRecord = {
  id: string;
  title: string;
  summary: string;
  phase: string;
  visibility: WorldActivityVisibility;
  participantIds: string[];
  updatedAt: Date;
  resolvedAt: Date | null;
};

export type WorldActivityContextRecord = {
  id: string;
  eventId: string | null;
  recordType: string;
  kind: string;
  text: string;
  visibility: WorldActivityVisibility;
  actorId: string | null;
  targetIds: string[];
  subjectIds: string[];
  eraLabel: string;
  timeLabel: string;
  createdAt: Date;
};

export type SelectedWorldActivityContext = {
  events: Array<WorldEventContextRecord & { knowledgeNote?: string }>;
  activities: Array<WorldActivityContextRecord & { knowledgeNote?: string }>;
  actionableEventIds: string[];
  focusedEventId: string | null;
  focusGuidance: string;
};

type SelectWorldActivityContextInput = {
  focusedEventId: string | null;
  currentSubjectIds: string[];
  events: WorldEventContextRecord[];
  activities: WorldActivityContextRecord[];
  budget: { events: number; activities: number };
  viewer: WorldActivityContextViewer;
};

function isVisible(
  visibility: WorldActivityVisibility,
  viewer: WorldActivityContextViewer,
): boolean {
  return visibility !== "hidden" || viewer === "creator_omniscient";
}

function intersects(left: readonly string[], right: ReadonlySet<string>): boolean {
  return left.some((id) => right.has(id));
}

function compareRanked(
  a: { score: number; time: number; id: string },
  b: { score: number; time: number; id: string },
): number {
  return b.score - a.score || b.time - a.time || a.id.localeCompare(b.id);
}

function withKnowledgeNote<T extends { visibility: WorldActivityVisibility }>(
  record: T,
  viewer: WorldActivityContextViewer,
): T & { knowledgeNote?: string } {
  return record.visibility === "hidden" && viewer === "creator_omniscient"
    ? { ...record, knowledgeNote: "世界内尚未知晓" }
    : record;
}

export function selectWorldActivityContext(
  input: SelectWorldActivityContextInput,
): SelectedWorldActivityContext {
  const currentSubjects = new Set(input.currentSubjectIds);
  const uniqueEvents = new Map<string, WorldEventContextRecord>();
  for (const event of input.events) {
    if (isVisible(event.visibility, input.viewer) && !uniqueEvents.has(event.id)) {
      uniqueEvents.set(event.id, event);
    }
  }

  const events = [...uniqueEvents.values()]
    .map((event) => ({
      event,
      score:
        (event.id === input.focusedEventId ? 100 : 0)
        + (intersects(event.participantIds, currentSubjects) ? 40 : 0)
        + (event.resolvedAt === null && event.phase !== "resolved" ? 20 : 0),
      time: event.updatedAt.getTime(),
      id: event.id,
    }))
    .sort(compareRanked)
    .slice(0, input.budget.events)
    .map(({ event }) => withKnowledgeNote(event, input.viewer));

  const activities = input.activities
    .filter((activity) => isVisible(activity.visibility, input.viewer))
    .map((activity) => {
      const relatedIds = [
        ...(activity.actorId === null ? [] : [activity.actorId]),
        ...activity.targetIds,
        ...activity.subjectIds,
      ];
      return {
        activity,
        score:
          (activity.eventId === input.focusedEventId ? 100 : 0)
          + (intersects(relatedIds, currentSubjects) ? 40 : 0),
        time: activity.createdAt.getTime(),
        id: activity.id,
      };
    })
    .sort(compareRanked)
    .slice(0, input.budget.activities)
    .map(({ activity }) => withKnowledgeNote(activity, input.viewer));

  return {
    events,
    activities,
    actionableEventIds: events
      .filter((event) => event.resolvedAt === null && event.phase !== "resolved")
      .map((event) => event.id),
    focusedEventId: events.some((event) => event.id === input.focusedEventId)
      ? input.focusedEventId
      : null,
    focusGuidance: "关注只提高后续叙事权重，不要求切换当前场景，也不要求立即推进。",
  };
}

type WorldActivityClient = {
  worldEvent: {
    findMany(args: unknown): Promise<WorldEventContextRecord[]>;
  };
  worldActivity: {
    findMany(args: unknown): Promise<WorldActivityContextRecord[]>;
  };
};

export async function buildWorldActivityContext(input: {
  timelineId: string;
  mode: WorldMode;
  viewpoint: "omniscient" | "limited";
  focusedEventId: string | null;
  currentSubjectIds: string[];
}): Promise<SelectedWorldActivityContext> {
  const client = prisma as unknown as WorldActivityClient;
  const [events, activities] = await Promise.all([
    client.worldEvent.findMany({
      where: { timelineId: input.timelineId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }),
    client.worldActivity.findMany({
      where: { timelineId: input.timelineId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 60,
    }),
  ]);
  const viewer: WorldActivityContextViewer = input.mode === "pantheon"
    ? "pantheon"
    : input.viewpoint === "omniscient"
      ? "creator_omniscient"
      : "creator_limited";

  return selectWorldActivityContext({
    focusedEventId: input.focusedEventId,
    currentSubjectIds: input.currentSubjectIds,
    events,
    activities,
    budget: { events: 3, activities: 8 },
    viewer,
  });
}
