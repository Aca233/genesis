import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  worldFindUnique: vi.fn(),
  timelineFindUnique: vi.fn(),
  chapterFindUnique: vi.fn(),
  chapterFindMany: vi.fn(),
  godFindMany: vi.fn(),
  entityFindMany: vi.fn(),
  rewriteFindFirst: vi.fn(),
  generationRequestFindFirst: vi.fn(),
  iconAssignmentFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findFirst: mocks.worldFindUnique, findUnique: mocks.worldFindUnique },
    timeline: { findUnique: mocks.timelineFindUnique },
    chapter: {
      findUnique: mocks.chapterFindUnique,
      findMany: mocks.chapterFindMany,
    },
    god: { findMany: mocks.godFindMany },
    entity: { findMany: mocks.entityFindMany },
    realityRewrite: { findFirst: mocks.rewriteFindFirst },
    generationRequest: { findFirst: mocks.generationRequestFindFirst },
    iconAssignment: { findMany: mocks.iconAssignmentFindMany },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
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
  focusedEventId: null,
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
  iconTheme: null,
  iconThemeRevision: 0,
  draftDeck: null,
  operationKind: null,
  operationLeaseExpiresAt: null,
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
    mocks.chapterFindUnique.mockResolvedValue(null);
    mocks.chapterFindMany.mockResolvedValue([{
      id: "chapter-1",
      index: 1,
      title: "初燃",
      settleState: "open",
      messages: [],
    }]);
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
      updatedAt: new Date("2026-07-22T00:00:00.000Z"),
      error: null,
      plan: null,
    });
    mocks.generationRequestFindFirst.mockResolvedValue(null);
    mocks.iconAssignmentFindMany.mockResolvedValue([
      {
        subjectType: "god",
        subjectId: "god-moon",
        token: "divinity.pantheon",
        source: "player",
        playerLocked: true,
      },
      {
        subjectType: "ability",
        subjectId: "ability-hidden",
        token: "ability.ritual",
        source: "generated",
        playerLocked: false,
      },
    ]);
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
      iconAssignment: {
        token: "divinity.pantheon",
        source: "player",
        playerLocked: true,
        icon: { body: expect.stringContaining("<") },
      },
      agenda: { schemes: ["遮蔽星门"] },
      agendaRevealed: false,
      relations: { "god-sun": { label: "rival" } },
      abilities: [{
        name: "暗潮神权",
        visibility: "hidden",
        worldVisible: false,
        effect: "令海潮吞没一段历史",
        iconAssignment: {
          token: "ability.ritual",
          source: "generated",
          playerLocked: false,
          icon: { body: expect.stringContaining("<") },
        },
      }],
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
      abilities: [expect.objectContaining({ name: "暗潮神权", visibility: "hidden", worldVisible: false })],
    })]);
  });

  it("在状态读取边界把旧融合公理归一为 canonical shape", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      fusionAxiom: {
        sourceIps: ["甲", "乙"],
        axioms: ["旧公理"],
        powerMapping: "旧力量对标",
        conflictRule: "以甲为准",
      },
    });

    const body = await (await GET(
      new Request("http://localhost/api/worlds/world-1/state"),
      context,
    )).json();

    expect(body.world.fusionAxiom).toEqual({
      sourceIps: ["甲", "乙"],
      establishedRules: ["旧公理"],
      openQuestions: ["旧力量对标"],
      hardLimits: ["旧版融合公理未记录明确限制"],
      conflictRule: "以甲为准",
    });
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

  it("下发失败聊天任务的安全 durable 摘要而不暴露私有输出", async () => {
    mocks.generationRequestFindFirst.mockResolvedValue({
      id: "generation-1",
      stage: "applying",
      status: "failed",
      retryable: true,
      safeError: "叙事任务中断，请从当前步骤重试",
      stageUpdatedAt: new Date("2026-07-23T00:00:00.000Z"),
      leaseExpiresAt: null,
      outputSnapshot: { prose: "不应下发" },
      error: "database password",
    });
    const response = await GET(new Request("http://localhost"), context);
    const body = await response.json();

    expect(body.taskProgress).toEqual({
      taskKind: "chat",
      taskId: "generation-1",
      stage: "applying",
      status: "failed",
      retryable: true,
      safeError: "叙事任务中断，请从当前步骤重试",
      updatedAt: "2026-07-23T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("不应下发");
    expect(JSON.stringify(body)).not.toContain("database password");
  });

  it("把过期的 pending generation 投影为当前阶段可重试失败", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      operationKind: "chat",
      operationLeaseExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    mocks.generationRequestFindFirst.mockResolvedValue({
      id: "generation-expired",
      stage: "generating",
      status: "pending",
      retryable: true,
      safeError: null,
      stageUpdatedAt: new Date("2026-07-23T01:00:00.000Z"),
      leaseExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    const body = await (await GET(new Request("http://localhost"), context)).json();

    expect(body.taskProgress).toEqual({
      taskKind: "chat",
      taskId: "generation-expired",
      stage: "generating",
      status: "failed",
      retryable: true,
      safeError: "叙事生成执行租约已过期，请从当前步骤重试",
      updatedAt: "2026-07-23T01:00:00.000Z",
    });
    expect(body.operation).toBeNull();
  });

  it("有效的 generation 与世界操作租约仍投影为 running", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      operationKind: "chat",
      operationLeaseExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    mocks.generationRequestFindFirst.mockResolvedValue({
      id: "generation-live",
      stage: "generating",
      status: "pending",
      retryable: true,
      safeError: null,
      stageUpdatedAt: new Date("2026-07-23T01:00:00.000Z"),
      leaseExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });

    const body = await (await GET(new Request("http://localhost"), context)).json();

    expect(body.taskProgress).toMatchObject({
      taskKind: "chat",
      taskId: "generation-live",
      stage: "generating",
      status: "running",
    });
    expect(body.operation).toEqual({ kind: "chat" });
  });

  it("把过期的 settlement 世界租约投影为当前阶段可重试失败", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      operationKind: "settlement",
      operationLeaseExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
    });
    mocks.chapterFindMany.mockResolvedValue([{
      id: "chapter-1",
      index: 1,
      title: "初燃",
      settleState: "settling:extract",
      settleError: null,
      settleRetryable: true,
      settleUpdatedAt: new Date("2026-07-23T02:00:00.000Z"),
      createdAt: new Date("2026-07-23T00:00:00.000Z"),
      messages: [],
    }]);

    const body = await (await GET(new Request("http://localhost"), context)).json();

    expect(body.taskProgress).toEqual({
      taskKind: "settlement",
      taskId: "chapter-1",
      stage: "extract",
      status: "failed",
      retryable: true,
      safeError: "世界整理执行租约已过期，请从当前步骤重试",
      updatedAt: "2026-07-23T02:00:00.000Z",
    });
    expect(body.checkpoint.settling).toBe(false);
    expect(body.operation).toBeNull();
  });

  it("有效的 settlement 世界租约仍投影为 running", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      operationKind: "settlement",
      operationLeaseExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    mocks.chapterFindMany.mockResolvedValue([{
      id: "chapter-1",
      index: 1,
      title: "初燃",
      settleState: "settling:chronicle",
      settleError: null,
      settleRetryable: true,
      settleUpdatedAt: new Date("2026-07-23T02:00:00.000Z"),
      createdAt: new Date("2026-07-23T00:00:00.000Z"),
      messages: [],
    }]);

    const body = await (await GET(new Request("http://localhost"), context)).json();

    expect(body.taskProgress).toMatchObject({
      taskKind: "settlement",
      taskId: "chapter-1",
      stage: "chronicle",
      status: "running",
    });
    expect(body.checkpoint.settling).toBe(true);
    expect(body.operation).toEqual({ kind: "settlement" });
  });

  it("把 settlement 的内部 done 步骤投影为公开 completed 阶段", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      operationKind: "settlement",
      operationLeaseExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    mocks.chapterFindMany.mockResolvedValue([{
      id: "chapter-1",
      index: 1,
      title: "初燃",
      settleState: "settling:done",
      settleError: null,
      settleRetryable: true,
      settleUpdatedAt: new Date("2026-07-23T02:00:00.000Z"),
      createdAt: new Date("2026-07-23T00:00:00.000Z"),
      messages: [],
    }]);

    const body = await (await GET(new Request("http://localhost"), context)).json();

    expect(body.taskProgress).toMatchObject({
      taskKind: "settlement",
      taskId: "chapter-1",
      stage: "completed",
      status: "running",
    });
  });

  it("把 settlement 的内部模型租约投影为公开 pantheon 阶段", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      ...worldFixture,
      operationKind: "settlement",
      operationLeaseExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    mocks.chapterFindMany.mockResolvedValue([{
      id: "chapter-1",
      index: 1,
      title: "初燃",
      settleState: "settling:model:1780000000000:private-token",
      settleError: null,
      settleRetryable: true,
      settleUpdatedAt: new Date("2026-07-23T02:00:00.000Z"),
      createdAt: new Date("2026-07-23T00:00:00.000Z"),
      messages: [],
    }]);

    const body = await (await GET(new Request("http://localhost"), context)).json();

    expect(body.taskProgress).toMatchObject({
      taskKind: "settlement",
      taskId: "chapter-1",
      stage: "pantheon",
      status: "running",
    });
    expect(JSON.stringify(body)).not.toContain("private-token");
  });

  it("连续返回最近四个内部记录段且只允许编辑当前开放段", async () => {
    const segments = [0, 1, 2, 3, 4].map((index) => ({
      id: `segment-${index}`,
      index,
      title: null,
      settleState: index === 4 ? "open" : "settled",
      messages: [{
        id: `message-${index}`,
        chapterId: `segment-${index}`,
        index: 0,
        role: "narrator",
        content: `正文-${index}`,
        scale: "scene",
        meta: null,
      }],
    }));
    mocks.chapterFindUnique.mockResolvedValue(segments[3]);
    mocks.chapterFindMany.mockResolvedValue([...segments].reverse().slice(0, 4));

    const body = await (await GET(
      new Request("http://localhost/api/worlds/world-1/state"),
      context,
    )).json();

    expect(body.messages.map((message: { content: string }) => message.content))
      .toEqual(["正文-1", "正文-2", "正文-3", "正文-4"]);
    expect(body.messages.map((message: { editable: boolean }) => message.editable))
      .toEqual([false, false, false, true]);
  });
});
