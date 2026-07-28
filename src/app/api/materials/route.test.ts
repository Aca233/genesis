import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { materialCard: { findMany: mocks.findMany } } }));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));
import { GET } from "./route";

describe("GET /api/materials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
  });

  it("返回素材列表并默认过滤隐藏项", async () => {
    const card = {
      id: "card-1", kind: "character", name: "旅人", summary: "摘要", favorite: false, hidden: false,
      sourceWorldId: "w1", sourceWorldName: "旧世界", defaultVersionId: "version-1",
      versions: [{ id: "version-1", version: 1, name: "初始版", note: null, isInitial: true, createdAt: new Date("2026-01-01") }],
    };
    mocks.findMany.mockResolvedValue([card]);

    const response = await GET(new Request("http://localhost/api/materials"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      materials: [{ id: "card-1", defaultVersionId: "version-1", versions: [{ id: "version-1", isInitial: true }] }],
    });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "test-user", hidden: false },
    }));
  });

  it("列表查询不携带 defaultVersion 关联，版本索引不含重量级 content", async () => {
    await GET(new Request("http://localhost/api/materials"));

    const args = mocks.findMany.mock.calls[0]![0];
    expect(args.include).not.toHaveProperty("defaultVersion");
    expect(args.include.versions.select).not.toHaveProperty("content");
    expect(args.include.versions.select).not.toHaveProperty("dependencies");
    expect(args.include.versions.select).toMatchObject({ id: true, version: true, name: true, isInitial: true, createdAt: true });
  });

  it("按 kind、q、favorite、showHidden 组合筛选", async () => {
    await GET(new Request("http://localhost/api/materials?kind=character&q=旅人&favorite=true&showHidden=true"));

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "test-user", kind: "character", favorite: true,
        OR: [
          { name: { contains: "旅人", mode: "insensitive" } },
          { summary: { contains: "旅人", mode: "insensitive" } },
          { sourceWorldName: { contains: "旅人", mode: "insensitive" } },
        ],
      },
    }));
  });

  it("拒绝无效的素材类型", async () => {
    const response = await GET(new Request("http://localhost/api/materials?kind=nonsense"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "素材类型无效" });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
