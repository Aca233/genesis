import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadPromptCacheStats: vi.fn() }));
vi.mock("@/lib/llm/cache-stats", () => ({ loadPromptCacheStats: mocks.loadPromptCacheStats }));
import { GET } from "./route";

describe("GET /api/settings/cache-stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the cache DTO", async () => {
    const dto = { last24Hours: { calls: 1 }, recent: [] };
    mocks.loadPromptCacheStats.mockResolvedValue(dto);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(dto);
  });

  it("does not expose database errors", async () => {
    mocks.loadPromptCacheStats.mockRejectedValue(new Error("postgresql://secret"));
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "缓存统计读取失败" });
  });
});
