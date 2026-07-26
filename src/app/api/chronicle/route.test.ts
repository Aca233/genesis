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
    mocks.godFindMany.mockResolvedValue([
      { id: "god-sun", name: "日神赫利俄斯" },
    ]);
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
      gods: [{ id: "god-sun", name: "日神赫利俄斯" }],
    })]);
    expect(mocks.entryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { timelineId: "timeline-1" },
    }));
  });

  it("把每条史料关联的神 ID 投影为可显示的神名", async () => {
    mocks.entryFindMany.mockResolvedValueOnce([{
      id: "entry-shared",
      chapterIndex: 1,
      yearLabel: "星海元年",
      text: "日神与月神共同缔结盟约。",
      entityIds: [],
      godIds: ["god-sun", "god-moon"],
      revealed: true,
      revealedAtChapter: null,
      source: "narrative",
    }]).mockResolvedValueOnce([
      { chapterIndex: 1, yearLabel: "星海元年" },
    ]);
    mocks.godFindMany.mockResolvedValue([
      { id: "god-sun", name: "日神赫利俄斯" },
      { id: "god-moon", name: "月神塞勒涅" },
    ]);

    const body = await (await GET(new Request(
      "http://localhost/api/chronicle?timelineId=timeline-1",
    ))).json();

    expect(body.entries[0]).toMatchObject({
      id: "entry-shared",
      gods: [
        { id: "god-sun", name: "日神赫利俄斯" },
        { id: "god-moon", name: "月神塞勒涅" },
      ],
    });
  });

  it("把内部揭示索引解析为世界时间标签", async () => {
    mocks.entryFindMany.mockResolvedValue([
      {
        id: "entry-backfilled",
        chapterIndex: 1,
        yearLabel: "星海元年",
        text: "日神暗中焚毁盟约。",
        entityIds: [],
        godIds: ["god-sun"],
        revealed: true,
        revealedAtChapter: 2,
        source: "pantheon",
      },
      {
        id: "entry-reveal-time",
        chapterIndex: 2,
        yearLabel: "星海二年·霜月",
        text: "旧盟约的灰烬终于被发现。",
        entityIds: [],
        godIds: [],
        revealed: true,
        revealedAtChapter: null,
        source: "narrative",
      },
    ]);

    const body = await (await GET(new Request(
      "http://localhost/api/chronicle?timelineId=timeline-1",
    ))).json();

    expect(body.entries[0]).toMatchObject({
      id: "entry-backfilled",
      revealedAtTimeLabel: "星海二年·霜月",
    });
  });

  it("旧幕后条目没有纪年时沿用同一内部记录段的公开世界时间", async () => {
    mocks.entryFindMany
      .mockResolvedValueOnce([{
        id: "entry-hidden",
        chapterIndex: 3,
        yearLabel: "",
        text: "龙神暗中开启龙门。",
        entityIds: [],
        godIds: ["god-dragon"],
        revealed: false,
        revealedAtChapter: null,
        source: "pantheon",
      }])
      .mockResolvedValueOnce([
        { chapterIndex: 3, yearLabel: "" },
        { chapterIndex: 3, yearLabel: "甲龙历四三二年" },
      ]);

    const body = await (await GET(new Request(
      "http://localhost/api/chronicle?timelineId=timeline-1",
    ))).json();

    expect(body.entries[0]).toMatchObject({
      id: "entry-hidden",
      yearLabel: "甲龙历四三二年",
    });
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
