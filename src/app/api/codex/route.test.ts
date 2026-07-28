import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  timelineFindUnique: vi.fn(),
  entityFindMany: vi.fn(),
  iconAssignmentFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    timeline: { findFirst: mocks.timelineFindUnique },
    entity: { findMany: mocks.entityFindMany },
    iconAssignment: { findMany: mocks.iconAssignmentFindMany },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));

import { GET } from "./route";

describe("GET /api/codex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timelineFindUnique.mockResolvedValue({
      id: "timeline-1",
      observerState: null,
      world: { mode: "pantheon", iconTheme: null },
    });
    mocks.entityFindMany.mockResolvedValue([]);
    mocks.iconAssignmentFindMany.mockResolvedValue([]);
  });

  it("为列表实体返回当前主题解析后的 motif", async () => {
    mocks.entityFindMany.mockResolvedValue([{
      id: "entity-1",
      type: "character",
      name: "见证者",
      aliases: [],
      emblemSeed: "witness",
      imageUrl: null,
      starred: false,
      isChosen: false,
      heat: "active",
      summary: "记录世界",
      scenePresence: true,
    }]);
    mocks.iconAssignmentFindMany.mockResolvedValue([{
      subjectId: "entity-1",
      token: "entity.character",
      source: "player",
      playerLocked: true,
    }]);

    const response = await GET(new Request("http://localhost/api/codex?timelineId=timeline-1"));

    await expect(response.json()).resolves.toMatchObject({
      entities: [{
        id: "entity-1",
        iconAssignment: {
          token: "entity.character",
          source: "player",
          playerLocked: true,
          icon: { body: expect.stringContaining("<") },
        },
      }],
    });
  });

  it("从 timeline/world 关系解析观察者，不信任 omniscient 查询参数", async () => {
    const response = await GET(new Request(
      "http://localhost/api/codex?timelineId=timeline-1&viewpoint=omniscient",
    ));

    expect(response.status).toBe(200);
    expect(mocks.timelineFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "timeline-1", world: { userId: "test-user" } },
      select: expect.objectContaining({ observerState: true, world: expect.anything() }),
    }));
    expect(mocks.entityFindMany).toHaveBeenCalled();
  });

  it("不存在的 timeline 返回 404 且不读取其他世界实体", async () => {
    mocks.timelineFindUnique.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/codex?timelineId=missing"));

    expect(response.status).toBe(404);
    expect(mocks.entityFindMany).not.toHaveBeenCalled();
  });
});
