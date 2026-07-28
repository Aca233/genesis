import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  worldFindUnique: vi.fn(),
  loadRealityTree: vi.fn(),
  switchReality: vi.fn(),
  undoReality: vi.fn(),
  renameReality: vi.fn(),
  deleteRealitySubtree: vi.fn(),
  forkPantheonCheckpoint: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { world: { findFirst: mocks.worldFindUnique } },
}));
vi.mock("@/lib/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-user") }));
vi.mock("@/lib/reality/tree", () => ({
  RealityConflictError: class RealityConflictError extends Error {},
  RealityNotFoundError: class RealityNotFoundError extends Error {},
  RealityTreeValidationError: class RealityTreeValidationError extends Error {},
  loadRealityTree: mocks.loadRealityTree,
  switchReality: mocks.switchReality,
  undoReality: mocks.undoReality,
  renameReality: mocks.renameReality,
  deleteRealitySubtree: mocks.deleteRealitySubtree,
}));
vi.mock("@/lib/reality/checkpoint-fork", () => ({
  CheckpointForkConflictError: class CheckpointForkConflictError extends Error {},
  CheckpointForkNotFoundError: class CheckpointForkNotFoundError extends Error {},
  forkPantheonCheckpoint: mocks.forkPantheonCheckpoint,
}));

import { DELETE, GET, PATCH, POST } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };
function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/worlds/world-1/realities", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/worlds/[id]/realities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.worldFindUnique.mockResolvedValue({ id: "world-1", mode: "creator" });
    mocks.loadRealityTree.mockResolvedValue({ nodes: [], activeId: "root" });
    mocks.switchReality.mockResolvedValue({ activeId: "child" });
    mocks.undoReality.mockResolvedValue({ activeId: "root" });
    mocks.renameReality.mockResolvedValue({ id: "child", branchName: "新现实" });
    mocks.deleteRealitySubtree.mockResolvedValue({ deletedIds: ["child"] });
    mocks.forkPantheonCheckpoint.mockResolvedValue({ activeId: "fork-1", timelineId: "fork-1" });
  });

  it("GET returns nodes and active ID without creator-only gating", async () => {
    mocks.worldFindUnique.mockResolvedValue({ id: "world-1", mode: "pantheon" });
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ nodes: [], activeId: "root" });
  });

  it.each([
    ["POST", () => POST(request("POST", { action: "undo", expectedActiveId: "child" }), context)],
    ["PATCH", () => PATCH(request("PATCH", { timelineId: "child", branchName: "新现实" }), context)],
    ["DELETE", () => DELETE(request("DELETE", { timelineId: "child", expectedActiveId: "root" }), context)],
  ])("%s allows pantheon mutations over its fork tree", async (_method, call) => {
    mocks.worldFindUnique.mockResolvedValue({ id: "world-1", mode: "pantheon" });
    const response = await call();
    expect(response.status).toBe(200);
  });

  it("POST dispatches switch and undo with expectedActiveId", async () => {
    const switched = await POST(request("POST", {
      action: "switch",
      targetTimelineId: "child",
      expectedActiveId: "root",
    }), context);
    expect(switched.status).toBe(200);
    expect(mocks.switchReality).toHaveBeenCalledWith(expect.anything(), {
      worldId: "world-1",
      targetTimelineId: "child",
      expectedActiveId: "root",
    });

    const undone = await POST(request("POST", {
      action: "undo",
      expectedActiveId: "child",
    }), context);
    expect(undone.status).toBe(200);
    expect(mocks.undoReality).toHaveBeenCalledWith(expect.anything(), {
      worldId: "world-1",
      expectedActiveId: "child",
    });
  });

  it("POST fork runs the pantheon checkpoint fork and returns the new active reality", async () => {
    mocks.worldFindUnique.mockResolvedValue({ id: "world-1", mode: "pantheon" });
    const response = await POST(request("POST", {
      action: "fork",
      sourceChapterId: "chapter-2",
      expectedActiveId: "root",
      idempotencyKey: "checkpoint-fork-key-1",
    }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ activeId: "fork-1" });
    expect(mocks.forkPantheonCheckpoint).toHaveBeenCalledWith(expect.anything(), {
      userId: "test-user",
      worldId: "world-1",
      sourceChapterId: "chapter-2",
      expectedActiveId: "root",
      branchName: undefined,
      idempotencyKey: "checkpoint-fork-key-1",
    });
  });

  it("POST fork rejects creator worlds with 403 (creator uses decree rewrites)", async () => {
    const response = await POST(request("POST", {
      action: "fork",
      sourceChapterId: "chapter-2",
      expectedActiveId: "root",
      idempotencyKey: "checkpoint-fork-key-1",
    }), context);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "仅万神殿模式可回溯检查点" });
    expect(mocks.forkPantheonCheckpoint).not.toHaveBeenCalled();
  });

  it("POST fork validates the body (idempotencyKey length)", async () => {
    mocks.worldFindUnique.mockResolvedValue({ id: "world-1", mode: "pantheon" });
    const response = await POST(request("POST", {
      action: "fork",
      sourceChapterId: "chapter-2",
      expectedActiveId: "root",
      idempotencyKey: "short",
    }), context);
    expect(response.status).toBe(400);
    expect(mocks.forkPantheonCheckpoint).not.toHaveBeenCalled();
  });

  it("PATCH and DELETE dispatch validated mutation DTOs", async () => {
    expect((await PATCH(request("PATCH", { timelineId: "child", branchName: "新现实" }), context)).status).toBe(200);
    expect(mocks.renameReality).toHaveBeenCalledWith(expect.anything(), {
      worldId: "world-1",
      timelineId: "child",
      branchName: "新现实",
    });

    expect((await DELETE(request("DELETE", { timelineId: "child", expectedActiveId: "root" }), context)).status).toBe(200);
    expect(mocks.deleteRealitySubtree).toHaveBeenCalledWith(expect.anything(), {
      worldId: "world-1",
      timelineId: "child",
      expectedActiveId: "root",
    });
  });

  it("returns 400 for malformed bodies and 404 for missing worlds", async () => {
    const invalid = await POST(request("POST", { action: "switch", expectedActiveId: "root" }), context);
    expect(invalid.status).toBe(400);
    mocks.worldFindUnique.mockResolvedValue(null);
    const missing = await PATCH(request("PATCH", { timelineId: "child", branchName: "新现实" }), context);
    expect(missing.status).toBe(404);
  });
});
