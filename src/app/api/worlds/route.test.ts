import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";

const mocks = vi.hoisted(() => ({
  completeStructured: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  timelineFindMany: vi.fn(),
  worldEventFindFirst: vi.fn(),
  worldActivityFindMany: vi.fn(),
}));

vi.mock("@/lib/llm/structured", () => ({
  completeStructured: mocks.completeStructured,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    world: {
      create: mocks.create,
      findMany: mocks.findMany,
    },
    timeline: { findMany: mocks.timelineFindMany },
    worldEvent: { findFirst: mocks.worldEventFindFirst },
    worldActivity: { findMany: mocks.worldActivityFindMany },
  },
}));

import { GET, POST } from "./route";

function creatorDeck() {
  const { playerGod: _playerGod, ...shared } = completeDeck();
  void _playerGod;
  return CreatorWorldDeckSchema.parse({
    ...shared,
    mode: "creator",
    majorGods: shared.majorGods.map(({
      agenda,
      initialRelationToPlayer: _initialRelationToPlayer,
      ...god
    }, index, gods) => {
      void _initialRelationToPlayer;
      return {
        ...god,
        agenda: {
          longTermGoal: agenda.longTermGoal,
          shortTermGoals: agenda.shortTermGoals,
          methods: agenda.methods,
          schemes: agenda.schemes,
        },
        relations: [{
          targetGodRef: gods[(index + 1) % gods.length]!.ref,
          label: "rival",
          note: "世界内诸神竞争",
        }],
      };
    }),
  });
}

function request(mode?: "pantheon" | "creator") {
  return new Request("http://localhost/api/worlds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decree: "创造星海神域", ...(mode ? { mode } : {}) }),
  });
}

describe("/api/worlds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "world-1" });
    mocks.timelineFindMany.mockResolvedValue([]);
    mocks.worldEventFindFirst.mockResolvedValue(null);
    mocks.worldActivityFindMany.mockResolvedValue([]);
  });

  it("creator 请求使用精确 schema、prompt 并持久化相同模式", async () => {
    const creator = creatorDeck();
    mocks.completeStructured.mockResolvedValue(creator);

    const response = await POST(request("creator"));

    expect(response.status).toBe(200);
    expect(mocks.completeStructured).toHaveBeenCalledWith(
      "narrative",
      expect.objectContaining({
        schema: CreatorWorldDeckSchema,
        system: expect.stringContaining('mode="creator"'),
        user: expect.stringContaining('mode="creator"'),
      }),
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "creator" }),
    }));
  });

  it("拒绝生成结果与请求模式不一致且绝不持久化", async () => {
    const creator = creatorDeck();
    mocks.completeStructured.mockImplementation(async (
      _slot: unknown,
      options: { schema: { parse(value: unknown): unknown } },
    ) => options.schema.parse(creator));

    const response = await POST(request("pantheon"));

    expect(response.status).toBe(502);
    expect(mocks.completeStructured).toHaveBeenCalledWith(
      "narrative",
      expect.objectContaining({ schema: PantheonWorldDeckSchema }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });


  it("malformed JSON 返回 400 且不调用模型或创建世界", async () => {
    const response = await POST(new Request("http://localhost/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"decree":',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "创世请求无效" });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("拒绝未知世界模式", async () => {
    const response = await POST(new Request("http://localhost/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decree: "创造星海神域", mode: "absolute" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("成功创建时显式持久化 pantheon 模式", async () => {
    mocks.completeStructured.mockResolvedValue(completeDeck());

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "pantheon" }),
    }));
  });

  it("GET 存档列表显式查询 mode", async () => {
    mocks.findMany.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ mode: true }),
    }));
  });
});

type WorldsListRow = Record<string, unknown> & {
  statusLine?: {
    timelineId: string;
    era: string;
    time: string;
    trackedEventTitle: string | null;
    recentActivityRefs: { id: string; createdAt: string }[];
  };
};

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "world-play",
    mode: "pantheon",
    name: "进行中的世界",
    genesisInput: "创造潮汐神域",
    status: "playing",
    materialArchiveStatus: "idle",
    materialArchiveError: null,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-25T00:00:00.000Z"),
    ...overrides,
  };
}

async function worldsOf(response: Response): Promise<WorldsListRow[]> {
  const json = await response.json() as { worlds: WorldsListRow[] };
  return json.worlds;
}

describe("GET /api/worlds statusLine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timelineFindMany.mockResolvedValue([]);
    mocks.worldEventFindFirst.mockResolvedValue(null);
    mocks.worldActivityFindMany.mockResolvedValue([]);
  });

  it("仅为有活动时间线的 playing 世界附加 statusLine，且首页契约字段不变", async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        listRow({ id: "world-draft", status: "draft" }),
        listRow({ id: "world-play", status: "playing" }),
      ])
      .mockResolvedValueOnce([{
        id: "world-play",
        draftDeck: { epochConflict: { epochName: "潮汐纪", yearLabel: "第七年" } },
        themeCard: { eraSystem: "潮历" },
        activeTimelineId: "tl-1",
      }]);
    mocks.timelineFindMany.mockResolvedValue([{
      id: "tl-1",
      realityState: { currentEra: "覆潮纪" },
      observerState: { timeLabel: "暮刻" },
    }]);
    mocks.worldEventFindFirst.mockResolvedValue({ title: "潮港阴谋" });
    mocks.worldActivityFindMany.mockResolvedValue([
      { id: "act-1", createdAt: new Date("2026-07-25T10:00:00.000Z") },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const worlds = await worldsOf(response);

    const draftRow = worlds.find((w) => w.id === "world-draft")!;
    const playRow = worlds.find((w) => w.id === "world-play")!;
    expect("statusLine" in draftRow).toBe(false);
    expect(playRow.statusLine).toEqual({
      timelineId: "tl-1",
      era: "覆潮纪",
      time: "暮刻",
      trackedEventTitle: "潮港阴谋",
      recentActivityRefs: [{ id: "act-1", createdAt: "2026-07-25T10:00:00.000Z" }],
    });
    // 首页续玩入口契约（src/app/page.tsx LastWorld）：id/name/status/updatedAt 原样保留
    expect(playRow).toMatchObject({
      id: "world-play",
      name: "进行中的世界",
      status: "playing",
      updatedAt: "2026-07-25T00:00:00.000Z",
    });
    expect(mocks.findMany).toHaveBeenNthCalledWith(1, {
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        mode: true,
        name: true,
        genesisInput: true,
        status: true,
        materialArchiveStatus: true,
        materialArchiveError: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it("realityState 为空时 era/time 回退到 draftDeck.epochConflict", async () => {
    mocks.findMany
      .mockResolvedValueOnce([listRow()])
      .mockResolvedValueOnce([{
        id: "world-play",
        draftDeck: { epochConflict: { epochName: "潮汐纪", yearLabel: "第七年" } },
        themeCard: { eraSystem: "潮历" },
        activeTimelineId: "tl-1",
      }]);
    mocks.timelineFindMany.mockResolvedValue([{
      id: "tl-1", realityState: null, observerState: null,
    }]);

    const worlds = await worldsOf(await GET());
    expect(worlds[0]!.statusLine).toMatchObject({ era: "潮汐纪", time: "第七年" });
  });

  it("无未解决公开事件时 trackedEventTitle 为 null；无活动时间线的 playing 世界不带 statusLine", async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        listRow({ id: "world-timeless" }),
        listRow({ id: "world-play" }),
      ])
      .mockResolvedValueOnce([
        { id: "world-timeless", draftDeck: null, themeCard: null, activeTimelineId: null },
        { id: "world-play", draftDeck: null, themeCard: null, activeTimelineId: "tl-1" },
      ]);
    mocks.timelineFindMany.mockResolvedValue([{
      id: "tl-1", realityState: null, observerState: null,
    }]);
    mocks.worldEventFindFirst.mockResolvedValue(null);

    const worlds = await worldsOf(await GET());
    const timeless = worlds.find((w) => w.id === "world-timeless")!;
    const playing = worlds.find((w) => w.id === "world-play")!;
    expect("statusLine" in timeless).toBe(false);
    expect(playing.statusLine).toMatchObject({ trackedEventTitle: null });
  });

  it("动态引用查询上限 30 条且按玩家可见性过滤（与 activities 路由一致）", async () => {
    mocks.findMany
      .mockResolvedValueOnce([listRow()])
      .mockResolvedValueOnce([{
        id: "world-play", draftDeck: null, themeCard: null, activeTimelineId: "tl-1",
      }]);
    mocks.timelineFindMany.mockResolvedValue([{
      id: "tl-1", realityState: null, observerState: null,
    }]);

    await GET();
    expect(mocks.worldActivityFindMany).toHaveBeenCalledWith({
      where: { timelineId: "tl-1", visibility: { in: ["public", "player_known"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
      select: { id: true, createdAt: true },
    });
    expect(mocks.worldEventFindFirst).toHaveBeenCalledWith({
      where: {
        timelineId: "tl-1",
        phase: { not: "resolved" },
        visibility: { in: ["public", "player_known"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { title: true },
    });
  });
});
