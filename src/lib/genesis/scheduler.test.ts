import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  waitingFindMany: vi.fn().mockResolvedValue([]),
  taskUpdateMany: vi.fn().mockResolvedValue({ count: 0 }),
  jobUpdateMany: vi.fn().mockResolvedValue({ count: 0 }),
  outboxCreate: vi.fn().mockResolvedValue({}),
  ensure: vi.fn(),
  primaryEnsure: vi.fn(),
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
vi.mock("./v2/primary-runner", () => ({ ensureGenesisV2PrimaryJobRunning: mocks.primaryEnsure }));
vi.mock("./v2/shadow-runner", () => ({ ensureGenesisShadowJobRunning: mocks.shadowEnsure }));

import { scanGenesisJobs, wakeGenesisScheduler } from "./scheduler";

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

  it("调度冻结为 dag-v2 的主 DAG 节点", async () => {
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "v2-blueprint" }])
      .mockResolvedValueOnce([]);

    await scanGenesisJobs(new Date("2026-07-28T12:00:00.000Z"));

    expect(mocks.primaryEnsure).toHaveBeenCalledWith("v2-blueprint");
    expect(mocks.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        engineVersion: "dag-v2",
        task: expect.objectContaining({ engineVersion: "dag-v2" }),
      }),
    }));
  });

  it("熔断冷却后把 Legacy 或 V2 的 waiting job 重新排队供单探针恢复", async () => {
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
      where: { genesisTaskId: "task-waiting", status: "waiting_for_provider" },
      data: { status: "queued", error: null },
    }));
    expect(mocks.outboxCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      taskId: "task-waiting",
      aggregateVersion: 5,
      eventType: "provider_probe_queued",
    }) });
  });

  it("扫描进行中收到阶段完成通知时，当前扫描结束后立即补扫一次", async () => {
    let releaseFirstScan!: (value: never[]) => void;
    mocks.waitingFindMany
      .mockImplementationOnce(() => new Promise<never[]>((resolve) => { releaseFirstScan = resolve; }))
      .mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([]);

    wakeGenesisScheduler();
    wakeGenesisScheduler();
    expect(mocks.waitingFindMany).toHaveBeenCalledTimes(1);

    releaseFirstScan([]);

    await vi.waitFor(() => expect(mocks.waitingFindMany).toHaveBeenCalledTimes(2));
  });
});
