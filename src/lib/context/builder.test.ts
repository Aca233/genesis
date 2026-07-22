import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck } from "@/lib/abilities/embark.test-fixtures";
import { initialObserverState, initialRealityState } from "@/lib/reality/schemas";

const mocks = vi.hoisted(() => ({
  prisma: {
    world: { findUnique: vi.fn() },
    chapter: { findUnique: vi.fn() },
    god: { findMany: vi.fn() },
    omenQueue: { findMany: vi.fn(), updateMany: vi.fn() },
    chronicleEntry: { findMany: vi.fn() },
    entity: { findMany: vi.fn() },
  },
  buildAbilityContext: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/abilities/context", () => ({
  buildAbilityContext: mocks.buildAbilityContext,
}));

import { buildNarratorContext } from "./builder";

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
    mocks.prisma.god.findMany.mockResolvedValue([]);
    mocks.prisma.omenQueue.findMany.mockResolvedValue([]);
    mocks.prisma.chronicleEntry.findMany.mockResolvedValue([]);
    mocks.prisma.entity.findMany.mockResolvedValue([]);
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

  it("uses creator reality/observer state, full author-only knowledge, and observation labels", async () => {
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
    expect(user).toContain("【天外观测】追查潮神");
    expect(user).not.toContain("【玩家神谕】");
    expect(mocks.buildAbilityContext).toHaveBeenCalledWith(expect.objectContaining({
      timelineId: "timeline-1", viewer: "creator_author",
    }));
    expect(mocks.prisma.omenQueue.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.chronicleEntry.findMany).toHaveBeenCalledWith({
      where: { timelineId: "timeline-1", revealed: false },
      orderBy: { createdAt: "desc" },
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
});
