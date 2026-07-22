import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  timelineFindUnique: vi.fn(),
  entryFindMany: vi.fn(),
  godFindMany: vi.fn(),
  entityFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    timeline: { findUnique: mocks.timelineFindUnique },
    chronicleEntry: { findMany: mocks.entryFindMany },
    god: { findMany: mocks.godFindMany },
    entity: { findMany: mocks.entityFindMany },
  },
}));

import { GET } from "./route";

const observer = (viewpoint: "omniscient" | "limited") => ({
  focusType: "world",
  focusId: null,
  timeLabel: "星海元年",
  viewpoint,
  activeAvatarId: null,
});

describe("GET /api/chronicle projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timelineFindUnique.mockResolvedValue({
      observerState: observer("omniscient"),
      world: { mode: "creator" },
    });
    mocks.entryFindMany.mockResolvedValue([{
      id: "entry-hidden",
      chapterIndex: 1,
      yearLabel: "星海元年",
      text: "日神暗中焚毁盟约。",
      entityIds: [],
      godIds: ["god-sun"],
      revealed: false,
      revealedAtChapter: null,
      source: "pantheon",
    }]);
    mocks.godFindMany.mockResolvedValue([]);
    mocks.entityFindMany.mockResolvedValue([]);
  });

  it("全知 creator 收到幕后条目及明确的世界内不可见标记", async () => {
    const body = await (await GET(new Request(
      "http://localhost/api/chronicle?timelineId=timeline-1",
    ))).json();

    expect(body.entries).toEqual([expect.objectContaining({
      id: "entry-hidden",
      revealed: false,
      worldVisible: false,
    })]);
    expect(mocks.entryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { timelineId: "timeline-1" },
    }));
  });

  it("迷雾 creator 只查询并返回已揭示条目", async () => {
    mocks.timelineFindUnique.mockResolvedValue({
      observerState: observer("limited"),
      world: { mode: "creator" },
    });
    mocks.entryFindMany.mockResolvedValue([]);

    await GET(new Request("http://localhost/api/chronicle?timelineId=timeline-1"));

    expect(mocks.entryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { timelineId: "timeline-1", revealed: true },
    }));
  });

  it("pantheon 不能借查询参数读取幕后条目", async () => {
    mocks.timelineFindUnique.mockResolvedValue({
      observerState: observer("omniscient"),
      world: { mode: "pantheon" },
    });
    mocks.entryFindMany.mockResolvedValue([]);

    await GET(new Request(
      "http://localhost/api/chronicle?timelineId=timeline-1&viewpoint=omniscient",
    ));

    expect(mocks.entryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { timelineId: "timeline-1", revealed: true },
    }));
  });
});
