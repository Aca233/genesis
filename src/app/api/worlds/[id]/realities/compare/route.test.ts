import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealityNotFoundError,
  RealityTreeValidationError,
} from "@/lib/reality/tree";

const mocks = vi.hoisted(() => ({
  worldFindUnique: vi.fn(),
  loadRealityComparison: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { world: { findFirst: mocks.worldFindUnique } },
}));
vi.mock("@/lib/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-user") }));
vi.mock("@/lib/reality/compare", () => ({
  RealityCompareError: class RealityCompareError extends Error {},
  loadRealityComparison: mocks.loadRealityComparison,
}));

import { RealityCompareError } from "@/lib/reality/compare";
import { GET } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };
function request(query: string) {
  return new Request(`http://localhost/api/worlds/world-1/realities/compare${query}`);
}

const comparison = {
  left: { id: "t-root" },
  right: { id: "t-child" },
  relationship: { kind: "parent-child", parentId: "t-root", childId: "t-child" },
  divergenceLabel: "冕历三年",
  chronicle: { commonCount: 3, leftOnly: [], rightOnly: [] },
  entities: [],
};

describe("GET /api/worlds/[id]/realities/compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.worldFindUnique.mockResolvedValue({ mode: "creator" });
    mocks.loadRealityComparison.mockResolvedValue(comparison);
  });

  it("returns 400 for malformed queries without touching the comparison", async () => {
    const response = await GET(request("?left=t-root"), context);
    expect(response.status).toBe(400);
    expect(mocks.loadRealityComparison).not.toHaveBeenCalled();
  });

  it("returns 404 for missing worlds", async () => {
    mocks.worldFindUnique.mockResolvedValue(null);
    const response = await GET(request("?left=t-root&right=t-child"), context);
    expect(response.status).toBe(404);
    expect(mocks.loadRealityComparison).not.toHaveBeenCalled();
  });

  it("creator worlds compare omnisciently", async () => {
    const response = await GET(request("?left=t-root&right=t-child"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(comparison);
    expect(mocks.loadRealityComparison).toHaveBeenCalledWith(
      expect.anything(), "world-1", "t-root", "t-child", { omniscient: true },
    );
  });

  it("pantheon worlds compare with hidden knowledge sanitized", async () => {
    mocks.worldFindUnique.mockResolvedValue({ mode: "pantheon" });
    const response = await GET(request("?left=t-root&right=t-child"), context);
    expect(response.status).toBe(200);
    expect(mocks.loadRealityComparison).toHaveBeenCalledWith(
      expect.anything(), "world-1", "t-root", "t-child", { omniscient: false },
    );
  });

  it.each([
    [new RealityCompareError("仅支持父子或同父兄弟现实对照"), 400],
    [new RealityNotFoundError("对照现实不存在"), 404],
    [new RealityTreeValidationError("现实树根节点必须唯一"), 500],
  ])("maps %s to HTTP %i", async (error, status) => {
    mocks.loadRealityComparison.mockRejectedValue(error);
    const response = await GET(request("?left=t-root&right=t-child"), context);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: error.message });
  });
});
