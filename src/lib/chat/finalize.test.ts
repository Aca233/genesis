import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reveal: vi.fn() }));
vi.mock("@/lib/abilities/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/abilities/mutations")>();
  return { ...actual, revealAbilityInTransaction: mocks.reveal };
});

import { applyStoredNarration, finalizeNarration } from "./finalize";
import { emptyContinuousMeta } from "./continuous-meta";

function fixture() {
  const state = { messages: new Map<string, Record<string, unknown>>() };
  const tx = {
    world: { findUnique: vi.fn().mockResolvedValue({ activeTimelineId: "timeline-1", mode: "pantheon" }) },
    generationRequest: {
      findUnique: vi.fn(async () => ({
        id: "generation-1",
        chapterId: "chapter-1",
        mode: "say",
        scale: "scene",
        content: "神谕",
        directive: null,
        status: "pending",
        stage: "output_stored",
        playerMessageId: "genplayer:generation-1",
        narratorMessageId: "generation-1",
        playerIndex: 3,
        narratorIndex: 4,
        resultMeta: null,
      })),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    message: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.messages.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: String(data.id), chapterId: String(data.chapterId), scale: String(data.scale) };
        state.messages.set(row.id, row);
        return row;
      }),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(async ({ where, data }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = { ...state.messages.get(where.id), ...data };
        state.messages.set(where.id, row);
        return row;
      }),
    },
    timeline: {
      findUnique: vi.fn().mockResolvedValue({
        id: "timeline-1",
        realityState: { currentEra: "潮汐纪元" },
        observerState: { timeLabel: "第七日" },
        gods: [{ id: "god-1" }],
        entities: [{ id: "entity-1" }],
        worldEvents: [],
      }),
    },
    worldActivity: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    worldEvent: {
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    ability: { findFirst: vi.fn() },
    chronicleEntry: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    omenQueue: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    realityRewrite: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "rewrite-1",
        worldId: "world-1",
        sourceTimelineId: "timeline-1",
        sourceChapterId: "chapter-1",
        decree: "神谕",
        scope: "retroactive",
        status: "planning",
      }),
    },
  };
  const client = {
    $transaction: vi.fn(async (operation: (arg: typeof tx) => Promise<unknown>) => operation(tx)),
  };
  return { state, tx, client };
}

const base = {
  generationId: "generation-1",
  chapterId: "chapter-1",
  chapterIndex: 3,
  timelineId: "timeline-1",
  worldId: "world-1",
  expectedActiveTimelineId: "timeline-1",
  narratorIndex: 4,
  requestMeta: {
    type: "chat-generation-request" as const,
    chapterId: "chapter-1",
    mode: "say" as const,
    scale: "scene" as const,
    content: "神谕",
    directive: null,
    playerMessageId: "genplayer:generation-1",
    narratorMessageId: "generation-1",
    playerIndex: 3,
    narratorIndex: 4,
  },
  attempt: 1,
  prose: "叙事正文",
  scale: "scene" as const,
  meta: {
    suggestions: [],
    operation: "continue" as const,
    immediateChanges: [],
    worldActions: [],
    activityEntries: [],
    significantEvent: false,
    settlementReasons: [],
    revealedEventIds: ["chronicle-1"],
    abilityReveals: [
      { abilityId: "ability-1", visibility: "known" as const, evidence: "能力被清楚见证" },
      { abilityId: "invalid", visibility: "known" as const, evidence: "非法" },
    ],
  },
};

describe("finalizeNarration", () => {
  beforeEach(() => vi.clearAllMocks());
  it("在同一事务中保存消息、揭示能力与编年史，非法 ID 仅跳过", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst
      .mockResolvedValueOnce({ id: "ability-1", version: 2, rumorText: null, visibility: "hidden" })
      .mockResolvedValueOnce(null);
    mocks.reveal.mockResolvedValue({ applied: true });
    const log = vi.fn();

    await finalizeNarration(client as never, { ...base, logInvalidReveal: log });

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.generationRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "generation-1",
        status: "pending",
        attempt: 1,
        stage: { in: ["output_stored", "applying"] },
      },
      data: {
        stage: "applying",
        stageUpdatedAt: expect.any(Date),
        leaseExpiresAt: expect.any(Date),
      },
    });
    expect(tx.message.create).toHaveBeenCalledTimes(2);
    expect(mocks.reveal).toHaveBeenCalledWith(tx, expect.objectContaining({
      abilityId: "ability-1",
      event: expect.objectContaining({ messageId: "generation-1" }),
    }));
    expect(log).toHaveBeenCalledWith({ abilityId: "invalid", generationId: "generation-1" });
    expect(tx.chronicleEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.generationRequest.update).toHaveBeenCalledWith({
      where: { id: "generation-1" },
      data: expect.objectContaining({
        status: "completed",
        stage: "completed",
        stageUpdatedAt: expect.any(Date),
        error: null,
        leaseExpiresAt: null,
        narratorMessageId: "generation-1",
        resultMeta: expect.objectContaining({
          version: 1,
          messageId: "generation-1",
          meta: base.meta,
          followUp: { kind: "none" },
        }),
      }),
    });
  });

  it("非阻断正文 lint 只写入消息私有 meta，不改变 Narrator completion 契约", async () => {
    const { client, state, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue(null);
    const meta = {
      ...base.meta,
      revealedEventIds: [],
      abilityReveals: [],
    };

    const result = await finalizeNarration(client as never, {
      ...base,
      prose: "### 正文\n空气仿佛凝固！！",
      meta,
    });
    const stored = state.messages.get("generation-1");
    const storedMeta = stored?.meta as { proseLint?: Array<{ ruleId: string }> } | undefined;
    const variants = stored?.variants as Array<{ meta: Record<string, unknown> }> | undefined;

    expect(storedMeta?.proseLint?.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["markdown_heading", "stock_phrase", "repeated_punctuation"]),
    );
    expect(variants?.[0]?.meta).not.toHaveProperty("proseLint");
    expect(result.meta).toEqual(meta);
  });

  it("相同 generationId 重试直接复用，不重复任何副作用", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "ability-1" ? { id: "ability-1", version: 2, rumorText: null, visibility: "hidden" } : null,
    );
    mocks.reveal.mockResolvedValue({ applied: true });

    await finalizeNarration(client as never, base);
    const second = await finalizeNarration(client as never, base);

    expect(second).toEqual({
      messageId: "generation-1",
      meta: base.meta,
      followUp: { kind: "none" },
      reused: true,
    });
    expect(tx.message.create).toHaveBeenCalledTimes(2);
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(tx.chronicleEntry.updateMany).toHaveBeenCalledTimes(1);
  });

  it("瞬态揭示写失败会拒绝整个 finalization，不吞错", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue({ id: "ability-1", version: 2, rumorText: null, visibility: "hidden" });
    mocks.reveal.mockRejectedValue(new Error("database unavailable"));

    await expect(finalizeNarration(client as never, base)).rejects.toThrow("database unavailable");
    expect(tx.chronicleEntry.updateMany).not.toHaveBeenCalled();
  });

  it("两阶段征兆消费：叙事落库成功后才标记，复用重试不重复标记", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue(null);
    const input = { ...base, consumedOmenIds: ["omen-1", "omen-2"] };

    await finalizeNarration(client as never, input);

    expect(tx.omenQueue.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["omen-1", "omen-2"] }, consumed: false },
      data: { consumed: true },
    });
    expect(tx.omenQueue.updateMany.mock.invocationCallOrder[0])
      .toBeGreaterThan(tx.message.create.mock.invocationCallOrder[0]);

    await finalizeNarration(client as never, input);
    expect(tx.omenQueue.updateMany).toHaveBeenCalledTimes(1);
  });

  it("未提供 consumedOmenIds 时不触碰征兆队列（存储快照恢复路径）", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue(null);

    await finalizeNarration(client as never, base);

    expect(tx.omenQueue.updateMany).not.toHaveBeenCalled();
  });

  it("significant_event 无 settlement_reasons 且未触发整理时打印告警", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await finalizeNarration(client as never, {
        ...base,
        meta: { ...base.meta, significantEvent: true, settlementReasons: [] },
      });

      expect(warn).toHaveBeenCalledWith(
        "significant_event 被忽略：缺少 settlement_reasons",
        { generationId: "generation-1" },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("creator omniscient observation never consumes author-only hidden chronicles", async () => {
    const { client, tx } = fixture();
    tx.world.findUnique.mockResolvedValue({ activeTimelineId: "timeline-1", mode: "creator" });
    tx.ability.findFirst.mockResolvedValue(null);

    await finalizeNarration(client as never, base);

    expect(tx.chronicleEntry.updateMany).not.toHaveBeenCalled();
  });

  it("从私有输出快照应用正文而不是接受另一份临时输出", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue(null);
    const output = {
      prose: "快照中的唯一正文",
      parsedMeta: emptyContinuousMeta(),
      generatedAt: "2026-07-23T00:00:00.000Z",
      contractVersion: 1 as const,
    };

    await applyStoredNarration(client as never, {
      ...base,
      output,
    });

    expect(tx.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "generation-1",
        content: "快照中的唯一正文",
        variants: [{
          content: "快照中的唯一正文",
          meta: emptyContinuousMeta(),
          chosen: true,
        }],
      }),
    });
  });
  it("在正文事务中写入世界动态并把接受计数留在 Narrator 私有 meta", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue(null);

    await finalizeNarration(client as never, {
      ...base,
      meta: {
        ...base.meta,
        abilityReveals: [],
        worldActions: [{
          actorType: "god",
          actorId: "god-1",
          action: "命令守军封锁北港",
          targetIds: ["entity-1"],
          visibility: "public",
          consequence: "航道受阻",
        }],
        activityEntries: [],
      },
    });

    expect(tx.worldActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "activity:generation-1:action:0",
        sourceMessageId: "generation-1",
      }),
    });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "generation-1" },
      data: {
        meta: expect.objectContaining({
          activityApply: {
            acceptedActions: 1,
            rejectedActions: 0,
            acceptedActivities: 0,
            rejectedActivities: 0,
            eventMutationAccepted: false,
          },
        }),
      },
    });
  });
  it("creator 追溯意图创建任务且不写源现实消息", async () => {
    const { client, tx } = fixture();
    tx.world.findUnique.mockResolvedValue({
      activeTimelineId: "timeline-1",
      mode: "creator",
    });

    const result = await finalizeNarration(client as never, {
      ...base,
      meta: {
        suggestions: [],
        operation: "retroactive_rewrite",
        immediateChanges: [],
        worldActions: [],
        activityEntries: [],
        significantEvent: true,
        settlementReasons: ["major_event"],
      },
    });

    expect(result).toMatchObject({
      messageId: null,
      followUp: { kind: "rewrite", taskId: "rewrite-1" },
    });
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.worldActivity.create).not.toHaveBeenCalled();
    expect(tx.realityRewrite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decree: "神谕",
        scope: "retroactive",
        idempotencyKey: "chat:generation-1",
      }),
    });
  });
  it("rejects a late response when the world has switched realities", async () => {
    const { client, tx } = fixture();
    tx.world.findUnique.mockResolvedValue({ activeTimelineId: "timeline-new" });

    await expect(finalizeNarration(client as never, base)).rejects.toThrow("该现实已被冻结");
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.chronicleEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.generationRequest.update).not.toHaveBeenCalled();
  });

});

describe("reveal merge/no-op", () => {
  beforeEach(() => vi.clearAllMocks());

  it("同一能力归并为最高 known 目标且只揭示一次", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue({ id: "ability-1", version: 2, rumorText: null, visibility: "hidden" });
    mocks.reveal.mockResolvedValue({ applied: true });

    await finalizeNarration(client as never, {
      ...base,
      meta: {
        suggestions: [],
        operation: "continue",
        immediateChanges: [],
        worldActions: [],
        activityEntries: [],
        significantEvent: false,
        settlementReasons: [],
        abilityReveals: [
          { abilityId: "ability-1", visibility: "rumored", evidence: "先有传闻" },
          { abilityId: "ability-1", visibility: "known", evidence: "继而亲见" },
        ],
      },
    });

    expect(tx.ability.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(mocks.reveal).toHaveBeenCalledWith(tx, expect.objectContaining({ visibility: "known" }));
  });

  it("能力已达到或超过目标可见性时 no-op", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue({ id: "ability-1", version: 2, rumorText: null, visibility: "known" });

    await finalizeNarration(client as never, {
      ...base,
      meta: {
        suggestions: [],
        operation: "continue",
        immediateChanges: [],
        worldActions: [],
        activityEntries: [],
        significantEvent: false,
        settlementReasons: [],
        abilityReveals: [{ abilityId: "ability-1", visibility: "rumored", evidence: "旧闻" }],
      },
    });

    expect(mocks.reveal).not.toHaveBeenCalled();
  });
});
