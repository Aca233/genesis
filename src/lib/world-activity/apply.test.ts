import { describe, expect, it, vi } from "vitest";
import type { WorldActivityMeta } from "./contracts";
import { applyWorldActivityInTransaction } from "./apply";

function activity(overrides: Record<string, unknown> = {}) {
  return {
    kind: "movement" as const,
    text: "守军向北港移动。",
    subjectIds: ["entity-1"],
    visibility: "public" as const,
    importance: "normal" as const,
    ...overrides,
  };
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    actorType: "god" as const,
    actorId: "god-1",
    action: "命令守军封锁北港",
    targetIds: ["entity-1"],
    visibility: "public" as const,
    consequence: "北港航道受阻",
    ...overrides,
  };
}

function fixture() {
  const activityRows = new Map<string, Record<string, unknown>>();
  const eventRows = new Map<string, Record<string, unknown>>([
    ["event-existing", {
      id: "event-existing",
      timelineId: "timeline-1",
      kind: "war",
      phase: "developing",
      resolvedAt: null,
    }],
    ["event-resolved", {
      id: "event-resolved",
      timelineId: "timeline-1",
      kind: "war",
      phase: "resolved",
      resolvedAt: new Date(),
    }],
  ]);
  const tx = {
    timeline: {
      findUnique: vi.fn().mockResolvedValue({
        id: "timeline-1",
        realityState: { currentEra: "潮汐纪元" },
        observerState: { timeLabel: "第七码头日" },
        gods: [{ id: "god-1" }, { id: "shared-id" }],
        entities: [{ id: "entity-1" }, { id: "shared-id" }],
        worldEvents: [...eventRows.values()],
      }),
    },
    worldActivity: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        activityRows.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        activityRows.set(String(data.id), data);
        return data;
      }),
    },
    worldEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        eventRows.set(String(data.id), data);
        return data;
      }),
      update: vi.fn(async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        eventRows.set(where.id, { ...eventRows.get(where.id), ...data });
        return eventRows.get(where.id);
      }),
    },
  };
  return { tx, activityRows, eventRows };
}

function baseInput(meta: Partial<WorldActivityMeta> = {}) {
  return {
    timelineId: "timeline-1",
    generationId: "gen-1",
    sourceMessageId: "gen-1",
    allowedEventIds: ["event-existing"],
    meta: {
      worldActions: [action()],
      activityEntries: [activity()],
      importantEventMutation: {
        operation: "create" as const,
        tempRef: "north-harbor",
        kind: "war" as const,
        title: "北港封锁",
        summary: "海神命令守军封锁北港。",
        phase: "emerging" as const,
        participantIds: ["god-1", "entity-1"],
        visibility: "public" as const,
        progressText: "北港航道正式被封锁。",
        originActivityId: "activity:gen-1:activity:0",
      },
      ...meta,
    },
  };
}

describe("applyWorldActivityInTransaction", () => {
  it("保留合法动态并逐项拒绝跨现实 subject", async () => {
    const { tx, activityRows } = fixture();

    const result = await applyWorldActivityInTransaction(tx, baseInput({
      worldActions: [],
      activityEntries: [
        activity({ subjectIds: ["entity-1"] }),
        activity({ subjectIds: ["entity-other-timeline"] }),
      ],
      importantEventMutation: undefined,
    }));

    expect(result).toMatchObject({
      acceptedActivities: 1,
      rejectedActivities: 1,
    });
    expect([...activityRows]).toHaveLength(1);
    expect(activityRows.get("activity:gen-1:activity:0")).toMatchObject({
      eraLabel: "潮汐纪元",
      timeLabel: "第七码头日",
      sourceMessageId: "gen-1",
    });
  });

  it("校验 actor 类型并分别统计合法与非法行动", async () => {
    const { tx, activityRows } = fixture();

    const result = await applyWorldActivityInTransaction(tx, baseInput({
      worldActions: [
        action(),
        action({ actorType: "god", actorId: "entity-1" }),
        action({ actorType: "entity", actorId: "entity-1" }),
      ],
      activityEntries: [],
      importantEventMutation: undefined,
    }));

    expect(result).toMatchObject({
      acceptedActions: 2,
      rejectedActions: 1,
    });
    expect([...activityRows.keys()]).toEqual([
      "activity:gen-1:action:0",
      "activity:gen-1:action:2",
    ]);
  });

  it("同一 generation 重放不重复写动态或推进事件", async () => {
    const { tx, activityRows } = fixture();

    await applyWorldActivityInTransaction(tx, baseInput());
    await applyWorldActivityInTransaction(tx, baseInput());

    expect([...activityRows.keys()]).toEqual([
      "activity:gen-1:action:0",
      "activity:gen-1:activity:0",
      "activity:gen-1:event:0",
    ]);
    expect(tx.worldEvent.create).toHaveBeenCalledTimes(1);
  });

  it("重要事件整项拒绝非法来源动态且不留下事件进展", async () => {
    const { tx, activityRows } = fixture();

    const result = await applyWorldActivityInTransaction(tx, baseInput({
      activityEntries: [activity({ subjectIds: ["foreign"] })],
    }));

    expect(result.eventMutationAccepted).toBe(false);
    expect(tx.worldEvent.create).not.toHaveBeenCalled();
    expect(activityRows.has("activity:gen-1:event:0")).toBe(false);
  });

  it("只推进上下文允许且尚未解决的当前现实事件", async () => {
    const { tx, eventRows } = fixture();
    const advance = (eventId: string) => ({
      operation: "advance" as const,
      eventId,
      phase: "escalating" as const,
      summary: "封锁升级为海战。",
      participantIds: ["god-1", "entity-1"],
      visibility: "public" as const,
      progressText: "第一艘商船被击沉。",
    });

    const accepted = await applyWorldActivityInTransaction(tx, baseInput({
      worldActions: [],
      activityEntries: [],
      importantEventMutation: advance("event-existing"),
    }));
    const rejected = await applyWorldActivityInTransaction(tx, {
      ...baseInput({
        worldActions: [],
        activityEntries: [],
        importantEventMutation: advance("event-resolved"),
      }),
      generationId: "gen-2",
      sourceMessageId: "gen-2",
      allowedEventIds: ["event-resolved"],
    });

    expect(accepted.eventMutationAccepted).toBe(true);
    expect(eventRows.get("event-existing")).toMatchObject({
      phase: "escalating",
      latestMessageId: "gen-1",
    });
    expect(rejected.eventMutationAccepted).toBe(false);
  });
});
