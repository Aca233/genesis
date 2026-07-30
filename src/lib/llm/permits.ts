import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CompletionRequest, ModelSlot, NormalizedUsage } from "./types";
import type { TerminalEvidenceType, TransportKind, TransportOutcome } from "./transport";

const POLL_MS = 100;
const WAIT_MS = 5 * 60 * 1000;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30 * 1000;
const SERIALIZATION_RETRIES = 5;

const priorityByTask: Record<string, number> = {
  narrative: 700,
  settlement: 700,
  finale: 700,
  reroll: 500,
  genesis: 400,
  pantheon: 300,
  extract: 150,
  chronicle: 150,
  "world-director": 150,
  "world-director-probe": 25,
  test: 50,
};

export class LlmCapacityError extends Error {
  constructor(message = "模型调用正在公平排队，请稍后重试") {
    super(message);
    this.name = "LlmCapacityError";
  }
}

export class LlmCircuitOpenError extends Error {
  readonly code = "WAITING_FOR_PROVIDER";
  constructor() {
    super("模型端点暂时熔断，任务正在等待服务恢复");
    this.name = "LlmCircuitOpenError";
  }
}

export class LlmBudgetError extends Error {
  readonly code = "BUDGET_EXHAUSTED";
  constructor() {
    super("创世任务已达到模型调用预算上限");
    this.name = "LlmBudgetError";
  }
}

export class LlmOperatorAttentionError extends Error {
  readonly code = "OPERATOR_ATTENTION";
  constructor() {
    super("模型端点终局状态未知，已保留调用槽并等待管理员核验");
    this.name = "LlmOperatorAttentionError";
  }
}

type PermitDb = PrismaClient;
type Permit = {
  attemptId: string;
  slotNo: number;
  slotEpoch: number;
  logicalCallId: string;
  physicalAttemptIndex: number;
  requestId: string;
  genesisTaskId?: string;
  budgetScope?: "primary" | "shadow";
  reservedInputTokens: number;
  reservedOutputTokens: number;
};

type AcquireInput = {
  logicalCallId: string;
  physicalAttemptIndex: number;
  transportKind: TransportKind;
  endpointKey: string;
  slot: ModelSlot;
  req: CompletionRequest;
  reservedInputTokens: number;
};

export type PermitSettlement = {
  transportOutcome: TransportOutcome;
  terminalEvidence: TerminalEvidenceType;
  stableErrorCode: string | null;
  usage?: NormalizedUsage;
  error?: string;
  affectCircuit?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSerializationConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "P2034" || /serialization|write conflict|deadlock/i.test(message);
}

async function withSerializationRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSerializationConflict(error) || attempt === SERIALIZATION_RETRIES - 1) throw error;
      await sleep(10 * 2 ** attempt);
    }
  }
  throw lastError;
}

function isolationDomain(endpointKey: string, userId: string): string {
  return createHash("sha256").update(`${userId}\0${endpointKey}`, "utf8").digest("hex");
}

function circuitKey(endpointKey: string, model: string, taskClass: string, domain: string): string {
  return createHash("sha256").update(`${domain}\0${endpointKey}\0${model}\0${taskClass}`, "utf8").digest("hex");
}

function reservationOutput(req: CompletionRequest): number {
  return Math.max(1, req.maxTokens ?? 4096);
}

async function tryAcquire(db: PermitDb, input: AcquireInput, requestId: string): Promise<Permit | null> {
  return withSerializationRetry(() => db.$transaction(async (tx) => {
    const domain = isolationDomain(input.endpointKey, input.req.userId);
    const breakerKey = circuitKey(input.endpointKey, input.slot.model, input.req.task, domain);
    let circuit = await tx.llmCircuit.findUnique({ where: { circuitKey: breakerKey } });
    const now = new Date();
    if (circuit?.state === "open" && (!circuit.openUntil || circuit.openUntil > now)) {
      throw new LlmCircuitOpenError();
    }
    if (circuit?.state === "half_open" && circuit.probeRequestId !== requestId) {
      throw new LlmCircuitOpenError();
    }

    const candidates = await tx.llmPermitRequest.findMany({
      where: { state: "waiting" },
      orderBy: { requestedAt: "asc" },
      take: 50,
      select: { id: true, userId: true, priority: true, requestedAt: true },
    });
    const fairness = await tx.llmFairness.findMany({
      where: { userId: { in: [...new Set(candidates.map((candidate) => candidate.userId))] } },
      select: { userId: true, virtualFinish: true },
    });
    const finishByUser = new Map(fairness.map((row) => [row.userId, row.virtualFinish]));
    candidates.sort((a, b) => {
      const age = (candidate: typeof a) => Math.min(350, Math.floor((now.getTime() - candidate.requestedAt.getTime()) / 5_000));
      const priorityDelta = (b.priority + age(b)) - (a.priority + age(a));
      if (priorityDelta !== 0) return priorityDelta;
      const finishDelta = (finishByUser.get(a.userId) ?? 0) - (finishByUser.get(b.userId) ?? 0);
      return finishDelta || a.requestedAt.getTime() - b.requestedAt.getTime();
    });
    if (candidates[0]?.id !== requestId) return null;

    const activeForUser = await tx.llmAttempt.count({
      where: { userId: input.req.userId, state: { in: ["reserved", "in_flight", "terminal_unknown"] } },
    });
    const anotherUserWaiting = await tx.llmPermitRequest.count({
      where: { state: "waiting", userId: { not: input.req.userId } },
    });
    if (anotherUserWaiting > 0 && activeForUser >= 2) return null;

    const slotRows = await tx.$queryRaw<Array<{ slot_no: number; slot_epoch: number }>>`
      SELECT "slot_no", "slot_epoch"
      FROM "llm_slots"
      WHERE "current_attempt_id" IS NULL
      ORDER BY "slot_no"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
    const slot = slotRows[0];
    if (!slot) return null;

    if (circuit?.state === "open") {
      const halfOpened = await tx.llmCircuit.updateMany({
        where: { circuitKey: breakerKey, state: "open", openUntil: { lte: now } },
        data: { state: "half_open", probeRequestId: requestId },
      });
      if (halfOpened.count !== 1) throw new LlmCircuitOpenError();
      circuit = { ...circuit, state: "half_open", probeRequestId: requestId };
    }

    const reservedOutputTokens = reservationOutput(input.req);
    const owner = input.req.owner;
    const budgetScope = owner?.budgetScope ?? "primary";
    if (owner?.genesisTaskId) {
      if (!owner.genesisJobId || owner.leaseEpoch === undefined) {
        throw new Error("创世模型调用缺少持久作业归属");
      }
      const currentJob = await tx.genesisJob.findFirst({
        where: {
          id: owner.genesisJobId,
          genesisTaskId: owner.genesisTaskId,
          leaseEpoch: owner.leaseEpoch,
          status: "running",
          leaseExpiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (!currentJob) throw new Error("创世任务作业租约已失效");
      const currentBudget = await tx.genesisTask.findUnique({
        where: { id: owner.genesisTaskId },
        select: {
          budgetMaxCalls: true,
          budgetMaxInput: true,
          budgetMaxOutput: true,
          budgetCallCount: true,
          budgetReservedIn: true,
          budgetReservedOut: true,
          budgetSettledIn: true,
          budgetSettledOut: true,
          shadowBudgetMaxCalls: true,
          shadowBudgetMaxInput: true,
          shadowBudgetMaxOutput: true,
          shadowBudgetCallCount: true,
          shadowBudgetReservedIn: true,
          shadowBudgetReservedOut: true,
          shadowBudgetSettledIn: true,
          shadowBudgetSettledOut: true,
        },
      });
      const maxCalls = budgetScope === "shadow" ? currentBudget?.shadowBudgetMaxCalls : currentBudget?.budgetMaxCalls;
      const maxInput = budgetScope === "shadow" ? currentBudget?.shadowBudgetMaxInput : currentBudget?.budgetMaxInput;
      const maxOutput = budgetScope === "shadow" ? currentBudget?.shadowBudgetMaxOutput : currentBudget?.budgetMaxOutput;
      const callCount = budgetScope === "shadow" ? currentBudget?.shadowBudgetCallCount : currentBudget?.budgetCallCount;
      const reservedIn = budgetScope === "shadow" ? currentBudget?.shadowBudgetReservedIn : currentBudget?.budgetReservedIn;
      const reservedOut = budgetScope === "shadow" ? currentBudget?.shadowBudgetReservedOut : currentBudget?.budgetReservedOut;
      const settledIn = budgetScope === "shadow" ? currentBudget?.shadowBudgetSettledIn : currentBudget?.budgetSettledIn;
      const settledOut = budgetScope === "shadow" ? currentBudget?.shadowBudgetSettledOut : currentBudget?.budgetSettledOut;
      if (!currentBudget
        || callCount === undefined || reservedIn === undefined || reservedOut === undefined
        || settledIn === undefined || settledOut === undefined
        || maxCalls === undefined || maxInput === undefined || maxOutput === undefined
        || callCount + 1 > maxCalls
        || settledIn + reservedIn + input.reservedInputTokens > maxInput
        || settledOut + reservedOut + reservedOutputTokens > maxOutput) {
        throw new LlmBudgetError();
      }
      const budget = await tx.genesisTask.updateMany({
        where: {
          id: owner.genesisTaskId,
          ...(budgetScope === "shadow" ? {
            shadowBudgetCallCount: currentBudget.shadowBudgetCallCount,
            shadowBudgetReservedIn: currentBudget.shadowBudgetReservedIn,
            shadowBudgetReservedOut: currentBudget.shadowBudgetReservedOut,
            shadowBudgetSettledIn: currentBudget.shadowBudgetSettledIn,
            shadowBudgetSettledOut: currentBudget.shadowBudgetSettledOut,
          } : {
            budgetCallCount: currentBudget.budgetCallCount,
            budgetReservedIn: currentBudget.budgetReservedIn,
            budgetReservedOut: currentBudget.budgetReservedOut,
            budgetSettledIn: currentBudget.budgetSettledIn,
            budgetSettledOut: currentBudget.budgetSettledOut,
          }),
        },
        data: budgetScope === "shadow" ? {
          shadowBudgetCallCount: { increment: 1 },
          shadowBudgetReservedIn: { increment: input.reservedInputTokens },
          shadowBudgetReservedOut: { increment: reservedOutputTokens },
        } : {
          budgetCallCount: { increment: 1 },
          budgetReservedIn: { increment: input.reservedInputTokens },
          budgetReservedOut: { increment: reservedOutputTokens },
        },
      });
      if (budget.count !== 1) throw new LlmBudgetError();
    }

    const attemptId = randomUUID();
    const slotEpoch = slot.slot_epoch + 1;
    await tx.llmAttempt.create({
      data: {
        id: attemptId,
        logicalCallId: input.logicalCallId,
        physicalAttemptIndex: input.physicalAttemptIndex,
        usedSlotNo: slot.slot_no,
        slotEpoch,
        cacheIsolationDomain: domain,
        endpointKey: input.endpointKey,
        model: input.slot.model,
        taskClass: input.req.task,
        ownerKind: owner?.kind ?? "request",
        ownerId: owner?.id ?? input.logicalCallId,
        genesisTaskId: owner?.genesisTaskId,
        genesisJobId: owner?.genesisJobId,
        userId: input.req.userId,
        leaseEpoch: owner?.leaseEpoch,
        budgetScope,
        ownerLeaseExpiresAt: owner?.leaseExpiresAt ? new Date(owner.leaseExpiresAt) : null,
        transportKind: input.transportKind,
        reservedInputTokens: input.reservedInputTokens,
        reservedOutputTokens,
        state: "in_flight",
        providerStartedAt: now,
      },
    });
    await tx.llmSlot.update({
      where: { slotNo: slot.slot_no },
      data: { currentAttemptId: attemptId, slotEpoch, boundAt: now },
    });
    await tx.llmPermitRequest.update({
      where: { id: requestId },
      data: { state: "acquired", acquiredAt: now },
    });
    await tx.llmFairness.upsert({
      where: { userId: input.req.userId },
      create: { userId: input.req.userId, virtualFinish: 1, lastGrantedAt: now },
      update: { virtualFinish: { increment: 1 }, lastGrantedAt: now },
    });
    return {
      attemptId,
      slotNo: slot.slot_no,
      slotEpoch,
      logicalCallId: input.logicalCallId,
      physicalAttemptIndex: input.physicalAttemptIndex,
      requestId,
      genesisTaskId: owner?.genesisTaskId,
      budgetScope,
      reservedInputTokens: input.reservedInputTokens,
      reservedOutputTokens,
    };
  }, { isolationLevel: "Serializable" }));
}

export { tryAcquire as tryAcquireLlmPermit };

export async function acquireLlmPermit(
  input: AcquireInput,
  db: PermitDb = prisma,
  options: { waitMs?: number; pollMs?: number } = {},
): Promise<Permit> {
  const requestId = randomUUID();
  const domain = isolationDomain(input.endpointKey, input.req.userId);
  await db.llmPermitRequest.create({
    data: {
      id: requestId,
      logicalCallId: input.logicalCallId,
      physicalAttemptIndex: input.physicalAttemptIndex,
      userId: input.req.userId,
      taskClass: input.req.task,
      priority: priorityByTask[input.req.task] ?? 100,
      endpointKey: input.endpointKey,
      model: input.slot.model,
      cacheIsolationDomain: domain,
    },
  });
  const deadline = Date.now() + (options.waitMs ?? WAIT_MS);
  try {
    while (Date.now() < deadline) {
      const permit = await tryAcquire(db, input, requestId);
      if (permit) return permit;
      await sleep(options.pollMs ?? POLL_MS);
    }
    throw new LlmCapacityError();
  } catch (error) {
    await db.llmPermitRequest.updateMany({
      where: { id: requestId, state: "waiting" },
      data: { state: "cancelled", cancelledAt: new Date() },
    }).catch(() => undefined);
    throw error;
  }
}

function hasTerminalEvidence(evidence: TerminalEvidenceType): boolean {
  return evidence !== "terminal_unknown";
}

function settledTokens(actual: number | null | undefined, reserved: number): number {
  return actual ?? reserved;
}

export async function settleLlmPermit(
  permit: Permit,
  settlement: PermitSettlement,
  endpointKey: string,
  model: string,
  taskClass: string,
  userId: string,
  db: PermitDb = prisma,
): Promise<void> {
  const terminal = hasTerminalEvidence(settlement.terminalEvidence);
  const settledInput = settledTokens(settlement.usage?.inputTokens, permit.reservedInputTokens);
  const settledOutput = settledTokens(settlement.usage?.outputTokens, permit.reservedOutputTokens);
  await withSerializationRetry(() => db.$transaction(async (tx) => {
    const updated = await tx.llmAttempt.updateMany({
      where: { id: permit.attemptId, slotEpoch: permit.slotEpoch, state: { in: ["in_flight", "terminal_unknown"] } },
      data: {
        state: terminal ? "settled" : "terminal_unknown",
        transportOutcome: settlement.transportOutcome,
        terminalEvidence: settlement.terminalEvidence,
        stableErrorCode: settlement.stableErrorCode,
        inputTokens: settlement.usage?.inputTokens ?? null,
        outputTokens: settlement.usage?.outputTokens ?? null,
        cacheReadTokens: settlement.usage?.cacheReadTokens ?? null,
        cacheWriteTokens: settlement.usage?.cacheWriteTokens ?? null,
        settledInputTokens: terminal ? settledInput : null,
        settledOutputTokens: terminal ? settledOutput : null,
        providerFinishedAt: terminal ? new Date() : null,
        releasedAt: terminal ? new Date() : null,
        error: settlement.error?.slice(0, 1000),
      },
    });
    if (updated.count !== 1) throw new Error("模型调用许可证已失效");
    if (permit.genesisTaskId && terminal) {
      await tx.genesisTask.update({
        where: { id: permit.genesisTaskId },
        data: permit.budgetScope === "shadow" ? {
          shadowBudgetReservedIn: { decrement: permit.reservedInputTokens },
          shadowBudgetReservedOut: { decrement: permit.reservedOutputTokens },
          shadowBudgetSettledIn: { increment: settledInput },
          shadowBudgetSettledOut: { increment: settledOutput },
        } : {
          budgetReservedIn: { decrement: permit.reservedInputTokens },
          budgetReservedOut: { decrement: permit.reservedOutputTokens },
          budgetSettledIn: { increment: settledInput },
          budgetSettledOut: { increment: settledOutput },
        },
      });
    }
    if (terminal) {
      const released = await tx.llmSlot.updateMany({
        where: { slotNo: permit.slotNo, currentAttemptId: permit.attemptId, slotEpoch: permit.slotEpoch },
        data: { currentAttemptId: null, boundAt: null },
      });
      if (released.count !== 1) throw new Error("模型调用槽位已失效");
    }

    if (settlement.affectCircuit === false) return;

    const domain = isolationDomain(endpointKey, userId);
    const key = circuitKey(endpointKey, model, taskClass, domain);
    const transientFailure = [
      "UPSTREAM_TIMEOUT",
      "NETWORK_TERMINATED",
      "EMPTY_RESPONSE",
      "RATE_LIMITED",
      "SERVER_ERROR",
      "HTTP_ERROR",
    ]
      .includes(settlement.stableErrorCode ?? "");
    if (transientFailure) {
      const current = await tx.llmCircuit.upsert({
        where: { circuitKey: key },
        create: { circuitKey: key, endpointKey, model, taskClass, failureCount: 1, lastFailureCode: settlement.stableErrorCode },
        update: { failureCount: { increment: 1 }, lastFailureCode: settlement.stableErrorCode },
      });
      if (!terminal || current.state === "half_open" || current.failureCount >= CIRCUIT_THRESHOLD) {
        await tx.llmCircuit.update({
          where: { circuitKey: key },
          data: { state: "open", openUntil: new Date(Date.now() + CIRCUIT_OPEN_MS) },
        });
      }
    } else if (settlement.transportOutcome === "success") {
      await tx.llmCircuit.upsert({
        where: { circuitKey: key },
        create: { circuitKey: key, endpointKey, model, taskClass },
        update: { state: "closed", failureCount: 0, openUntil: null, probeRequestId: null, lastFailureCode: null },
      });
    }
  }, { isolationLevel: "Serializable" }));
}

export type { Permit };

export async function resolveUnknownLlmAttempt(
  attemptId: string,
  terminalEvidence: Extract<TerminalEvidenceType, "provider_terminal" | "cancel_ack" | "provider_deadline">,
  db: PermitDb = prisma,
): Promise<void> {
  const attempt = await db.llmAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.state !== "terminal_unknown") throw new LlmOperatorAttentionError();
  await settleLlmPermit({
    attemptId: attempt.id,
    slotNo: attempt.usedSlotNo,
    slotEpoch: attempt.slotEpoch,
    logicalCallId: attempt.logicalCallId,
    physicalAttemptIndex: attempt.physicalAttemptIndex,
    requestId: "operator-resolution",
    genesisTaskId: attempt.genesisTaskId ?? undefined,
    budgetScope: attempt.budgetScope === "shadow" ? "shadow" : "primary",
    reservedInputTokens: attempt.reservedInputTokens,
    reservedOutputTokens: attempt.reservedOutputTokens,
  }, {
    transportOutcome: (attempt.transportOutcome as TransportOutcome | null) ?? "unknown_error",
    terminalEvidence,
    stableErrorCode: attempt.stableErrorCode,
    error: attempt.error ?? undefined,
    affectCircuit: false,
  }, attempt.endpointKey, attempt.model, attempt.taskClass, attempt.userId, db);
}
