import { createHash, randomUUID } from "node:crypto";
import type { GenesisTask, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isTransientLlmError, stream } from "@/lib/llm/gateway";
import { completeStructured } from "@/lib/llm/structured";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  type WorldDeck,
} from "@/lib/cards/schemas";
import { genesisRepairPrompt, genesisSystem, genesisUserPrompt } from "@/lib/prompts/genesis";
import { fallbackLorebookExcerpts, parseStWorldbook } from "@/lib/lorebook/st-import";
import { classifyLoreEntries } from "@/lib/lore-index/classifier";
import { LORE_GENESIS_BUDGET_CHARS, selectLoreForGenesis } from "@/lib/lore-index/selection";
import { generateGenesisDeck } from "./generate";
import {
  auditTemporalSemantics,
  TemporalAuditResultSchema,
  type TemporalAuditResult,
} from "./temporal-audit";
import { GenesisMaterialSnapshotSchema, type GenesisMaterialSnapshot } from "@/lib/materials/types";
import { materialConstraintsPrompt } from "@/lib/materials/prompt";
import { deriveStreamingStage, furthestStage, mergeCompletedKeys } from "./stages";
import type { GenesisStageId, GenesisTaskStatus } from "./stages";
import type { GenesisTopLevelKey } from "./json-progress";
import { buildWorldIconTheme } from "@/lib/icons/theme";
import { WorldModeSchema, type WorldMode } from "@/lib/world-mode";
import {
  GENESIS_MODEL_INPUT_MAX_BYTES,
  GENESIS_MODEL_OUTPUT_MAX_BYTES,
  GENESIS_RAW_MAX_BYTES,
  GENESIS_RAW_TTL_MS,
  takeUtf8Prefix,
} from "./limits";

const LEASE_MS = 60 * 1000;
/** 瞬时网络故障允许的最大总尝试数（attempt 在租约认领时自增）。 */
const MAX_TRANSIENT_ATTEMPTS = 3;
const CHECKPOINT_MS = 1_000;
/** Keep each upstream generation round below common relay timeouts; gateway continuation stitches the full deck. */
const GENESIS_ROUND_MAX_TOKENS = 4096;

export type GenesisTaskDto = {
  id: string;
  mode: WorldMode;
  status: GenesisTaskStatus;
  stage: GenesisStageId;
  completedKeys: string[];
  error: string | null;
  worldId: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 报告型 AI 语义审计结果（时间一致设计稿 §10.4）。仅 IP 世界产出；
   * 原创世界、旧任务或审计调用失败为 null。确认页只读展示，不阻断。
   */
  auditReport: TemporalAuditResult | null;
  aggregateVersion: number;
  snapshotHash: string;
};

type PublicTask = Pick<
  GenesisTask,
  "id" | "mode" | "status" | "stage" | "completedKeys" | "error" | "worldId" | "createdAt" | "updatedAt"
> & Partial<Pick<GenesisTask, "auditReport">>;
type VersionedPublicTask = PublicTask & Partial<Pick<GenesisTask, "aggregateVersion">>;

export function toGenesisTaskDto(task: VersionedPublicTask): GenesisTaskDto {
  // 持久化 Json 不可尽信：形状不符（历史脏数据）一律按无审计处理，DTO 永不抛错。
  const audit = TemporalAuditResultSchema.safeParse(task.auditReport);
  const projection = {
    id: task.id,
    mode: WorldModeSchema.parse(task.mode),
    status: task.status as GenesisTaskStatus,
    stage: task.stage as GenesisStageId,
    completedKeys: task.completedKeys,
    error: task.error,
    worldId: task.worldId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    auditReport: audit.success ? audit.data : null,
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
  lorebookExcerpts?: string;
  materialConstraints?: string;
};

type GenesisRepairRequestInput = GenesisRequestInput & {
  userId: string;
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
};

export function buildGenesisRequest(input: GenesisRequestInput) {
  const shared = {
    system: genesisSystem(input.mode),
    user: genesisUserPrompt({
      mode: input.mode,
      decree: input.decree,
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
export function buildGenesisRepairRequest(input: GenesisRepairRequestInput) {
  const shared = {
    task: "genesis" as const,
    userId: input.userId,
    system: genesisSystem(input.mode),
    user: genesisRepairPrompt({
      mode: input.mode,
      decree: input.decree,
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

type ResolveLoreExcerptsDeps = {
  classify: typeof classifyLoreEntries;
  select: typeof selectLoreForGenesis;
};

/**
 * 创世注入切换（时间一致设计稿 §11，T4b）：
 *
 * 1. 任务携带世界书 → 触发 classifyLoreEntries（backstage 槽位，幂等，
 *    已索引条目按 sourceKey 跨创世复用）；
 * 2. 分类成功 → 用 selectLoreForGenesis 的类别预算选择（≈8000 字符）
 *    替代原始上传序截取；
 * 3. 分类失败/缺席 → 回退到与既有 lorebookExcerpts 逐字节一致的原始摘录，
 *    仅前置一行「资料索引不可用，按原始顺序注入」（不阻断创世）。
 */
export async function resolveLorebookExcerpts(
  entries: ReturnType<typeof parseStWorldbook>,
  userId: string,
  deps: ResolveLoreExcerptsDeps = { classify: classifyLoreEntries, select: selectLoreForGenesis },
): Promise<string | undefined> {
  if (!entries.length) return undefined;
  const indexRows = await deps.classify(entries, "backstage", { userId });
  if (indexRows !== null) {
    const { excerpt } = deps.select(indexRows, LORE_GENESIS_BUDGET_CHARS);
    return excerpt || undefined;
  }
  return fallbackLorebookExcerpts(entries) || undefined;
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

async function runGenesisTask(taskId: string): Promise<void> {
  const task = await claimGenesisTask(prisma as unknown as ClaimDb, taskId);
  if (!task?.leaseToken) return;

  const leaseToken = task.leaseToken;
  let persistedKeys = mergeCompletedKeys([], task.completedKeys as GenesisTopLevelKey[]);
  let persistedStage = task.stage as GenesisStageId;
  let latestRaw = "";
  let lastCheckpoint = 0;

  let parsedEntries: ReturnType<typeof parseStWorldbook> = [];
  let excerpts: string | undefined;

  const updateOwnedTask = async (
    data: Prisma.GenesisTaskUpdateManyMutationInput,
    eventType?: string,
  ) => {
    if (eventType) {
      await prisma.$transaction(async (tx) => {
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
            },
          },
        });
      });
      return;
    }
    const result = await prisma.genesisTask.updateMany({
      where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
      data,
    });
    if (result.count !== 1) throw new Error("创世任务租约已失效");
  };

  const leaseHeartbeat = setInterval(() => {
    void renewGenesisLease(prisma as unknown as LeaseDb, taskId, leaseToken).catch(() => {});
  }, Math.floor(LEASE_MS / 3));

  try {
    parsedEntries = task.lorebook ? parseStWorldbook(task.lorebook) : [];
    excerpts = await resolveLorebookExcerpts(parsedEntries, task.userId);
    const materialSnapshot: GenesisMaterialSnapshot | null = task.materialSelection == null
      ? null
      : GenesisMaterialSnapshotSchema.parse(task.materialSelection);
    const mode = WorldModeSchema.parse(task.mode);
    const materialText = materialConstraintsPrompt(materialSnapshot, mode);
    const genesisRequest = buildGenesisRequest({
      mode,
      decree: task.decree,
      lorebookExcerpts: excerpts,
      materialConstraints: materialText,
    });
    if (task.stage === "oracle") {
      persistedStage = "laws";
      await updateOwnedTask({ stage: persistedStage }, "stage_changed");
    }

    const deck = await generateGenesisDeck({
      mode,
      decree: task.decree,
      lorebookExcerpts: excerpts,
      materialSnapshot,
      maxOutputBytes: GENESIS_MODEL_OUTPUT_MAX_BYTES,
      streamCompletion: async function* () {
        for await (const chunk of stream("narrative", {
          task: "genesis",
          userId: task.userId,
          maxTokens: genesisRequest.maxTokens,
          failOnTruncation: true,
          cache: { namespace: `genesis:v1:${mode}` },
          messages: [
            { role: "system", content: genesisRequest.system, cacheScope: "global" },
            { role: "user", content: genesisRequest.user, cacheScope: "dynamic" },
          ],
        }, {
          maxInputBytes: GENESIS_MODEL_INPUT_MAX_BYTES,
          maxOutputBytes: GENESIS_MODEL_OUTPUT_MAX_BYTES,
        })) {
          if (chunk.type === "text") yield chunk.text;
        }
      },
      repairCompletion: (input) => {
        const sharedRepairRequest = {
          userId: task.userId,
          decree: task.decree,
          lorebookExcerpts: excerpts,
          invalidOutput: input.invalidOutput,
          validationError: input.validationError,
          materialConstraints: materialText,
        };
        return input.mode === "pantheon"
          ? completeStructured("narrative", buildGenesisRepairRequest({
            ...sharedRepairRequest,
            mode: input.mode,
          }))
          : completeStructured("narrative", buildGenesisRepairRequest({
            ...sharedRepairRequest,
            mode: input.mode,
          }));
      },
      onChunk: async (rawOutput) => {
        latestRaw = takeUtf8Prefix(rawOutput, GENESIS_RAW_MAX_BYTES);
        const now = Date.now();
        if (now - lastCheckpoint < CHECKPOINT_MS) return;
        lastCheckpoint = now;
        await updateOwnedTask({
          rawOutput: latestRaw,
          rawExpiresAt: new Date(now + GENESIS_RAW_TTL_MS),
          leaseExpiresAt: new Date(now + LEASE_MS),
        });
      },
      onProgress: async (completedKeys, rawOutput) => {
        latestRaw = takeUtf8Prefix(rawOutput, GENESIS_RAW_MAX_BYTES);
        const nextKeys = mergeCompletedKeys(persistedKeys, completedKeys);
        const nextStage = furthestStage(persistedStage, deriveStreamingStage(nextKeys, mode));
        const visibleChanged = nextStage !== persistedStage
          || nextKeys.length !== persistedKeys.length;
        persistedKeys = nextKeys;
        persistedStage = nextStage;
        await updateOwnedTask({
          completedKeys: persistedKeys,
          stage: persistedStage,
          rawOutput: latestRaw,
          rawExpiresAt: new Date(Date.now() + GENESIS_RAW_TTL_MS),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        }, visibleChanged ? "progress_changed" : undefined);
        lastCheckpoint = Date.now();
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

    // 报告型 AI 语义审计（§10.4）：校验通过后、落库前执行一次；仅 IP 世界
    // （temporalAnchor 存在 ∧ basis≠original）触发模型调用。审计失败返回 null
    // → 不落任何报告，静默跳过——绝不阻断创世。租约心跳仍在运行，覆盖调用时长。
    const auditReport = await auditTemporalSemantics(deck, {
      userId: task.userId,
      lorebookExcerpts: excerpts,
    });

    persistedStage = furthestStage(persistedStage, "saving");
    await updateOwnedTask({
      stage: persistedStage,
      status: "running",
      rawOutput: latestRaw,
      rawExpiresAt: latestRaw ? new Date(Date.now() + GENESIS_RAW_TTL_MS) : null,
      ...(auditReport === null
        ? {}
        : { auditReport: auditReport as unknown as Prisma.InputJsonValue }),
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    }, "stage_changed");
    clearInterval(leaseHeartbeat);
    await persistWorld(prisma as unknown as PersistWorldDb, task, leaseToken, deck, parsedEntries);
  } catch (error) {
    // 瞬时网络故障（中转站掐断长响应等）自动重排队，而非终局失败；其余错误照旧终局。
    const transient = isTransientLlmError(error) && task.attempt < MAX_TRANSIENT_ATTEMPTS;
    const terminalError = transient ? null : safeError(error);
    await prisma.$transaction(async (tx) => {
      const current = await tx.genesisTask.findFirst({
        where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
        select: { aggregateVersion: true },
      });
      if (!current) return;
      const aggregateVersion = current.aggregateVersion + 1;
      const updated = await tx.genesisTask.updateMany({
        where: { id: taskId, leaseToken, aggregateVersion: current.aggregateVersion },
        data: {
          status: transient ? "queued" : "failed",
          error: terminalError,
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
          status: transient ? "queued" : "failed",
          error: terminalError,
          leaseToken: null,
          leaseExpiresAt: null,
          completedAt: transient ? null : new Date(),
        },
      });
      if (mirrored.count !== 1) throw new Error("创世任务作业租约已失效");
      await tx.genesisOutbox.create({
        data: {
          taskId,
          aggregateVersion,
          eventType: transient ? "task_requeued" : "task_failed",
          payloadProjection: {
            status: transient ? "queued" : "failed",
            stage: persistedStage,
            ...(terminalError ? { error: terminalError } : {}),
          },
        },
      });
    });
    if (transient) {
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
