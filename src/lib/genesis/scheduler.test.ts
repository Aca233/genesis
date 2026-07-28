import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), ensure: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { genesisJob: { findMany: mocks.findMany } } }));
vi.mock("./task-runner", () => ({ ensureGenesisTaskRunning: mocks.ensure }));

import { scanGenesisJobs } from "./scheduler";

describe("durable genesis scheduler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes queued and expired legacy jobs without a GET or SSE observer", async () => {
    mocks.findMany.mockResolvedValue([{ genesisTaskId: "task-1" }, { genesisTaskId: "task-2" }]);
    const now = new Date("2026-07-28T12:00:00.000Z");
    await scanGenesisJobs(now);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ status: "running", leaseExpiresAt: { lt: now } }]),
      }),
    }));
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    expect(mocks.ensure).toHaveBeenNthCalledWith(1, "task-1");
  });
});
