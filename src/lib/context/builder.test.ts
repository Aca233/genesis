import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { initialObserverState, initialRealityState } from "@/lib/reality/schemas";

const mocks = vi.hoisted(() => ({
  prisma: {
    world: { findUnique: vi.fn() },
    chapter: { findUnique: vi.fn(), findMany: vi.fn() },
    god: { findMany: vi.fn() },
    omenQueue: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    chronicleEntry: { findMany: vi.fn() },
    entity: { findMany: vi.fn() },
    entityRelation: { findMany: vi.fn() },
    worldEvent: { findMany: vi.fn() },
    worldActivity: { findMany: vi.fn() },
  },
  buildAbilityContext: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/abilities/context", () => ({
  buildAbilityContext: mocks.buildAbilityContext,
}));

import { buildNarratorContext, buildReentryBlock } from "./builder";

function mockChapter(overrides: Record<string, unknown> = {}) {
  mocks.prisma.chapter.findUnique.mockReset();
  mocks.prisma.chapter.findUnique
    .mockResolvedValueOnce({
      id: "chapter-1", timelineId: "timeline-1", index: 1,
      timeline: { id: "timeline-1", realityState: null, observerState: null },
      messages: [{ role: "narrator", content: "林霁站在潮神庙前" }],
      ...overrides,
    })
    .mockResolvedValueOnce(null);
}

describe("buildNarratorContext mode and active-reality boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: "测试世界", mode: "pantheon", activeTimelineId: "timeline-1",
      styleCard: null, themeCard: null, cosmology: null,
      fusionAxiom: null, lorebookEntries: [],
    });
    mockChapter();
    mocks.prisma.chapter.findMany.mockResolvedValue([]);
    mocks.prisma.god.findMany.mockResolvedValue([]);
    mocks.prisma.omenQueue.findFirst.mockResolvedValue(null);
    mocks.prisma.omenQueue.findMany.mockResolvedValue([]);
    mocks.prisma.chronicleEntry.findMany.mockResolvedValue([]);
    mocks.prisma.entity.findMany.mockResolvedValue([]);
    mocks.prisma.entityRelation.findMany.mockResolvedValue([]);
    mocks.prisma.worldEvent.findMany.mockResolvedValue([]);
    mocks.prisma.worldActivity.findMany.mockResolvedValue([]);
    mocks.buildAbilityContext.mockResolvedValue(
      "== KNOWN ABILITIES ==\n—\n\n== AUTHOR-ONLY HIDDEN ABILITIES ==\n- [hidden] 秘能",
    );
  });

  it("keeps legacy pantheon context and narrator-only hidden ability context", async () => {
    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "询问林霁",
      scale: "scene", mode: "say",
    });

    expect(mocks.buildAbilityContext).toHaveBeenCalledWith({
      timelineId: "timeline-1",
      viewer: "narrator",
      searchText: expect.stringContaining("林霁"),
    });
    expect(messages.some((message) =>
      message.role === "system" && message.content.includes("[hidden] 秘能"),
    )).toBe(true);
    expect(messages.at(-1)?.content).toContain("【玩家神谕】询问林霁");
    expect(messages[0]).toMatchObject({ role: "system", cacheScope: "global" });
    expect(messages[1]).toMatchObject({ role: "system", cacheScope: "world" });
  });

  it("pantheon 征兆只租借注入（至多 2 条），不在构建时标记消费", async () => {
    mocks.prisma.omenQueue.findMany.mockResolvedValue([
      { id: "omen-1", text: "潮水连续三夜倒流", createdAt: new Date() },
      { id: "omen-2", text: "灯塔火光转为青色", createdAt: new Date() },
    ]);

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const systems = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");

    expect(mocks.prisma.omenQueue.findMany).toHaveBeenCalledWith({
      where: { timelineId: "timeline-1", consumed: false, kind: "omen" },
      orderBy: { createdAt: "asc" },
      take: 2,
    });
    expect(mocks.prisma.omenQueue.updateMany).not.toHaveBeenCalled();
    expect(systems).toContain("潮水连续三夜倒流");
    expect(messages.consumedOmenIds).toEqual(["omen-1", "omen-2"]);
  });

  it("pantheon 主动事件独立登台：注入 PROACTIVE DIVINE EVENT 块且不混入 PENDING OMENS", async () => {
    mocks.prisma.god.findMany.mockResolvedValue([{
      id: "god-tide", name: "潮神", aliases: [], tier: "major", rank: "ascended",
      domains: ["潮汐"], persona: { desire: "吞没港城" }, voice: { style: "低语" },
      relations: {}, faithScope: "海岸", agenda: {}, isPlayer: false,
    }]);
    mocks.prisma.omenQueue.findFirst.mockResolvedValue({
      id: "pro-1", godId: "god-tide", text: "潮神遣使者入梦", createdAt: new Date(),
    });
    mocks.prisma.omenQueue.findMany.mockResolvedValue([
      { id: "omen-1", text: "潮水连续三夜倒流", createdAt: new Date() },
      { id: "omen-2", text: "灯塔火光转为青色", createdAt: new Date() },
    ]);

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const systems = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    // PROACTIVE 与 PENDING OMENS 同在 turnSystem 消息内：切出 PENDING OMENS 段单独断言
    const pendingOmensSection = systems.split("== PENDING OMENS")[1] ?? "";

    expect(mocks.prisma.omenQueue.findFirst).toHaveBeenCalledWith({
      where: { timelineId: "timeline-1", consumed: false, kind: "proactive" },
      orderBy: { createdAt: "asc" },
    });
    expect(systems).toContain("PROACTIVE DIVINE EVENT");
    expect(systems).toContain("潮神");
    expect(systems).toContain("潮神遣使者入梦");
    expect(pendingOmensSection).toContain("潮水连续三夜倒流");
    expect(pendingOmensSection).not.toContain("潮神遣使者入梦");
    expect(messages.consumedOmenIds).toEqual(["omen-1", "omen-2", "pro-1"]);
  });

  it("pantheon 玩家神 rank=ember 时组装消息含 EMBER REGISTER 低谷文体块", async () => {
    mocks.prisma.god.findMany.mockResolvedValue([{
      id: "god-player", name: "烬余之神", aliases: [], tier: "player", rank: "ember",
      domains: ["余烬"], persona: { origin: "旧火之裔", situation: "信众凋零" }, voice: null,
      relations: {}, faithScope: "灰谷", agenda: null, isPlayer: true,
    }]);

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "俯瞰灰谷",
      scale: "scene", mode: "say",
    });
    const systems = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");

    expect(systems).toContain("EMBER REGISTER");
    expect(systems).toContain("萤火视角");
  });

  it("rejects a chapter outside the world's active timeline before consuming events", async () => {
    vi.clearAllMocks();
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: "冻结世界", mode: "creator", activeTimelineId: "timeline-new",
      styleCard: {}, themeCard: {}, cosmology: {}, fusionAxiom: null, lorebookEntries: [],
    });
    mockChapter();

    await expect(buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "观察海潮",
      scale: "scene", mode: "say",
    })).rejects.toThrow("该现实已被冻结");
    expect(mocks.prisma.omenQueue.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.chronicleEntry.findMany).not.toHaveBeenCalled();
  });

  it("uses creator reality/observer state, full author-only knowledge, and unified intent labels", async () => {
    const deck = completeCreatorDeck();
    const reality = {
      ...initialRealityState(deck),
      currentEra: "覆潮第九纪",
      style: { ...deck.style, toneNotes: "REALITY_STYLE_OVERRIDE" },
      establishedFacts: [{ ref: "fact-star", text: "恒星已经熄灭", establishedByRewriteId: null }],
    };
    const observer = {
      ...initialObserverState(deck),
      focusType: "god" as const,
      focusId: "god-tide",
      timeLabel: "覆潮第九纪·暮刻",
      viewpoint: "limited" as const,
    };
    vi.clearAllMocks();
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: "创世观察界", mode: "creator", activeTimelineId: "timeline-1",
      styleCard: { ...deck.style, toneNotes: "STALE_WORLD_STYLE" },
      themeCard: deck.theme,
      cosmology: deck.cosmology,
      fusionAxiom: { sourceIps: ["旧设定甲", "旧设定乙"], axioms: ["STALE_FUSION_AXIOM"], powerMapping: "旧映射", conflictRule: "旧规则" },
      lorebookEntries: [],
    });
    mockChapter({
      timeline: { id: "timeline-1", realityState: reality, observerState: observer },
      messages: [{ role: "player", content: "看向潮神的密谋" }],
    });
    mocks.prisma.god.findMany.mockResolvedValue([{
      id: "god-tide", name: "潮神", aliases: [], tier: "major", rank: "nascent",
      domains: ["潮汐"], persona: { desire: "吞没港城" }, voice: { style: "低语" },
      relations: {}, faithScope: "海岸", agenda: { schemes: ["暗中决堤"] }, isPlayer: false,
    }, {
      id: "god-mist", name: "雾中小神", aliases: [], tier: "minor", rank: "ember",
      domains: ["迷雾"], persona: { desire: "藏匿" }, voice: { style: "呢喃" },
      relations: {}, faithScope: null, agenda: { schemes: ["遮蔽星门"] }, isPlayer: false,
    }]);
    mocks.prisma.omenQueue.findMany.mockResolvedValue([]);
    mocks.prisma.chronicleEntry.findMany
      .mockResolvedValueOnce([{ id: "hidden-1", text: "潮神已凿穿海堤", godIds: ["god-tide"], createdAt: new Date() }])
      .mockResolvedValueOnce([]);
    mocks.prisma.entity.findMany.mockResolvedValue([]);
    mocks.buildAbilityContext.mockResolvedValue("== AUTHOR-ONLY FULL ABILITIES ==\n潮神·覆潮");

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "追查潮神",
      scale: "scene", mode: "say",
    });
    const systems = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const user = messages.at(-1)?.content ?? "";

    expect(systems).toContain("REALITY_STYLE_OVERRIDE");
    expect(systems).not.toContain("STALE_WORLD_STYLE");
    expect(systems).not.toContain("STALE_FUSION_AXIOM");
    expect(systems).toContain("恒星已经熄灭");
    expect(systems).toContain("覆潮第九纪·暮刻");
    expect(systems).toContain("focusType");
    expect(systems).toContain("暗中决堤");
    expect(systems).toContain("遮蔽星门");
    expect(systems).toContain("潮神已凿穿海堤");
    expect(systems).toContain("AUTHOR-ONLY");
    expect(systems).not.toContain("INVESTIGATION ADJUDICATION");
    expect(user).toContain("【创世主意图】追查潮神");
    expect(user).not.toContain("【玩家神谕】");
    expect(mocks.buildAbilityContext).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: "timeline-1", viewer: "creator_author",
    }));
    expect(mocks.prisma.omenQueue.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.omenQueue.findFirst).not.toHaveBeenCalled();
    expect(messages.consumedOmenIds).toEqual([]);
    expect(mocks.prisma.chronicleEntry.findMany).toHaveBeenCalledWith({
      where: { timelineId: "timeline-1", revealed: false },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
  });

  it("uses creator opening directive without creating a player god", async () => {
    const deck = completeCreatorDeck();
    vi.clearAllMocks();
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: deck.worldName, mode: "creator", activeTimelineId: "timeline-1",
      styleCard: deck.style, themeCard: deck.theme, cosmology: deck.cosmology,
      fusionAxiom: deck.fusionAxiom, lorebookEntries: [],
    });
    mockChapter({
      timeline: {
        id: "timeline-1",
        realityState: initialRealityState(deck),
        observerState: initialObserverState(deck),
      },
      messages: [],
    });
    mocks.prisma.god.findMany.mockResolvedValue([]);
    mocks.prisma.omenQueue.findMany.mockResolvedValue([]);
    mocks.prisma.chronicleEntry.findMany.mockResolvedValue([]);
    mocks.prisma.entity.findMany.mockResolvedValue([]);
    mocks.buildAbilityContext.mockResolvedValue("—");

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", scale: "scene", mode: "opening",
    });
    const opening = messages.at(-1)?.content ?? "";
    expect(opening).toContain("present era");
    expect(opening).toContain("world-internal tension");
    expect(opening).not.toContain("player god's starting situation");
  });

  it("injects focused and scene-related world activity without forcing a scene switch", async () => {
    const deck = completeCreatorDeck();
    vi.clearAllMocks();
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: "潮汐界", mode: "creator", activeTimelineId: "timeline-1",
      styleCard: deck.style, themeCard: deck.theme, cosmology: deck.cosmology,
      fusionAxiom: deck.fusionAxiom, lorebookEntries: [],
    });
    mockChapter({
      timeline: {
        id: "timeline-1",
        realityState: initialRealityState(deck),
        observerState: {
          ...initialObserverState(deck),
          focusedEventId: "event-focus",
        },
      },
      messages: [{ role: "narrator", content: "林霁站在潮神庙前。" }],
    });
    mocks.prisma.god.findMany.mockResolvedValue([]);
    mocks.prisma.omenQueue.findMany.mockResolvedValue([]);
    mocks.prisma.chronicleEntry.findMany.mockResolvedValue([]);
    mocks.prisma.entity.findMany
      .mockResolvedValueOnce([{
        id: "entity-scene", name: "林霁", aliases: [], type: "character",
        scenePresence: true, heat: "active", isChosen: false, summary: "潮港信使",
        sections: [],
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.prisma.worldEvent.findMany.mockResolvedValue([{
      id: "event-focus",
      title: "潮港阴谋",
      summary: "议会仍在密谋。",
      phase: "developing",
      visibility: "hidden",
      participantIds: ["entity-scene"],
      updatedAt: new Date("2026-07-23T10:00:00.000Z"),
      resolvedAt: null,
    }]);
    mocks.prisma.worldActivity.findMany.mockResolvedValue([{
      id: "activity-hidden",
      eventId: "event-focus",
      recordType: "event_progress",
      kind: "conspiracy",
      text: "密使已抵达潮港。",
      visibility: "hidden",
      actorId: null,
      targetIds: [],
      subjectIds: ["entity-scene"],
      eraLabel: "潮汐纪",
      timeLabel: "暮刻",
      createdAt: new Date("2026-07-23T10:30:00.000Z"),
    }]);
    mocks.buildAbilityContext.mockResolvedValue("—");

    const messages = await buildNarratorContext({
      worldId: "world-1",
      chapterId: "chapter-1",
      playerInput: "观察神庙",
      scale: "scene",
      mode: "say",
    });
    const activityBlock = messages.find((message) =>
      message.role === "system" && message.content.startsWith("CURRENT WORLD ACTIVITY")
    )?.content;

    expect(activityBlock).toContain("event-focus");
    expect(activityBlock).toContain("entity-scene");
    expect(activityBlock).toContain("世界内尚未知晓");
    expect(activityBlock).toContain("关注只提高后续叙事权重，不要求切换当前场景");
    expect(messages.allowedEventIds).toEqual(["event-focus"]);
  });

  it("离席 ≥ 12h 后 continue 重入：注入 RE-ENTRY 块并复用租借征兆，位于 user 前最后一条 system", async () => {
    mockChapter({
      messages: [{
        role: "narrator", content: "林霁站在潮神庙前",
        createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
      }],
    });
    mocks.prisma.omenQueue.findMany.mockResolvedValue([
      { id: "omen-1", text: "潮水连续三夜倒流", createdAt: new Date() },
      { id: "omen-2", text: "灯塔火光转为青色", createdAt: new Date() },
    ]);

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", scale: "scene", mode: "continue",
    });

    const last = messages.at(-1);
    const reentry = messages.at(-2);
    expect(last?.role).toBe("user");
    expect(reentry?.role).toBe("system");
    expect(reentry?.content).toContain("RE-ENTRY AFTER ABSENCE");
    expect(reentry?.content).toContain("约 13 小时");
    expect(reentry?.content).toContain("潮水连续三夜倒流");
    expect(reentry?.content).toContain("灯塔火光转为青色");
  });

  it("离席不足 12h 不注入重入块", async () => {
    mockChapter({
      messages: [{
        role: "narrator", content: "林霁站在潮神庙前",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      }],
    });

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", scale: "scene", mode: "continue",
    });
    expect(messages.some((m) => m.content.includes("RE-ENTRY AFTER ABSENCE"))).toBe(false);
  });

  it("opening 模式即使 prevTail 陈旧也不注入重入块", async () => {
    mocks.prisma.chapter.findUnique.mockReset();
    mocks.prisma.chapter.findUnique
      .mockResolvedValueOnce({
        id: "chapter-2", timelineId: "timeline-1", index: 2,
        timeline: { id: "timeline-1", realityState: null, observerState: null },
        messages: [],
      })
      .mockResolvedValueOnce({
        id: "chapter-1", timelineId: "timeline-1", index: 1,
        messages: [{
          role: "narrator", content: "旧章结尾",
          createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
        }],
      });

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-2", scale: "scene", mode: "opening",
    });
    expect(messages.some((m) => m.content.includes("RE-ENTRY AFTER ABSENCE"))).toBe(false);
  });

  it("creator 离席重入：线索使用活跃事件标题", async () => {
    const deck = completeCreatorDeck();
    vi.clearAllMocks();
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: "潮汐界", mode: "creator", activeTimelineId: "timeline-1",
      styleCard: deck.style, themeCard: deck.theme, cosmology: deck.cosmology,
      fusionAxiom: deck.fusionAxiom, lorebookEntries: [],
    });
    mockChapter({
      timeline: {
        id: "timeline-1",
        realityState: initialRealityState(deck),
        observerState: initialObserverState(deck),
      },
      messages: [{
        role: "narrator", content: "林霁站在潮神庙前。",
        createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
      }],
    });
    mocks.prisma.god.findMany.mockResolvedValue([]);
    mocks.prisma.omenQueue.findMany.mockResolvedValue([]);
    mocks.prisma.chronicleEntry.findMany.mockResolvedValue([]);
    mocks.prisma.entity.findMany.mockResolvedValue([]);
    mocks.prisma.worldEvent.findMany.mockResolvedValue([{
      id: "event-focus",
      title: "潮港阴谋",
      summary: "议会仍在密谋。",
      phase: "developing",
      visibility: "public",
      participantIds: [],
      updatedAt: new Date("2026-07-23T10:00:00.000Z"),
      resolvedAt: null,
    }]);
    mocks.prisma.worldActivity.findMany.mockResolvedValue([]);
    mocks.buildAbilityContext.mockResolvedValue("—");

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "观察神庙",
      scale: "scene", mode: "say",
    });
    const reentry = messages.find((m) => m.content.includes("RE-ENTRY AFTER ABSENCE"));
    expect(reentry?.content).toContain("- 潮港阴谋");
  });

  it("线索为空时重入块要求虚构一条与 CURRENT WORLD ACTIVITY 一致的幕后发展", async () => {
    mockChapter({
      messages: [{
        role: "narrator", content: "林霁站在潮神庙前",
        createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
      }],
    });

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", scale: "scene", mode: "continue",
    });
    const reentry = messages.find((m) => m.content.includes("RE-ENTRY AFTER ABSENCE"));
    expect(reentry?.content).toContain(
      "No specific thread is supplied — invent one small, concrete offstage development consistent with CURRENT WORLD ACTIVITY.",
    );
  });

  it("era_digest 存在时注入 ERA DIGESTS 常驻总纲，其余条目列于 RECENT & RELATED ENTRIES", async () => {
    mocks.prisma.chronicleEntry.findMany.mockImplementation(
      (args: { where?: { source?: unknown; revealed?: unknown } } = {}) => {
        if (args.where?.source === "era_digest") {
          return Promise.resolve([{
            id: "digest-1", yearLabel: "第一纪", text: "第一纪总纲：潮起覆城，诸神初醒。",
            entityIds: [], createdAt: new Date(),
          }]);
        }
        if (args.where?.revealed === true) {
          return Promise.resolve([{
            id: "entry-1", yearLabel: "第二纪·三年", text: "港城重建",
            entityIds: [], createdAt: new Date(),
          }]);
        }
        return Promise.resolve([]);
      },
    );

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const chronicle = messages.find((m) =>
      m.role === "system" && m.content.startsWith("CHRONICLE"),
    )?.content ?? "";

    expect(chronicle).toContain("ERA DIGESTS (one line per closed era, oldest first — binding long-memory):");
    expect(chronicle).toContain("[第一纪] 第一纪总纲：潮起覆城，诸神初醒。");
    expect(chronicle).toContain("RECENT & RELATED ENTRIES:");
    expect(chronicle).toContain("[第二纪·三年] 港城重建");
  });

  it("无 era_digest 时编年史块保持原有格式，不含子标题", async () => {
    mocks.prisma.chronicleEntry.findMany.mockImplementation(
      (args: { where?: { source?: unknown; revealed?: unknown } } = {}) => {
        if (args.where?.revealed === true) {
          return Promise.resolve([{
            id: "entry-1", yearLabel: "第二纪·三年", text: "港城重建",
            entityIds: [], createdAt: new Date(),
          }]);
        }
        return Promise.resolve([]);
      },
    );

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const chronicle = messages.find((m) =>
      m.role === "system" && m.content.startsWith("CHRONICLE"),
    )?.content ?? "";

    expect(chronicle).toContain("CHRONICLE (what history records so far):\n[第二纪·三年] 港城重建");
    expect(chronicle).not.toContain("ERA DIGESTS");
    expect(chronicle).not.toContain("RECENT & RELATED ENTRIES");
  });

  it("PREVIOUSLY 前情回注：既往章节小结按 oldest-first 注入", async () => {
    mocks.prisma.chapter.findMany.mockResolvedValue([
      { index: 2, summary: "前情A：潮神决堤" },
      { index: 1, summary: "前情B：港城初立" },
    ]);

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });

    expect(mocks.prisma.chapter.findMany).toHaveBeenCalledWith({
      where: { timelineId: "timeline-1", index: { lt: 1 }, summary: { not: null } },
      orderBy: { index: "desc" },
      take: 3,
      select: { index: true, summary: true },
    });
    const block = messages.find((m) =>
      m.role === "system" && m.content.startsWith("== PREVIOUSLY"),
    )?.content ?? "";
    expect(block).toContain("== PREVIOUSLY (chronicler's recaps of earlier checkpoints, oldest to newest) ==");
    expect(block.indexOf("前情B：港城初立")).toBeGreaterThan(0);
    expect(block.indexOf("前情B：港城初立")).toBeLessThan(block.indexOf("前情A：潮神决堤"));
  });

  it("character 实体卡附 relations 行：仅上下文内目标，note 截 40 字", async () => {
    mocks.prisma.entity.findMany.mockResolvedValue([
      {
        id: "ent-lin", name: "林霁", aliases: [], type: "character",
        scenePresence: true, heat: "active", isChosen: false, summary: "潮港信使", sections: [],
      },
      {
        id: "ent-guard", name: "白鹭卫", aliases: [], type: "character",
        scenePresence: true, heat: "active", isChosen: false, summary: "港城卫队长", sections: [],
      },
    ]);
    mocks.prisma.entityRelation.findMany.mockResolvedValue([
      { sourceEntityId: "ent-lin", targetEntityId: "ent-guard", label: "护卫之誓", note: "誓死护卫其航路" },
      { sourceEntityId: "ent-lin", targetEntityId: "ent-out", label: "旧识", note: "上下文外目标应被过滤" },
    ]);

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const cards = messages.find((m) =>
      m.role === "system" && m.content.startsWith("CODEX CARDS"),
    )?.content ?? "";

    expect(mocks.prisma.entityRelation.findMany).toHaveBeenCalledWith({
      where: { timelineId: "timeline-1", sourceEntityId: { in: ["ent-lin", "ent-guard"] } },
      select: { sourceEntityId: true, targetEntityId: true, label: true, note: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    expect(cards).toContain("relations: →(护卫之誓) 白鹭卫：誓死护卫其航路");
    expect(cards).not.toContain("旧识");
  });

  it("relations 行累计超 600 字预算后，后续实体卡不再附关系行", async () => {
    const longLabel = "誓约".repeat(80); // 160 字 × 4 行 > 600 字预算
    mocks.prisma.entity.findMany.mockResolvedValue([
      {
        id: "ent-a", name: "甲士", aliases: [], type: "character",
        scenePresence: true, heat: "active", isChosen: false, summary: "甲之卡", sections: [],
      },
      {
        id: "ent-b", name: "乙士", aliases: [], type: "character",
        scenePresence: true, heat: "active", isChosen: false, summary: "乙之卡", sections: [],
      },
      {
        id: "ent-c", name: "丙士", aliases: [], type: "character",
        scenePresence: true, heat: "active", isChosen: false, summary: "丙之卡", sections: [],
      },
    ]);
    mocks.prisma.entityRelation.findMany.mockResolvedValue([
      { sourceEntityId: "ent-a", targetEntityId: "ent-b", label: longLabel, note: "一" },
      { sourceEntityId: "ent-a", targetEntityId: "ent-c", label: longLabel, note: "二" },
      { sourceEntityId: "ent-a", targetEntityId: "ent-b", label: longLabel, note: "三" },
      { sourceEntityId: "ent-a", targetEntityId: "ent-c", label: longLabel, note: "四" },
      { sourceEntityId: "ent-c", targetEntityId: "ent-a", label: "同盟", note: "丙依附甲" },
    ]);

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const cards = messages.find((m) =>
      m.role === "system" && m.content.startsWith("CODEX CARDS"),
    )?.content ?? "";

    expect(cards).toContain(`→(${longLabel}) 乙士：一`);
    expect(cards).not.toContain("→(同盟)");
  });

  it("probe carry：上轮叙事 META 自报 probe_attempted 时，无查探词输入也注入裁决块", async () => {
    mockChapter({
      messages: [
        { role: "player", content: "我登上灯塔" },
        { role: "narrator", content: "灯塔之上风声呜咽", meta: { probeAttempted: true } },
      ],
    });
    mocks.prisma.chronicleEntry.findMany.mockImplementation(
      (args: { where?: { source?: unknown; revealed?: unknown } } = {}) => {
        if (args.where?.revealed === false) {
          return Promise.resolve([{
            id: "hidden-1", text: "潮神已凿穿海堤", godIds: [], createdAt: new Date(),
          }]);
        }
        return Promise.resolve([]);
      },
    );

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "沿堤岸散步",
      scale: "scene", mode: "say",
    });
    const systems = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    expect(systems).toContain("== INVESTIGATION ADJUDICATION ==");
    expect(systems).toContain("潮神已凿穿海堤");
  });

  it("无 carry 且无查探词时不注入裁决块", async () => {
    mockChapter({
      messages: [
        { role: "narrator", content: "灯塔之上风声呜咽", meta: { probeAttempted: false } },
      ],
    });
    mocks.prisma.chronicleEntry.findMany.mockImplementation(
      (args: { where?: { source?: unknown; revealed?: unknown } } = {}) => {
        if (args.where?.revealed === false) {
          return Promise.resolve([{
            id: "hidden-1", text: "潮神已凿穿海堤", godIds: [], createdAt: new Date(),
          }]);
        }
        return Promise.resolve([]);
      },
    );

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "沿堤岸散步",
      scale: "scene", mode: "say",
    });
    const systems = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    // 输出契约中的 probe 规则会提及该词组，故断言块标题而非裸词
    expect(systems).not.toContain("== INVESTIGATION ADJUDICATION ==");
    expect(systems).not.toContain("潮神已凿穿海堤");
  });

  describe("时间锚点契约：新契约世界的叙事时间纪律（设计稿 §12）", () => {
  const anchoredDraftDeck = {
    temporalAnchor: {
      source: {
        basis: "single_ip",
        sourceIps: ["测试原作"],
        continuity: "原著小说线",
        continuitySource: "model_inferred",
        ambiguityNotes: [],
      },
      anchor: {
        anchorType: "main_story_opening",
        currentTimeLabel: "帝国历 998 年冬",
        currentEraLabel: "帝国历晚期",
        anchorEvent: "就在黑船叩港的前夜",
        canonCutoff: "主线大战爆发之前",
        selectionSource: "model_inferred",
        confidence: "high",
        assumptions: [],
      },
      anchorOrdinal: 0,
    },
    epochConflict: { epochName: "旧回退纪元", yearLabel: "旧回退时刻" },
  };

  function mockAnchoredWorld() {
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: "锚定世界", mode: "pantheon", activeTimelineId: "timeline-1",
      styleCard: null, themeCard: null, cosmology: null, fusionAxiom: null,
      draftDeck: anchoredDraftDeck, lorebookEntries: [],
    });
  }

  it("现实/观察状态齐备时注入锚点回合头（锚点事件 + 截止点 + 毯式规则）", async () => {
    const deck = completeDeck();
    mockAnchoredWorld();
    mockChapter({
      timeline: {
        id: "timeline-1",
        realityState: {
          ...initialRealityState(deck),
          currentEra: "帝国历晚期",
          anchorOrdinal: 0,
          canonCutoff: "主线大战爆发之前",
        },
        observerState: { ...initialObserverState(deck), timeLabel: "帝国历 998 年冬" },
      },
    });

    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const systems = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");

    expect(systems).toContain("Era: 帝国历晚期");
    expect(systems).toContain("Time: 帝国历 998 年冬");
    expect(systems).not.toContain("旧回退纪元");
    expect(systems).toContain("Anchor event (this play began at this moment): 就在黑船叩港的前夜");
    expect(systems).toContain("Canon cutoff (原作知识截止点): 主线大战爆发之前");
    expect(systems).toContain("截止点之后的原作事件在本世界尚未发生，除非它已在本局中发生。");
  });

  it("新契约世界现实状态缺失时 fail-fast，不再回退未名纪元", async () => {
    mockAnchoredWorld();
    mockChapter(); // realityState: null → 回退路径已被禁用

    await expect(buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    })).rejects.toThrow("新契约世界的现实状态缺少 currentEra");
  });

  it("新契约世界观察时间缺失时 fail-fast，不再回退此刻", async () => {
    const deck = completeDeck();
    mockAnchoredWorld();
    mockChapter({
      timeline: {
        id: "timeline-1",
        realityState: { ...initialRealityState(deck), anchorOrdinal: 0 },
        observerState: null,
      },
    });

    await expect(buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    })).rejects.toThrow("新契约世界的观察状态缺少 timeLabel");
  });

  it("旧世界（无锚点）保持未名纪元/此刻回退且不出现锚点行", async () => {
    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "巡视港城",
      scale: "scene", mode: "say",
    });
    const systems = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");

    expect(systems).toContain("Era: 未名纪元");
    expect(systems).toContain("Time: 此刻");
    expect(systems).not.toContain("Anchor event");
    expect(systems).not.toContain("截止点之后的原作事件在本世界尚未发生");
  });
  });
});

describe("buildReentryBlock", () => {
  const HOUR = 60 * 60 * 1000;

  it("不足阈值（12h）返回 null（自带守卫，供 world-director 内核直接重挂）", () => {
    expect(buildReentryBlock({ mode: "pantheon", absenceMs: 11 * HOUR, threads: [] }))
      .toBeNull();
  });

  it("47h 用小时标注，49h 起用天标注", () => {
    const hours = buildReentryBlock({ mode: "pantheon", absenceMs: 47 * HOUR, threads: ["潮水倒流"] });
    expect(hours).toContain("约 47 小时");
    const days = buildReentryBlock({ mode: "creator", absenceMs: 49 * HOUR, threads: ["潮水倒流"] });
    expect(days).toContain("约 2 天");
    expect(days).not.toContain("小时");
  });

  it("线索至多保留 2 条并以 '- ' 列出", () => {
    const block = buildReentryBlock({
      mode: "pantheon",
      absenceMs: 13 * HOUR,
      threads: ["潮水倒流", "灯塔青焰", "第三条应被裁掉"],
    });
    expect(block).toContain("- 潮水倒流");
    expect(block).toContain("- 灯塔青焰");
    expect(block).not.toContain("第三条应被裁掉");
  });
});
