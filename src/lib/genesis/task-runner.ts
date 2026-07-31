import { createHash, randomUUID } from "node:crypto";
import type { GenesisTask, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isTransientLlmError } from "@/lib/llm/gateway";
import { LlmCapacityError, LlmCircuitOpenError } from "@/lib/llm/permits";
import { classifyTransportFailure } from "@/lib/llm/transport";
import { completeStructured } from "@/lib/llm/structured";
import type { CompletionRequest } from "@/lib/llm/types";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  type WorldDeck,
} from "@/lib/cards/schemas";
import {
  genesisRepairPrompt,
  genesisStageContext,
  genesisStageSystem,
  genesisStageUserPrompt,
  genesisSystem,
  genesisUserPrompt,
} from "@/lib/prompts/genesis";
import { lorebookExcerpts, parseStWorldbook } from "@/lib/lorebook/st-import";
import {
  generateLegacyStagedDeck,
  type LegacyGenesisStageId,
} from "./staged-generation";
import {
  GenesisSemanticAuditError,
  parseGenesisQualityReport,
  type GenesisQualityReport,
} from "./semantic-audit";
import { generateGenesisIntent, GenesisIntentGenerationError } from "./intent-generator";
import type { GenesisIntentContract } from "./intent";
import { enforceGenesisQuality, GenesisSemanticGateError } from "./semantic-gate";
import { recordGenesisQualityEvent } from "./quality-observability";
import { GenesisMaterialSnapshotSchema, type GenesisMaterialSnapshot } from "@/lib/materials/types";
import { materialConstraintsPrompt } from "@/lib/materials/prompt";
import { furthestStage, mergeCompletedKeys } from "./stages";
import type { GenesisStageId, GenesisTaskStatus } from "./stages";
import type { GenesisTopLevelKey } from "./json-progress";
import { buildWorldIconTheme } from "@/lib/icons/theme";
import { WorldModeSchema, type WorldMode } from "@/lib/world-mode";
import {
  GENESIS_MODEL_INPUT_MAX_BYTES,
  GENESIS_MODEL_OUTPUT_MAX_BYTES,
  GENESIS_RAW_MAX_BYTES,
  GENESIS_RAW_TTL_MS,
  PayloadLimitError,
  utf8Bytes,
} from "./limits";

const LEASE_MS = 60 * 1000;
/** 瞬时网络故障允许的最大总尝试数（attempt 在租约认领时自增）。 */
const MAX_TRANSIENT_ATTEMPTS = 3;
const LEGACY_STAGE_MAX_TOKENS: Record<LegacyGenesisStageId, number> = {
  laws: 8_000,
  gods: 18_000,
  peoples: 18_000,
  characters: 20_000,
  conflict: 10_000,
};
const GENESIS_ROUND_MAX_TOKENS = 4096;

export type GenesisTaskDto = {
  id: string;
  engineVersion: string;
  mode: WorldMode;
  status: GenesisTaskStatus;
  stage: GenesisStageId;
  completedKeys: string[];
  error: string | null;
  worldId: string | null;
  createdAt: string;
  updatedAt: string;
  /** 完整世界通过语义质量门后产生的报告；历史脏数据按 null 处理。 */
  auditReport: GenesisQualityReport | null;
  aggregateVersion: number;
  snapshotHash: string;
};

type PublicTask = Pick<
  GenesisTask,
  "id" | "mode" | "status" | "stage" | "completedKeys" | "error" | "worldId" | "createdAt" | "updatedAt"
> & Partial<Pick<GenesisTask, "auditReport" | "engineVersion">>;
type VersionedPublicTask = PublicTask & Partial<Pick<GenesisTask, "aggregateVersion">>;

export function toGenesisTaskDto(task: VersionedPublicTask): GenesisTaskDto {
  // 持久化 Json 不可尽信：兼容旧报告，形状不符一律按无审计处理。
  const auditReport = parseGenesisQualityReport(task.auditReport);
  const projection = {
    id: task.id,
    engineVersion: task.engineVersion ?? "legacy-v1",
    mode: WorldModeSchema.parse(task.mode),
    status: task.status as GenesisTaskStatus,
    stage: task.stage as GenesisStageId,
    completedKeys: task.completedKeys,
    error: task.error,
    worldId: task.worldId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    auditReport,
    aggregateVersion: task.aggregateVersion ?? 0,
  };
  return {
    ...projection,
    snapshotHash: createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex"),
  };
}

type GenesisRequestInput = {
  mode: WorldMode;
  decree: string;
  intentContract?: GenesisIntentContract;
  lorebookExcerpts?: string;
  materialConstraints?: string;
};

type GenesisRepairRequestInput = GenesisRequestInput & {
  userId: string;
  owner?: CompletionRequest["owner"];
  invalidOutput: string;
  validationError: string;
};

type GenesisRepairRequest = {
  task: "genesis";
  userId: string;
  system: string;
  user: string;
  maxTokens: number;
  maxAttempts: number;
  transportMaxAttempts: number;
  allowTransportFallback: boolean;
  cache: { namespace: string };
  maxInputBytes: number;
  maxOutputBytes: number;
  owner?: CompletionRequest["owner"];
};

export function buildGenesisRequest(input: GenesisRequestInput) {
  const shared = {
    system: genesisSystem(input.mode),
    user: genesisUserPrompt({
      mode: input.mode,
      decree: input.decree,
      intentContract: input.intentContract,
      lorebookExcerpts: input.lorebookExcerpts,
      materialConstraints: input.materialConstraints,
    }),
    maxTokens: GENESIS_ROUND_MAX_TOKENS,
  };
  return input.mode === "pantheon"
    ? { ...shared, mode: input.mode, schema: PantheonWorldDeckSchema }
    : { ...shared, mode: input.mode, schema: CreatorWorldDeckSchema };
}

export function buildGenesisRepairRequest(
  input: GenesisRepairRequestInput & { mode: "pantheon" },
): GenesisRepairRequest & { schema: typeof PantheonWorldDeckSchema };
export function buildGenesisRepairRequest(
  input: GenesisRepairRequestInput & { mode: "creator" },
): GenesisRepairRequest & { schema: typeof CreatorWorldDeckSchema };
export function buildGenesisRepairRequest(
  input: GenesisRepairRequestInput,
): GenesisRepairRequest & {
  schema: typeof PantheonWorldDeckSchema | typeof CreatorWorldDeckSchema;
} {
  const shared = {
    task: "genesis" as const,
    userId: input.userId,
    owner: input.owner,
    system: genesisSystem(input.mode),
    user: genesisRepairPrompt({
      mode: input.mode,
      decree: input.decree,
      intentContract: input.intentContract,
      lorebookExcerpts: input.lorebookExcerpts,
      invalidOutput: input.invalidOutput,
      validationError: input.validationError,
      materialConstraints: input.materialConstraints,
    }),
    maxTokens: GENESIS_ROUND_MAX_TOKENS,
    maxAttempts: 1,
    transportMaxAttempts: 1,
    allowTransportFallback: false,
    cache: { namespace: `genesis:v1:${input.mode}` },
    maxInputBytes: GENESIS_MODEL_INPUT_MAX_BYTES,
    maxOutputBytes: GENESIS_MODEL_OUTPUT_MAX_BYTES,
  };
  return input.mode === "pantheon"
    ? { ...shared, schema: PantheonWorldDeckSchema }
    : { ...shared, schema: CreatorWorldDeckSchema };
}

export async function resolveLorebookExcerpts(
  entries: ReturnType<typeof parseStWorldbook>,
  _userId?: string,
): Promise<string | undefined> {
  void _userId;
  return lorebookExcerpts(entries) || undefined;
}

type ClaimTx = {
  genesisTask: {
    updateMany(args: unknown): Promise<{ count: number }>;
    findUnique(args: unknown): Promise<GenesisTask | null>;
  };
  genesisJob: { updateMany(args: unknown): Promise<{ count: number }> };
  genesisOutbox: { create(args: unknown): Promise<unknown> };
};
type ClaimDb = {
  $transaction<T>(callback: (tx: ClaimTx) => Promise<T>): Promise<T>;
};
type LeaseTx = {
  genesisTask: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  genesisJob: { updateMany(args: unknown): Promise<{ count: number }> };
};
type LeaseDb = {
  $transaction<T>(callback: (tx: LeaseTx) => Promise<T>): Promise<T>;
};

export async function renewGenesisLease(
  db: LeaseDb,
  taskId: string,
  leaseToken: string,
  now = new Date(),
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const renewed = await tx.genesisTask.updateMany({
      where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
      data: { leaseExpiresAt },
    });
    if (renewed.count !== 1) return false;
    const mirrored = await tx.genesisJob.updateMany({
      where: { genesisTaskId: taskId, nodeKey: "legacy-world-deck", leaseToken, status: "running" },
      data: { leaseExpiresAt },
    });
    if (mirrored.count !== 1) throw new Error("创世任务作业租约已失效");
    return true;
  });
}


/** Atomic lease claim. A live running task cannot be started by a second SSE connection. */
export async function claimGenesisTask(
  db: ClaimDb,
  taskId: string,
  now = new Date(),
): Promise<GenesisTask | null> {
  const leaseToken = randomUUID();
  return db.$transaction(async (tx) => {
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed = await tx.genesisTask.updateMany({
      where: {
        id: taskId,
        OR: [
          { status: "queued" },
          {
            status: { in: ["running", "repairing"] },
            leaseExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        status: "running",
        error: null,
        leaseToken,
        leaseExpiresAt,
        attempt: { increment: 1 },
        aggregateVersion: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    const task = await tx.genesisTask.findUnique({ where: { id: taskId } });
    if (!task) throw new Error("创世任务领取后消失");
    const mirrored = await tx.genesisJob.updateMany({
      where: { genesisTaskId: taskId, nodeKey: "legacy-world-deck" },
      data: {
        status: "running",
        leaseToken,
        leaseEpoch: { increment: 1 },
        leaseExpiresAt,
        attempt: task.attempt,
        startedAt: now,
        completedAt: null,
        error: null,
      },
    });
    if (mirrored.count !== 1) throw new Error("创世任务缺少持久作业");
    await tx.genesisOutbox.create({
      data: {
        taskId,
        aggregateVersion: task.aggregateVersion,
        eventType: "task_started",
        payloadProjection: { status: "running", stage: task.stage },
      },
    });
    return task;
  });
}

const activeRunners = new Map<string, Promise<void>>();

type GenesisTaskRunnerDeps = {
  db: typeof prisma;
  claimTask: typeof claimGenesisTask;
  resolveLorebook: typeof resolveLorebookExcerpts;
  generateIntent: typeof generateGenesisIntent;
  buildRequest: typeof buildGenesisRequest;
  buildRepairRequest: typeof buildGenesisRepairRequest;
  generateDeck: typeof generateLegacyStagedDeck;
  qualityGate: typeof enforceGenesisQuality;
  recordQualityEvent: typeof recordGenesisQualityEvent;
  persistWorld: typeof persistWorld;
};

const defaultGenesisTaskRunnerDeps: GenesisTaskRunnerDeps = {
  db: prisma,
  claimTask: claimGenesisTask,
  resolveLorebook: resolveLorebookExcerpts,
  generateIntent: generateGenesisIntent,
  buildRequest: buildGenesisRequest,
  buildRepairRequest: buildGenesisRepairRequest,
  generateDeck: generateLegacyStagedDeck,
  qualityGate: enforceGenesisQuality,
  recordQualityEvent: recordGenesisQualityEvent,
  persistWorld,
};

class GenesisPersistedIntentError extends Error {
  override name = "GenesisPersistedIntentError";

  constructor(message = "已冻结的创世意图契约已损坏") {
    super(message);
  }
}

export function ensureGenesisTaskRunning(taskId: string): void {
  if (activeRunners.has(taskId)) return;
  const promise = runGenesisTask(taskId).finally(() => activeRunners.delete(taskId));
  activeRunners.set(taskId, promise);
  void promise.catch(() => {
    // runGenesisTask persists its own failure state. Avoid an unhandled rejection in
    // a detached route-handler task.
  });
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/(?:sk-|AIza|key-)[A-Za-z0-9_\-.]{8,}/g, "[已隐藏密钥]")
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

export async function runGenesisTask(
  taskId: string,
  dependencies: Partial<GenesisTaskRunnerDeps> = {},
): Promise<void> {
  const deps = { ...defaultGenesisTaskRunnerDeps, ...dependencies };
  const task = await deps.claimTask(deps.db as unknown as ClaimDb, taskId);
  if (!task?.leaseToken) return;

  const leaseToken = task.leaseToken;
  const currentLlmOwner = async () => {
    const currentJob = await deps.db.genesisJob.findUniqueOrThrow({
      where: { genesisTaskId_nodeKey: { genesisTaskId: taskId, nodeKey: "legacy-world-deck" } },
      select: { id: true, leaseEpoch: true, leaseExpiresAt: true },
    });
    return {
      kind: "genesis_job" as const,
      id: currentJob.id,
      genesisTaskId: taskId,
      genesisJobId: currentJob.id,
      leaseEpoch: currentJob.leaseEpoch,
      leaseExpiresAt: currentJob.leaseExpiresAt?.toISOString(),
      budgetScope: "primary" as const,
    };
  };
  let persistedKeys = mergeCompletedKeys([], task.completedKeys as GenesisTopLevelKey[]);
  let persistedStage = task.stage as GenesisStageId;
  let latestRaw = task.rawOutput;

  let parsedEntries: ReturnType<typeof parseStWorldbook> = [];
  let excerpts: string | undefined;

  const updateOwnedTask = async (
    data: Prisma.GenesisTaskUpdateManyMutationInput,
    eventType?: string,
    eventDetails?: Record<string, string>,
  ) => {
    if (eventType) {
      await deps.db.$transaction(async (tx) => {
        const current = await tx.genesisTask.findFirst({
          where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
          select: { aggregateVersion: true },
        });
        if (!current) throw new Error("创世任务租约已失效");
        const aggregateVersion = current.aggregateVersion + 1;
        const updated = await tx.genesisTask.updateMany({
          where: {
            id: taskId,
            leaseToken,
            aggregateVersion: current.aggregateVersion,
            status: { in: ["running", "repairing"] },
          },
          data: { ...data, aggregateVersion },
        });
        if (updated.count !== 1) throw new Error("创世任务租约已失效");
        const mirrored = await tx.genesisJob.updateMany({
          where: { genesisTaskId: taskId, nodeKey: "legacy-world-deck", leaseToken },
          data: { status: "running", leaseToken, leaseExpiresAt: data.leaseExpiresAt ?? undefined },
        });
        if (mirrored.count !== 1) throw new Error("创世任务作业租约已失效");
        await tx.genesisOutbox.create({
          data: {
            taskId,
            aggregateVersion,
            eventType,
            payloadProjection: {
              status: data.status ?? "running",
              stage: data.stage ?? persistedStage,
              ...eventDetails,
            },
          },
        });
      });
      return;
    }
    const result = await deps.db.genesisTask.updateMany({
      where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
      data,
    });
    if (result.count !== 1) throw new Error("创世任务租约已失效");
  };

  const leaseHeartbeat = setInterval(() => {
    void renewGenesisLease(deps.db as unknown as LeaseDb, taskId, leaseToken).catch(() => {});
  }, Math.floor(LEASE_MS / 3));

  try {
    parsedEntries = task.lorebook ? parseStWorldbook(task.lorebook) : [];
    excerpts = await deps.resolveLorebook(parsedEntries);
    const materialSnapshot: GenesisMaterialSnapshot | null = task.materialSelection == null
      ? null
      : GenesisMaterialSnapshotSchema.parse(task.materialSelection);
    const mode = WorldModeSchema.parse(task.mode);
    const materialText = materialConstraintsPrompt(materialSnapshot, mode);
    if (task.stage === "oracle") {
      persistedStage = "laws";
      await updateOwnedTask({ stage: persistedStage }, "stage_changed");
    }

    const deck = await deps.generateDeck({
      mode,
      materialSnapshot: materialSnapshot ?? null,
      checkpoint: task.rawOutput,
      completeStage: async (input) => {
        const owner = await currentLlmOwner();
        return completeStructured("narrative", {
          task: "genesis",
          userId: task.userId,
          owner,
          system: genesisStageSystem({
            mode,
            stageId: input.stageId,
            schema: input.schema,
          }),
          stableContext: [genesisStageContext(input.acceptedOutputs)],
          user: genesisStageUserPrompt({
            mode,
            stageId: input.stageId,
            decree: task.decree,
            lorebookExcerpts: excerpts,
            materialConstraints: materialText,
            previousOutput: input.previousOutput,
            validationError: input.validationError,
          }),
          schema: input.schema,
          maxAttempts: 2,
          transportMaxAttempts: 2,
          allowTransportFallback: true,
          maxTokens: LEGACY_STAGE_MAX_TOKENS[input.stageId],
          failOnTruncation: true,
          cache: { namespace: `genesis:v1-staged:${mode}:${input.stageId}` },
          maxInputBytes: GENESIS_MODEL_INPUT_MAX_BYTES,
          maxOutputBytes: GENESIS_MODEL_OUTPUT_MAX_BYTES,
        });
      },
      onCheckpointRecovery: async ({ nextStage, completedKeys, checkpoint, reason }) => {
        const checkpointBytes = utf8Bytes(checkpoint);
        if (checkpointBytes > GENESIS_RAW_MAX_BYTES) {
          throw new PayloadLimitError(
            "OUTPUT_LIMIT_EXCEEDED",
            checkpointBytes,
            GENESIS_RAW_MAX_BYTES,
            "",
          );
        }
        persistedKeys = completedKeys;
        persistedStage = nextStage;
        latestRaw = checkpoint;
        await updateOwnedTask({
          status: "running",
          completedKeys: persistedKeys,
          stage: persistedStage,
          rawOutput: latestRaw,
          rawExpiresAt: new Date(Date.now() + GENESIS_RAW_TTL_MS),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        }, "checkpoint_recovered", { reason });
      },
      onCheckpoint: async ({ completedKeys, checkpoint }) => {
        const checkpointBytes = utf8Bytes(checkpoint);
        if (checkpointBytes > GENESIS_RAW_MAX_BYTES) {
          throw new PayloadLimitError(
            "OUTPUT_LIMIT_EXCEEDED",
            checkpointBytes,
            GENESIS_RAW_MAX_BYTES,
            latestRaw ?? "",
          );
        }
        latestRaw = checkpoint;
        const nextKeys = mergeCompletedKeys(persistedKeys, completedKeys);
        const visibleChanged = nextKeys.length !== persistedKeys.length;
        persistedKeys = nextKeys;
        await updateOwnedTask({
          completedKeys: persistedKeys,
          stage: persistedStage,
          rawOutput: latestRaw,
          rawExpiresAt: new Date(Date.now() + GENESIS_RAW_TTL_MS),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        }, visibleChanged ? "progress_changed" : undefined);
      },
      onStage: async (stage) => {
        const nextStage = furthestStage(persistedStage, stage);
        const visibleChanged = nextStage !== persistedStage || stage === "repair";
        persistedStage = nextStage;
        await updateOwnedTask({
          stage: persistedStage,
          ...(stage === "repair" ? { status: "repairing" } : {}),
          rawOutput: latestRaw,
          rawExpiresAt: latestRaw ? new Date(Date.now() + GENESIS_RAW_TTL_MS) : null,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        }, visibleChanged ? "stage_changed" : undefined);
      },
    });

    persistedStage = furthestStage(persistedStage, "saving");
    await updateOwnedTask({
      stage: persistedStage,
      status: "running",
      rawOutput: latestRaw,
      rawExpiresAt: latestRaw ? new Date(Date.now() + GENESIS_RAW_TTL_MS) : null,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    }, "stage_changed");
    clearInterval(leaseHeartbeat);
    await deps.persistWorld(
      deps.db as unknown as PersistWorldDb,
      task,
      leaseToken,
      deck,
      null,
      parsedEntries,
    );
  } catch (error) {
    const terminalQualityFailure = error instanceof GenesisIntentGenerationError
      || error instanceof GenesisSemanticAuditError
      || error instanceof GenesisSemanticGateError
      || error instanceof GenesisPersistedIntentError;
    // 质量契约错误必须先于 generic terminal_unknown 判定，绝不重排队或等待 provider。
    const transportFailure = classifyTransportFailure(error);
    const waitingForProvider = !terminalQualityFailure && (
      error instanceof LlmCircuitOpenError
      || (transportFailure.terminalEvidence === "terminal_unknown"
        && transportFailure.stableErrorCode !== "UNKNOWN_ERROR")
    );
    const capacityWait = error instanceof LlmCapacityError;
    const transient = !terminalQualityFailure
      && !waitingForProvider
      && isTransientLlmError(error)
      && task.attempt < MAX_TRANSIENT_ATTEMPTS;
    const requeue = capacityWait || transient;
    const terminalError = requeue ? null : safeError(error);
    await deps.db.$transaction(async (tx) => {
      const current = await tx.genesisTask.findFirst({
        where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
        select: { aggregateVersion: true },
      });
      if (!current) return;
      const aggregateVersion = current.aggregateVersion + 1;
      const updated = await tx.genesisTask.updateMany({
        where: { id: taskId, leaseToken, aggregateVersion: current.aggregateVersion },
        data: {
          status: waitingForProvider ? "waiting_for_provider" : requeue ? "queued" : "failed",
          error: terminalError,
          ...(error instanceof GenesisSemanticGateError
            ? { auditReport: error.report as unknown as Prisma.InputJsonValue }
            : {}),
          rawOutput: latestRaw,
          rawExpiresAt: latestRaw ? new Date(Date.now() + GENESIS_RAW_TTL_MS) : null,
          leaseToken: null,
          leaseExpiresAt: null,
          aggregateVersion,
        },
      });
      if (updated.count !== 1) return;
      const mirrored = await tx.genesisJob.updateMany({
        where: { genesisTaskId: taskId, nodeKey: "legacy-world-deck", leaseToken },
        data: {
          status: waitingForProvider ? "waiting_for_provider" : requeue ? "queued" : "failed",
          error: terminalError,
          leaseToken: null,
          leaseExpiresAt: null,
          completedAt: requeue || waitingForProvider ? null : new Date(),
        },
      });
      if (mirrored.count !== 1) throw new Error("创世任务作业租约已失效");
      await tx.genesisOutbox.create({
        data: {
          taskId,
          aggregateVersion,
          eventType: waitingForProvider
            ? "task_waiting_for_provider"
            : requeue ? "task_requeued" : "task_failed",
          payloadProjection: {
            status: waitingForProvider ? "waiting_for_provider" : requeue ? "queued" : "failed",
            stage: persistedStage,
            ...(terminalError ? { error: terminalError } : {}),
          },
        },
      });
    });
    if (requeue || waitingForProvider) {
      const { wakeGenesisScheduler } = await import("./scheduler");
      wakeGenesisScheduler();
    }
  } finally {
    clearInterval(leaseHeartbeat);
  }
}

type PersistWorldTx = {
  genesisTask: {
    findFirst(args: unknown): Promise<{ id: string; aggregateVersion: number } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  genesisJob: { updateMany(args: unknown): Promise<{ count: number }> };
  genesisOutbox: { create(args: unknown): Promise<unknown> };
  world: {
    create(args: unknown): Promise<{ id: string }>;
  };
};

type PersistWorldDb = {
  $transaction(
    callback: (tx: PersistWorldTx) => Promise<void>,
    options?: { isolationLevel?: "Serializable" },
  ): Promise<unknown>;
};

export async function persistWorld(
  db: PersistWorldDb,
  task: GenesisTask,
  leaseToken: string,
  deck: WorldDeck,
  intent: GenesisIntentContract | null,
  parsedEntries: ReturnType<typeof parseStWorldbook>,
) {
  const mode = WorldModeSchema.parse(task.mode);
  if (deck.mode !== mode) {
    throw new Error(`创世卡组模式不匹配：任务为 ${mode}，卡组为 ${deck.mode}`);
  }

  await db.$transaction(async (tx) => {
    const owned = await tx.genesisTask.findFirst({
      where: { id: task.id, leaseToken, status: { in: ["running", "repairing"] } },
      select: { id: true, aggregateVersion: true },
    });
    if (!owned) throw new Error("创世任务租约已失效");

    const world = await tx.world.create({
      data: {
        userId: task.userId,
        name: deck.worldName,
        genesisInput: task.decree,
        genesisIntent: intent
          ? (intent as unknown as Prisma.InputJsonValue)
          : undefined,
        mode,
        status: "draft",
        draftDeck: deck as unknown as Prisma.InputJsonValue,
        themeCard: deck.theme as unknown as Prisma.InputJsonValue,
        styleCard: deck.style as unknown as Prisma.InputJsonValue,
        cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
        fusionAxiom: deck.fusionAxiom
          ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
          : undefined,
        iconTheme: buildWorldIconTheme(deck) as unknown as Prisma.InputJsonValue,
        lorebookEntries: {
          create: parsedEntries.map((entry) => ({
            keys: entry.keys,
            content: entry.content,
            enabled: entry.enabled,
            stExtra: entry.stExtra as Prisma.InputJsonValue,
            source: "imported",
          })),
        },
      },
    });

    const aggregateVersion = owned.aggregateVersion + 1;
    const completed = await tx.genesisTask.updateMany({
      where: { id: task.id, leaseToken, status: { in: ["running", "repairing"] } },
      data: {
        status: "completed",
        stage: "completed",
        completedKeys: Object.keys(deck),
        rawOutput: "",
        rawExpiresAt: null,
        error: null,
        worldId: world.id,
        leaseToken: null,
        leaseExpiresAt: null,
        aggregateVersion,
      },
    });
    if (completed.count !== 1) throw new Error("创世任务租约已失效");
    const completedJob = await tx.genesisJob.updateMany({
      where: { genesisTaskId: task.id, nodeKey: "legacy-world-deck", leaseToken },
      data: {
        status: "completed",
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        error: null,
      },
    });
    if (completedJob.count !== 1) throw new Error("创世任务作业租约已失效");
    await tx.genesisOutbox.create({
      data: {
        taskId: task.id,
        aggregateVersion,
        eventType: "task_completed",
        payloadProjection: { status: "completed", stage: "completed", worldId: world.id },
      },
    });
  }, { isolationLevel: "Serializable" });
}
