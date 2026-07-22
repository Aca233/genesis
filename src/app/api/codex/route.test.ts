import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  timelineFindUnique: vi.fn(),
  entityFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    timeline: { findUnique: mocks.timelineFindUnique },
    entity: { findMany: mocks.entityFindMany },
  },
}));

import { GET } from "./route";

describe("GET /api/codex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.timelineFindUnique.mockResolvedValue({
      id: "timeline-1",
      observerState: null,
      world: { mode: "pantheon" },
    });
    mocks.entityFindMany.mockResolvedValue([]);
  });

  it("从 timeline/world 关系解析观察者，不信任 omniscient 查询参数", async () => {
    const response = await GET(new Request(
      "http://localhost/api/codex?timelineId=timeline-1&viewpoint=omniscient",
    ));

    expect(response.status).toBe(200);
    expect(mocks.timelineFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "timeline-1" },
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
