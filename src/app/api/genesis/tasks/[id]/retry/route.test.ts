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
      budgetMaxCalls: 32,
      budgetMaxInput: 2_000_000,
      budgetMaxOutput: 192_000,
      budgetCallCount: 32,
      budgetReservedIn: 0,
      budgetReservedOut: 0,
      budgetSettledIn: 1_800_000,
      budgetSettledOut: 180_000,
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
        budgetMaxCalls: 320,
        budgetMaxInput: 30_000_000,
        budgetMaxOutput: 2_500_000,
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
      budgetMaxCalls: 320,
      budgetMaxInput: 30_000_000,
      budgetMaxOutput: 2_500_000,
      budgetCallCount: 310,
      budgetReservedIn: 100_000,
      budgetReservedOut: 10_000,
      budgetSettledIn: 28_900_000,
      budgetSettledOut: 2_390_000,
    });

    const response = await POST(new Request("http://localhost/api/genesis/tasks/task-1/retry", {
      method: "POST",
    }), context);

    expect(response.status).toBe(202);
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        budgetMaxCalls: 480,
        budgetMaxInput: 45_000_000,
        budgetMaxOutput: 3_750_000,
      }),
    }));
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { genesisTaskId: "task-1", nodeKey: "legacy-world-deck" },
    }));
  });
});
