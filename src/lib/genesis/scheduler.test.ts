import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  waitingFindMany: vi.fn().mockResolvedValue([]),
  taskUpdateMany: vi.fn().mockResolvedValue({ count: 0 }),
  jobUpdateMany: vi.fn().mockResolvedValue({ count: 0 }),
  outboxCreate: vi.fn().mockResolvedValue({}),
  ensure: vi.fn(),
  shadowEnsure: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  genesisJob: { findMany: mocks.findMany },
  $transaction: vi.fn((callback) => callback({
    genesisTask: { findMany: mocks.waitingFindMany, updateMany: mocks.taskUpdateMany },
    genesisJob: { updateMany: mocks.jobUpdateMany },
    genesisOutbox: { create: mocks.outboxCreate },
  })),
} }));
vi.mock("./task-runner", () => ({ ensureGenesisTaskRunning: mocks.ensure }));
vi.mock("./v2/shadow-runner", () => ({ ensureGenesisShadowJobRunning: mocks.shadowEnsure }));

import { scanGenesisJobs } from "./scheduler";

describe("durable genesis scheduler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes queued and expired legacy jobs without a GET or SSE observer", async () => {
    mocks.findMany.mockResolvedValue([{ genesisTaskId: "task-1" }, { genesisTaskId: "task-2" }]);
    const now = new Date("2026-07-28T12:00:00.000Z");
    await scanGenesisJobs(now);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        engineVersion: "legacy-v1",
        OR: expect.arrayContaining([{ status: "running", leaseExpiresAt: { lt: now } }]),
      }),
    }));
    expect(mocks.ensure).toHaveBeenCalledTimes(2);
    expect(mocks.ensure).toHaveBeenNthCalledWith(1, "task-1");
  });

  it("legacy 完成后才把低优先级 shadow 节点交给独立 runner", async () => {
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "shadow-blueprint" }]);

    await scanGenesisJobs(new Date("2026-07-28T12:00:00.000Z"));

    expect(mocks.shadowEnsure).toHaveBeenCalledWith("shadow-blueprint");
    expect(mocks.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        engineVersion: "dag-v2-shadow",
        task: expect.objectContaining({ status: "completed", shadowEnabled: true }),
      }),
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }));
  });

  it("熔断冷却后把 waiting_for_provider 任务重新排队供单探针恢复", async () => {
    mocks.waitingFindMany.mockResolvedValue([{
      id: "task-waiting", aggregateVersion: 4, stage: "laws",
    }]);
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.findMany.mockResolvedValue([]);
    await scanGenesisJobs(new Date("2026-07-28T12:00:00.000Z"));
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "queued", error: null, aggregateVersion: 5 },
    }));
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "queued", error: null },
    }));
    expect(mocks.outboxCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      taskId: "task-waiting",
      aggregateVersion: 5,
      eventType: "provider_probe_queued",
    }) });
  });
});
