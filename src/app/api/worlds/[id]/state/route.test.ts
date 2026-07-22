import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  worldFindUnique: vi.fn(),
  timelineFindUnique: vi.fn(),
  chapterFindFirst: vi.fn(),
  chapterFindUnique: vi.fn(),
  godFindMany: vi.fn(),
  entityFindMany: vi.fn(),
  rewriteFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findUnique: mocks.worldFindUnique },
    timeline: { findUnique: mocks.timelineFindUnique },
    chapter: {
      findFirst: mocks.chapterFindFirst,
      findUnique: mocks.chapterFindUnique,
    },
    god: { findMany: mocks.godFindMany },
    entity: { findMany: mocks.entityFindMany },
    realityRewrite: { findFirst: mocks.rewriteFindFirst },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };
const hiddenAbility = {
  id: "ability-hidden",
  name: "暗潮神权",
  kind: "divine",
  effect: "令海潮吞没一段历史",
  trigger: "月蚀",
  cost: "一座神庙",
  limitations: "仅限沿海",
  mastery: "expert",
  state: "normal",
  visibility: "hidden",
  rumorText: null,
  bloodlineJustification: null,
  sourceAbilityId: null,
  lockedFields: [],
  version: 1,
};
const observer = (viewpoint: "omniscient" | "limited") => ({
  focusType: "world",
  focusId: null,
  timeLabel: "星海元年",
  viewpoint,
  activeAvatarId: null,
});
const worldFixture = {
  id: "world-1",
  name: "星海",
  mode: "creator",
  status: "playing",
  activeTimelineId: "timeline-1",
  genesisInput: "创世",
  themeCard: null,
  styleCard: null,
  cosmology: null,
  fusionAxiom: null,
  draftDeck: null,
};

describe("GET /api/worlds/[id]/state projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.worldFindUnique.mockResolvedValue(worldFixture);
    mocks.timelineFindUnique.mockResolvedValue({
      id: "timeline-1",
      branchName: "原初现实",
      branchSummary: "群星初燃",
      observerState: observer("omniscient"),
    });
    mocks.chapterFindFirst.mockResolvedValue({
      id: "chapter-1",
      index: 1,
      title: "初燃",
      messages: [],
    });
    mocks.chapterFindUnique.mockResolvedValue(null);
    mocks.godFindMany.mockResolvedValue([{
      id: "god-moon",
      name: "月神",
      tier: "major",
      isPlayer: false,
      rank: "exalted",
      domains: ["月"],
      persona: null,
      voice: null,
      faithScope: "海岸",
      relations: { "god-sun": { label: "rival", note: "争夺天空" } },
      agenda: { schemes: ["遮蔽星门"] },
      agendaRevealed: false,
      abilities: [hiddenAbility],
    }]);
    mocks.entityFindMany.mockResolvedValue([{
      id: "avatar-1",
      name: "星行者",
      summary: "群星在人间的旅者",
      heat: "active",
      raceId: null,
      scenePresence: false,
      sections: [
        { id: "section-identity", key: "identity", content: { text: "天外来客" }, revealed: false, rumorText: "无名旅者" },
        { id: "section-appearance", key: "appearance", content: { text: "银发星眸" }, revealed: true, rumorText: null },
      ],
      abilities: [hiddenAbility],
    }]);
    mocks.rewriteFindFirst.mockResolvedValue({
      id: "rewrite-1",
      decree: "令群星倒悬",
      scope: "prospective",
      status: "completed",
      summary: "群星轨迹已经改变",
      sourceTimelineId: "timeline-old",
      resultTimelineId: "timeline-1",
      createdAt: new Date("2026-07-22T00:00:00.000Z"),
    });
  });

  it("creator 全知状态返回分支元数据、隐藏议程、完整能力和最近改写", async () => {
    const response = await GET(new Request("http://localhost/api/worlds/world-1/state"), context);
    const body = await response.json();

    expect(body.world.mode).toBe("creator");
    expect(body.timeline).toEqual({
      id: "timeline-1",
      branchName: "原初现实",
      branchSummary: "群星初燃",
      observerState: observer("omniscient"),
    });
    expect(body.gods[0]).toMatchObject({
      agenda: { schemes: ["遮蔽星门"] },
      agendaRevealed: false,
      relations: { "god-sun": { label: "rival" } },
      abilities: [{ name: "暗潮神权", visibility: "known", effect: "令海潮吞没一段历史" }],
    });
    expect(body.recentRewrite).toMatchObject({ id: "rewrite-1", summary: "群星轨迹已经改变" });
    expect(body.avatars).toEqual([expect.objectContaining({
      id: "avatar-1",
      name: "星行者",
      heat: "active",
      sections: [
        expect.objectContaining({ key: "identity", content: { text: "天外来客" } }),
        expect.objectContaining({ key: "appearance", content: { text: "银发星眸" } }),
      ],
      abilities: [expect.objectContaining({ name: "暗潮神权", visibility: "known" })],
    })]);
  });

  it("creator 迷雾状态复用玩家安全投影", async () => {
    mocks.timelineFindUnique.mockResolvedValue({
      id: "timeline-1",
      branchName: "原初现实",
      branchSummary: null,
      observerState: observer("limited"),
    });

    const body = await (await GET(new Request("http://localhost/api/worlds/world-1/state"), context)).json();

    expect(body.gods[0].agenda).toBeNull();
    expect(body.gods[0].abilities).toEqual([]);
    expect(body.avatars[0].sections).toEqual([
      expect.objectContaining({ key: "identity", content: null }),
      expect.objectContaining({ key: "appearance", content: { text: "银发星眸" } }),
    ]);
    expect(body.avatars[0].abilities).toEqual([]);
  });

  it("pantheon 不能用查询参数伪造全知", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      mode: "pantheon",
    });

    const request = new Request("http://localhost/api/worlds/world-1/state?viewpoint=omniscient");
    const body = await (await GET(request, context)).json();

    expect(body.gods[0].agenda).toBeNull();
    expect(body.gods[0].abilities).toEqual([]);
    expect(body.avatars).toEqual([]);
  });
});
