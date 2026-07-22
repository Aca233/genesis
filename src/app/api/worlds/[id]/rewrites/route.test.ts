import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  ensure: vi.fn(),
  retry: vi.fn(),
  taskFindFirst: vi.fn(),
  taskFindMany: vi.fn(),
  worldFindFirst: vi.fn(),
  dto: vi.fn((task: unknown) => task),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    realityRewrite: {
      findFirst: mocks.taskFindFirst,
      findMany: mocks.taskFindMany,
    },
    world: { findFirst: mocks.worldFindFirst },
  },
}));
vi.mock("@/lib/reality/task-runner", () => ({
  createRealityRewrite: mocks.create,
  ensureRealityRewriteRunning: mocks.ensure,
  retryRealityRewrite: mocks.retry,
  toRealityRewriteDto: mocks.dto,
  RealityRewriteConflictError: class RealityRewriteConflictError extends Error {},
  RealityRewriteForbiddenError: class RealityRewriteForbiddenError extends Error {},
  RealityRewriteNotFoundError: class RealityRewriteNotFoundError extends Error {},
}));

import { POST as createRewrite, GET as listRewrites } from "@/app/api/worlds/[id]/rewrites/route";
import { GET as getRewrite, POST as retryRewrite } from "@/app/api/rewrites/[id]/route";

const worldContext = { params: Promise.resolve({ id: "world-1" }) };
const taskContext = { params: Promise.resolve({ id: "rewrite-1" }) };
const rewrite = { id: "rewrite-1", status: "planning" };

function request(url: string, method = "GET", body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("reality rewrite routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ task: rewrite, replayed: false });
    mocks.retry.mockResolvedValue(rewrite);
    mocks.taskFindFirst.mockResolvedValue(rewrite);
    mocks.taskFindMany.mockResolvedValue([rewrite]);
    mocks.worldFindFirst.mockResolvedValue({ id: "world-1" });
  });

  it("validates decree and idempotency key, returns 202, and starts the runner", async () => {
    const response = await createRewrite(request("http://localhost/api/worlds/world-1/rewrites", "POST", {
      decree: "  群星改道  ", idempotencyKey: "idem-key-1",
    }), worldContext);
    expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), {
      worldId: "world-1", decree: "群星改道", scope: "prospective", idempotencyKey: "idem-key-1",
    });
    expect(mocks.ensure).toHaveBeenCalledWith("rewrite-1");

    expect((await createRewrite(request("http://localhost", "POST", {
      decree: "", idempotencyKey: "short",
    }), worldContext)).status).toBe(400);
  });

  it("lists and gets only local-user tasks through sanitized DTOs", async () => {
    expect((await listRewrites(request("http://localhost"), worldContext)).status).toBe(200);
    expect(mocks.worldFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "world-1", userId: "local" } }));
    expect((await getRewrite(request("http://localhost"), taskContext)).status).toBe(200);
    expect(mocks.taskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "rewrite-1", world: { userId: "local" } },
    }));
  });

  it("retries recoverable work and does not restart completed work", async () => {
    const response = await retryRewrite(request("http://localhost", "POST", { action: "retry" }), taskContext);
    expect(response.status).toBe(202);
    expect(mocks.ensure).toHaveBeenCalledWith("rewrite-1");

    vi.clearAllMocks();
    mocks.retry.mockResolvedValue({ ...rewrite, status: "completed" });
    const completed = await retryRewrite(request("http://localhost", "POST", { action: "retry" }), taskContext);
    expect(completed.status).toBe(200);
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
});
