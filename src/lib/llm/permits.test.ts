import { describe, expect, it, vi } from "vitest";
import {
  acquireLlmPermit,
  LlmBudgetError,
  LlmCapacityError,
  resolveUnknownLlmAttempt,
  settleLlmPermit,
  tryAcquireLlmPermit,
} from "./permits";

const request = {
  logicalCallId: "logical-1",
  physicalAttemptIndex: 0,
  transportKind: "stream" as const,
  endpointKey: "https://models.test/v1",
  slot: { provider: "openai-compatible", model: "model-a" } as never,
  req: {
    task: "narrative" as const,
    userId: "user-a",
    messages: [{ role: "user" as const, content: "hello" }],
  },
  reservedInputTokens: 5,
};

describe("LLM global permits", () => {
  it("空槽领取时原子创建 Attempt、绑定三行槽之一并推进公平账本", async () => {
    const tx = {
      llmCircuit: { findUnique: vi.fn().mockResolvedValue(null) },
      llmPermitRequest: {
        findMany: vi.fn().mockResolvedValue([{
          id: "request-1", userId: "user-a", priority: 700, requestedAt: new Date(),
        }]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockResolvedValue({}),
      },
      llmFairness: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({}),
      },
      llmAttempt: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      },
      llmSlot: { update: vi.fn().mockResolvedValue({}) },
      $queryRaw: vi.fn().mockResolvedValue([{ slot_no: 2, slot_epoch: 4 }]),
    };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };

    await expect(tryAcquireLlmPermit(db as never, request, "request-1"))
      .resolves.toMatchObject({ slotNo: 2, slotEpoch: 5 });
    expect(tx.llmAttempt.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      usedSlotNo: 2,
      slotEpoch: 5,
      state: "in_flight",
    }) });
    expect(tx.llmSlot.update).toHaveBeenCalledWith({
      where: { slotNo: 2 },
      data: expect.objectContaining({ slotEpoch: 5 }),
    });
  });

  it("存在其他等待用户时单用户最多占两个槽", async () => {
    const tx = {
      llmCircuit: { findUnique: vi.fn().mockResolvedValue(null) },
      llmPermitRequest: {
        findMany: vi.fn().mockResolvedValue([{
          id: "request-1", userId: "user-a", priority: 700, requestedAt: new Date(),
        }]),
        count: vi.fn().mockResolvedValue(1),
      },
      llmFairness: { findMany: vi.fn().mockResolvedValue([]) },
      llmAttempt: { count: vi.fn().mockResolvedValue(2) },
    };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };
    await expect(tryAcquireLlmPermit(db as never, request, "request-1")).resolves.toBeNull();
  });

  it("过期熔断只有在确认有空槽后才占用 half-open 探针", async () => {
    const circuitUpdate = vi.fn();
    const tx = {
      llmCircuit: {
        findUnique: vi.fn().mockResolvedValue({
          state: "open",
          openUntil: new Date(0),
          probeRequestId: null,
        }),
        updateMany: circuitUpdate,
      },
      llmPermitRequest: {
        findMany: vi.fn().mockResolvedValue([{
          id: "request-1", userId: "user-a", priority: 700, requestedAt: new Date(),
        }]),
        count: vi.fn().mockResolvedValue(0),
      },
      llmFairness: { findMany: vi.fn().mockResolvedValue([]) },
      llmAttempt: { count: vi.fn().mockResolvedValue(0) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };

    await expect(tryAcquireLlmPermit(db as never, request, "request-1")).resolves.toBeNull();
    expect(circuitUpdate).not.toHaveBeenCalled();
  });

  it("预算上限同时计算已结算与仍预留的 Token", async () => {
    const tx = {
      llmCircuit: { findUnique: vi.fn().mockResolvedValue(null) },
      llmPermitRequest: {
        findMany: vi.fn().mockResolvedValue([{
          id: "request-1", userId: "user-a", priority: 700, requestedAt: new Date(),
        }]),
        count: vi.fn().mockResolvedValue(0),
      },
      llmFairness: { findMany: vi.fn().mockResolvedValue([]) },
      llmAttempt: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
      llmSlot: { update: vi.fn() },
      genesisJob: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      genesisTask: {
        findUnique: vi.fn().mockResolvedValue({
          budgetMaxCalls: 12,
          budgetMaxInput: 20,
          budgetMaxOutput: 10_000,
          budgetCallCount: 1,
          budgetReservedIn: 3,
          budgetReservedOut: 0,
          budgetSettledIn: 13,
          budgetSettledOut: 0,
        }),
        updateMany: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ slot_no: 1, slot_epoch: 0 }]),
    };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };
    const genesisRequest = {
      ...request,
      req: {
        ...request.req,
        owner: {
          kind: "genesis_job",
          id: "job-1",
          genesisTaskId: "task-1",
          genesisJobId: "job-1",
          leaseEpoch: 2,
        },
      },
    };

    await expect(tryAcquireLlmPermit(db as never, genesisRequest, "request-1"))
      .rejects.toBeInstanceOf(LlmBudgetError);
    expect(tx.genesisTask.updateMany).not.toHaveBeenCalled();
    expect(tx.llmAttempt.create).not.toHaveBeenCalled();
  });

  it("terminal_unknown 保留槽，明确 EOF 则结算预算并 CAS 释放", async () => {
    const attemptUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const slotUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      llmAttempt: { updateMany: attemptUpdate },
      llmSlot: { updateMany: slotUpdate },
      llmCircuit: {
        upsert: vi.fn().mockResolvedValue({ failureCount: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      genesisTask: { update: vi.fn().mockResolvedValue({}) },
    };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };
    const permit = {
      attemptId: "attempt-1",
      slotNo: 1,
      slotEpoch: 3,
      logicalCallId: "logical-1",
      physicalAttemptIndex: 0,
      requestId: "request-1",
      reservedInputTokens: 5,
      reservedOutputTokens: 10,
    };

    await settleLlmPermit(permit, {
      transportOutcome: "network_terminated",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "NETWORK_TERMINATED",
    }, "endpoint", "model", "narrative", "user-a", db as never);
    expect(slotUpdate).not.toHaveBeenCalled();
    expect(attemptUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "terminal_unknown", releasedAt: null }),
    }));

    await settleLlmPermit(permit, {
      transportOutcome: "success",
      terminalEvidence: "stream_eof",
      stableErrorCode: null,
      usage: { inputTokens: 4, outputTokens: 6, cacheReadTokens: null, cacheWriteTokens: null },
    }, "endpoint", "model", "narrative", "user-a", db as never);
    expect(slotUpdate).toHaveBeenCalledWith({
      where: { slotNo: 1, currentAttemptId: "attempt-1", slotEpoch: 3 },
      data: { currentAttemptId: null, boundAt: null },
    });
  });

  it("管理员确认未知调用终局后释放槽并结算预算，但不重复累计熔断失败", async () => {
    const slotUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const budgetUpdate = vi.fn().mockResolvedValue({});
    const circuitUpsert = vi.fn();
    const circuitUpdate = vi.fn();
    const tx = {
      llmAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      llmSlot: { updateMany: slotUpdate },
      llmCircuit: { upsert: circuitUpsert, update: circuitUpdate },
      genesisTask: { update: budgetUpdate },
    };
    const db = {
      llmAttempt: {
        findUnique: vi.fn().mockResolvedValue({
          id: "attempt-unknown",
          state: "terminal_unknown",
          usedSlotNo: 3,
          slotEpoch: 8,
          logicalCallId: "logical-unknown",
          physicalAttemptIndex: 2,
          genesisTaskId: "task-1",
          reservedInputTokens: 11,
          reservedOutputTokens: 17,
          transportOutcome: "upstream_timeout",
          stableErrorCode: "UPSTREAM_TIMEOUT",
          error: "provider timeout",
          endpointKey: "endpoint",
          model: "model",
          taskClass: "genesis",
          userId: "user-a",
        }),
      },
      $transaction: vi.fn((callback) => callback(tx)),
    };

    await resolveUnknownLlmAttempt("attempt-unknown", "provider_deadline", db as never);

    expect(tx.llmAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        state: "settled",
        stableErrorCode: "UPSTREAM_TIMEOUT",
        terminalEvidence: "provider_deadline",
      }),
    }));
    expect(slotUpdate).toHaveBeenCalledWith({
      where: { slotNo: 3, currentAttemptId: "attempt-unknown", slotEpoch: 8 },
      data: { currentAttemptId: null, boundAt: null },
    });
    expect(budgetUpdate).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        budgetReservedIn: { decrement: 11 },
        budgetReservedOut: { decrement: 17 },
        budgetSettledIn: { increment: 11 },
        budgetSettledOut: { increment: 17 },
      },
    });
    expect(circuitUpsert).not.toHaveBeenCalled();
    expect(circuitUpdate).not.toHaveBeenCalled();
  });

  it("half-open 探针收到明确瞬时失败时立即重新打开熔断", async () => {
    const circuitUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      llmAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      llmSlot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      llmCircuit: {
        upsert: vi.fn().mockResolvedValue({ state: "half_open", failureCount: 2 }),
        update: circuitUpdate,
      },
      genesisTask: { update: vi.fn() },
    };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };

    await settleLlmPermit({
      attemptId: "attempt-probe",
      slotNo: 2,
      slotEpoch: 4,
      logicalCallId: "logical-probe",
      physicalAttemptIndex: 0,
      requestId: "request-probe",
      reservedInputTokens: 5,
      reservedOutputTokens: 10,
    }, {
      transportOutcome: "http_error",
      terminalEvidence: "response_complete",
      stableErrorCode: "SERVER_ERROR",
    }, "endpoint", "model", "genesis", "user-a", db as never);

    expect(circuitUpdate).toHaveBeenCalledWith({
      where: { circuitKey: expect.any(String) },
      data: { state: "open", openUntil: expect.any(Date) },
    });
  });

  it("没有可用槽时有界等待并取消持久排队请求", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      llmPermitRequest: {
        create: vi.fn().mockResolvedValue({}),
        updateMany,
      },
      $transaction: vi.fn().mockResolvedValue(null),
    };
    await expect(acquireLlmPermit(request, db as never, { waitMs: 0, pollMs: 0 }))
      .rejects.toBeInstanceOf(LlmCapacityError);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "cancelled" }),
    }));
  });
});
