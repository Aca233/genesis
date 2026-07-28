import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  worldFindUnique: vi.fn(),
  chapterFindMany: vi.fn(),
  chronicleFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findFirst: mocks.worldFindUnique },
    chapter: { findMany: mocks.chapterFindMany },
    chronicleEntry: { findMany: mocks.chronicleFindMany },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-user") }));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };
const request = new Request("http://localhost/api/worlds/world-1/checkpoints");

const settledAtTwo = new Date("2026-07-20T10:00:00.000Z");
const settledAtOne = new Date("2026-07-19T10:00:00.000Z");

describe("GET /api/worlds/[id]/checkpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.worldFindUnique.mockResolvedValue({ activeTimelineId: "tl-active" });
    mocks.chapterFindMany.mockImplementation((args: { where: { snapshot?: unknown } }) => {
      if (args.where.snapshot !== undefined) {
        return Promise.resolve([{ id: "ch-2" }]);
      }
      return Promise.resolve([
        { id: "ch-2", index: 2, title: null, summary: null, settleUpdatedAt: settledAtTwo },
        { id: "ch-1", index: 1, title: "初章", summary: "始", settleUpdatedAt: settledAtOne },
      ]);
    });
    mocks.chronicleFindMany.mockResolvedValue([
      { chapterIndex: 1, yearLabel: "", text: "山川初定，众神未名。" },
      { chapterIndex: 1, yearLabel: "洪典元年", text: "第二条不作节选。" },
      { chapterIndex: 2, yearLabel: "洪典二年", text: "赤月初升。" },
    ]);
  });

  it("404s when the world is missing or has no active timeline", async () => {
    mocks.worldFindUnique.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(404);

    mocks.worldFindUnique.mockResolvedValue({ activeTimelineId: null });
    const response = await GET(request, context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "世界不存在" });
  });

  it("lists settled checkpoints (index desc) with time-label fold, excerpt and eligibility", async () => {
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checkpoints: [
        {
          chapterId: "ch-2",
          index: 2,
          timeLabel: "洪典二年",
          excerpt: "赤月初升。…",
          eligible: true,
          settledAt: settledAtTwo.toISOString(),
        },
        {
          chapterId: "ch-1",
          index: 1,
          // 首条 yearLabel 为空：折叠取首个非空 yearLabel，节选取首条 text
          timeLabel: "洪典元年",
          excerpt: "山川初定，众神未名。…",
          eligible: false,
          settledAt: settledAtOne.toISOString(),
        },
      ],
    });
    // 资格判定走 Json path 过滤，不拉取整份快照
    expect(mocks.chapterFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        snapshot: { path: ["snapshotVersion"], equals: 2 },
      }),
    }));
  });

  it("falls back to 第N卷 when no chronicle entry names the chapter", async () => {
    mocks.chronicleFindMany.mockResolvedValue([]);
    const response = await GET(request, context);
    const json = await response.json() as { checkpoints: { timeLabel: string; excerpt: string | null }[] };
    expect(json.checkpoints.map((checkpoint) => checkpoint.timeLabel)).toEqual(["第2卷", "第1卷"]);
    expect(json.checkpoints.every((checkpoint) => checkpoint.excerpt === null)).toBe(true);
  });
});
