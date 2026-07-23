import { describe, expect, it, vi } from "vitest";
import {
  applySettlementActivity,
  normalizeSettlementActivity,
  type SettlementActivityRow,
  type SettlementActivityTx,
  type SettlementEventRow,
} from "./settlement";

const knownIds = {
  activityIds: ["activity-a", "activity-b", "activity-c"],
  eventIds: ["event-war", "event-secret"],
  participantIds: ["god-tide", "entity-port", "entity-city"],
};

function advanceEvent(
  eventId = "event-war",
  phase: "emerging" | "developing" | "escalating" | "resolved" = "developing",
) {
  return {
    operation: "advance" as const,
    eventId,
    phase,
    summary: "盐路冲突继续发展。",
    participantIds: ["god-tide", "entity-port"],
    visibility: "public" as const,
    progressText: "北港守军封锁了盐路。",
  };
}

function fixture() {
  const observerState = {
    focusType: "world",
    focusId: null,
    timeLabel: "第七码头日",
    viewpoint: "omniscient",
    activeAvatarId: null,
    focusedEventId: "event-war",
  };
  const activityRows = new Map<string, SettlementActivityRow>([
    ["activity-a", {
      id: "activity-a",
      timelineId: "timeline-1",
      eventId: null,
      recordType: "activity",
      kind: "conflict",
      text: "盐商在北港械斗。",
      visibility: "public",
      actorId: null,
      targetIds: [],
      subjectIds: ["entity-port"],
      sourceMessageId: "message-a",
      eraLabel: "潮汐纪元",
      timeLabel: "第七码头日",
    }],
    ["activity-b", {
      id: "activity-b",
      timelineId: "timeline-1",
      eventId: null,
      recordType: "activity",
      kind: "conflict",
      text: "北港盐商再次械斗。",
      visibility: "public",
      actorId: null,
      targetIds: [],
      subjectIds: ["entity-port"],
      sourceMessageId: "message-b",
      eraLabel: "潮汐纪元",
      timeLabel: "第七码头日",
    }],
  ]);
  const eventRows = new Map<string, SettlementEventRow>([
    ["event-war", {
      id: "event-war",
      timelineId: "timeline-1",
      kind: "war",
      title: "盐路冲突",
      summary: "盐路争端尚未平息。",
      phase: "developing",
      visibility: "public",
      participantIds: ["god-tide", "entity-port"],
      originMessageId: "message-a",
      originActivityId: "activity-a",
      latestMessageId: "message-a",
      parentEventId: null,
      resolvedAt: null,
    }],
  ]);
  let currentObserver: Record<string, unknown> = observerState;

  const tx: SettlementActivityTx = {
    timeline: {
      findUnique: vi.fn(async () => ({
        id: "timeline-1",
        realityState: { currentEra: "潮汐纪元" },
        observerState: currentObserver,
        gods: [{ id: "god-tide" }],
        entities: [{ id: "entity-port" }, { id: "entity-city" }],
      })),
      update: vi.fn(async ({ data }) => {
        currentObserver = data.observerState as Record<string, unknown>;
        return { id: "timeline-1" };
      }),
    },
    worldActivity: {
      findMany: vi.fn(async ({ where }) => {
        const ids = new Set(where.id.in);
        return [...activityRows.values()].filter((row) => ids.has(String(row.id)));
      }),
      findUnique: vi.fn(async ({ where }) => activityRows.get(where.id) ?? null),
      create: vi.fn(async ({ data }) => {
        activityRows.set(String(data.id), data as unknown as SettlementActivityRow);
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const ids = new Set(where.id.in);
        let count = 0;
        for (const [id, row] of activityRows) {
          if (!ids.has(id)) continue;
          activityRows.set(id, {
            ...row,
            ...data,
          } as unknown as SettlementActivityRow);
          count += 1;
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const ids = new Set<string>(where.id.in);
        let count = 0;
        for (const id of ids) {
          if (activityRows.delete(id)) count += 1;
        }
        return { count };
      }),
    },
    worldEvent: {
      findMany: vi.fn(async ({ where }) => {
        const ids = new Set(where.id.in);
        return [...eventRows.values()].filter((row) =>
          ids.has(String(row.id))
          && row.timelineId === where.timelineId
          && row.resolvedAt === null);
      }),
      findUnique: vi.fn(async ({ where }) => eventRows.get(where.id) ?? null),
      create: vi.fn(async ({ data }) => {
        eventRows.set(String(data.id), data as unknown as SettlementEventRow);
        return data;
      }),
      update: vi.fn(async ({ where, data }) => {
        const next = {
          ...eventRows.get(where.id),
          ...data,
        } as unknown as SettlementEventRow;
        eventRows.set(where.id, next);
        return next;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const originActivityIds = new Set(where.originActivityId.in);
        let count = 0;
        for (const [id, row] of eventRows) {
          if (
            row.timelineId !== where.timelineId
            || row.originActivityId === null
            || !originActivityIds.has(row.originActivityId)
          ) {
            continue;
          }
          eventRows.set(id, {
            ...row,
            ...data,
          } as SettlementEventRow);
          count += 1;
        }
        return { count };
      }),
    },
  };
  return {
    tx,
    activityRows,
    eventRows,
    observer: () => currentObserver,
  };
}

describe("normalizeSettlementActivity", () => {
  it("把重复普通动态合并为一次事件进展并过滤未知 ID", () => {
    const result = normalizeSettlementActivity({
      mergeActivityIds: ["activity-a", "activity-b", "activity-a", "unknown"],
      eventMutations: [
        advanceEvent(),
        advanceEvent("unknown-event"),
      ],
    }, knownIds);

    expect(result.mergedActivities).toEqual(["activity-a", "activity-b"]);
    expect(result.eventMutations).toEqual([advanceEvent()]);
  });

  it("整项拒绝引用未知来源动态或参与者的新事件", () => {
    const result = normalizeSettlementActivity({
      mergeActivityIds: [],
      eventMutations: [{
        operation: "create",
        sourceActivityIds: ["activity-a", "unknown"],
        kind: "war",
        title: "盐路之战",
        summary: "零散冲突升级为战争。",
        phase: "escalating",
        participantIds: ["entity-port", "unknown-person"],
        visibility: "public",
      }],
    }, knownIds);

    expect(result.eventMutations).toEqual([]);
  });
});

describe("applySettlementActivity", () => {
  it("将相关普通动态升级成事件，合并重复项且断点重放不重复派生记录", async () => {
    const { tx, activityRows, eventRows } = fixture();
    const worldActivity = {
      mergeActivityIds: ["activity-a", "activity-b"],
      eventMutations: [{
        operation: "create" as const,
        sourceActivityIds: ["activity-a", "activity-b"],
        kind: "war" as const,
        title: "盐路之战",
        summary: "零散冲突升级为战争。",
        phase: "escalating" as const,
        participantIds: ["god-tide", "entity-port"],
        visibility: "public" as const,
      }],
    };
    const input = {
      timelineId: "timeline-1",
      chapterId: "chapter-1",
      sourceMessageId: "message-current",
      worldActivity,
    };

    await applySettlementActivity(tx, input);
    await applySettlementActivity(tx, input);

    expect(eventRows.get("settlement:chapter-1:0")).toMatchObject({
      parentEventId: null,
      originActivityId: "activity-a",
      phase: "escalating",
    });
    expect(activityRows.has("activity-b")).toBe(false);
    expect(activityRows.get("activity-a")).toMatchObject({
      eventId: "settlement:chapter-1:0",
    });
    expect(activityRows.get("settlement:chapter-1:0:progress")).toMatchObject({
      eventId: "settlement:chapter-1:0",
      recordType: "event_progress",
    });
    expect(tx.worldEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.worldActivity.create).toHaveBeenCalledTimes(1);
  });

  it("事件解决时清空 ObserverState 的当前关注", async () => {
    const { tx, eventRows, observer } = fixture();

    await applySettlementActivity(tx, {
      timelineId: "timeline-1",
      chapterId: "chapter-1",
      sourceMessageId: "message-current",
      worldActivity: {
        mergeActivityIds: [],
        eventMutations: [advanceEvent("event-war", "resolved")],
      },
    });

    expect(eventRows.get("event-war")).toMatchObject({
      phase: "resolved",
      resolvedAt: expect.any(Date),
    });
    expect(observer().focusedEventId).toBeNull();
  });

  it("合并动态前把所有事件来源重写到保留动态", async () => {
    const { tx, activityRows, eventRows } = fixture();
    eventRows.set("event-from-duplicate", {
      id: "event-from-duplicate",
      timelineId: "timeline-1",
      kind: "conspiracy",
      title: "盐商暗盟",
      summary: "暗盟源自第二条重复动态。",
      phase: "emerging",
      visibility: "hidden",
      participantIds: ["entity-port"],
      originMessageId: "message-b",
      originActivityId: "activity-b",
      latestMessageId: "message-b",
      parentEventId: null,
      resolvedAt: null,
    });

    await applySettlementActivity(tx, {
      timelineId: "timeline-1",
      chapterId: "chapter-origin-rewrite",
      sourceMessageId: "message-current",
      worldActivity: {
        mergeActivityIds: ["activity-a", "activity-b"],
        eventMutations: [{
          operation: "create",
          sourceActivityIds: ["activity-b", "activity-a"],
          kind: "war",
          title: "盐路之战",
          summary: "第二条动态先被选为事件来源。",
          phase: "escalating",
          participantIds: ["entity-port"],
          visibility: "public",
        }],
      },
    });

    expect(activityRows.has("activity-b")).toBe(false);
    expect(eventRows.get("event-from-duplicate")?.originActivityId).toBe("activity-a");
    expect(
      eventRows.get("settlement:chapter-origin-rewrite:0")?.originActivityId,
    ).toBe("activity-a");
    expect(tx.worldEvent.updateMany).toHaveBeenCalledWith({
      where: {
        timelineId: "timeline-1",
        originActivityId: { in: ["activity-b"] },
      },
      data: { originActivityId: "activity-a" },
    });
  });

  it("派生事件保留父事件引用并使用稳定 ID", async () => {
    const { tx, eventRows } = fixture();
    const input = {
      timelineId: "timeline-1",
      chapterId: "chapter-1",
      sourceMessageId: "message-current",
      worldActivity: {
        mergeActivityIds: [],
        eventMutations: [{
          operation: "derive" as const,
          parentEventId: "event-war",
          title: "港口复兴",
          kind: "faction_shift" as const,
          summary: "停战后的港口势力开始重组。",
          participantIds: ["entity-port"],
          visibility: "player_known" as const,
        }],
      },
    };

    await applySettlementActivity(tx, input);
    await applySettlementActivity(tx, input);

    expect(eventRows.get("settlement:chapter-1:0")).toMatchObject({
      parentEventId: "event-war",
      phase: "emerging",
      latestMessageId: "message-current",
    });
    expect(tx.worldEvent.create).toHaveBeenCalledTimes(1);
  });
});
