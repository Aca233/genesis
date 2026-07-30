import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  taskFindFirst: vi.fn(),
  taskUpdateMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  outboxCreate: vi.fn(),
  transaction: vi.fn(),
  wake: vi.fn(),
}));

const tx = {
  genesisTask: {
    findFirst: mocks.taskFindFirst,
    updateMany: mocks.taskUpdateMany,
  },
  genesisJob: { updateMany: mocks.jobUpdateMany },
  genesisOutbox: { create: mocks.outboxCreate },
};

vi.mock("@/lib/db", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));
vi.mock("@/lib/genesis/scheduler", () => ({ wakeGenesisScheduler: mocks.wake }));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "task-1" }) };

describe("POST /api/genesis/tasks/[id]/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.taskFindFirst.mockResolvedValue({
      aggregateVersion: 4,
      stage: "characters",
      engineVersion: "dag-v2",
    });
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.outboxCreate.mockResolvedValue({});
  });

  it("V2 人工重试保留已结算用量，并补充一次受控阶段修复预算", async () => {
    const response = await POST(new Request("http://localhost/api/genesis/tasks/task-1/retry", {
      method: "POST",
    }), context);

    expect(response.status).toBe(202);
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "queued",
        aggregateVersion: 5,
        budgetMaxCalls: { increment: 16 },
        budgetMaxInput: { increment: 1_000_000 },
        budgetMaxOutput: { increment: 128_000 },
      }),
    }));
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { genesisTaskId: "task-1", engineVersion: "dag-v2", status: "failed" },
      data: expect.objectContaining({ status: "queued", attempt: 0 }),
    }));
    expect(mocks.wake).toHaveBeenCalledOnce();
  });

  it("legacy 人工重试也补充预算，避免预算失败后原地再次失败", async () => {
    mocks.taskFindFirst.mockResolvedValue({
      aggregateVersion: 2,
      stage: "semantic_repair",
      engineVersion: "legacy-v1",
    });

    const response = await POST(new Request("http://localhost/api/genesis/tasks/task-1/retry", {
      method: "POST",
    }), context);

    expect(response.status).toBe(202);
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        budgetMaxCalls: { increment: 16 },
        budgetMaxInput: { increment: 1_000_000 },
        budgetMaxOutput: { increment: 128_000 },
      }),
    }));
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { genesisTaskId: "task-1", nodeKey: "legacy-world-deck" },
    }));
  });
});
