import { randomUUID } from "node:crypto";
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

const USER_ID = "local";
const LEASE_MS = 60 * 1000;
/** 瞬时网络故障允许的最大总尝试数（attempt 在租约认领时自增）。 */
const MAX_TRANSIENT_ATTEMPTS = 3;
const TRANSIENT_RETRY_DELAY_MS = 5 * 1000;
const CHECKPOINT_MS = 1_000;

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
};

type PublicTask = Pick<
  GenesisTask,
  "id" | "mode" | "status" | "stage" | "completedKeys" | "error" | "worldId" | "createdAt" | "updatedAt"
> & Partial<Pick<GenesisTask, "auditReport">>;

export function toGenesisTaskDto(task: PublicTask): GenesisTaskDto {
  // 持久化 Json 不可尽信：形状不符（历史脏数据）一律按无审计处理，DTO 永不抛错。
  const audit = TemporalAuditResultSchema.safeParse(task.auditReport);
  return {
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
  };
}

type GenesisRequestInput = {
  mode: WorldMode;
  decree: string;
  lorebookExcerpts?: string;
  materialConstraints?: string;
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
  };
  return input.mode === "pantheon"
    ? { ...shared, mode: input.mode, schema: PantheonWorldDeckSchema }
    : { ...shared, mode: input.mode, schema: CreatorWorldDeckSchema };
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
  deps: ResolveLoreExcerptsDeps = { classify: classifyLoreEntries, select: selectLoreForGenesis },
): Promise<string | undefined> {
  if (!entries.length) return undefined;
  const indexRows = await deps.classify(entries, "backstage");
  if (indexRows !== null) {
    const { excerpt } = deps.select(indexRows, LORE_GENESIS_BUDGET_CHARS);
    return excerpt || undefined;
  }
  return fallbackLorebookExcerpts(entries) || undefined;
}

type ClaimDb = {
  genesisTask: {
    updateMany(args: unknown): Promise<{ count: number }>;
    findUnique(args: unknown): Promise<GenesisTask | null>;
  };
};
type LeaseDb = {
  genesisTask: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function renewGenesisLease(
  db: LeaseDb,
  taskId: string,
  leaseToken: string,
  now = new Date(),
): Promise<boolean> {
  const renewed = await db.genesisTask.updateMany({
    where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
    data: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  });
  return renewed.count === 1;
}


/** Atomic lease claim. A live running task cannot be started by a second SSE connection. */
export async function claimGenesisTask(
  db: ClaimDb,
  taskId: string,
  now = new Date(),
): Promise<GenesisTask | null> {
  const leaseToken = randomUUID();
  const claimed = await db.genesisTask.updateMany({
    where: {
      id: taskId,
      userId: USER_ID,
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
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempt: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return null;
  return db.genesisTask.findUnique({ where: { id: taskId } });
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

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:sk-|AIza|key-)[A-Za-z0-9_\-.]{8,}/g, "[已隐藏密钥]").slice(0, 1000);
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

  const updateOwnedTask = async (data: Prisma.GenesisTaskUpdateManyMutationInput) => {
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
    excerpts = await resolveLorebookExcerpts(parsedEntries);
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
      await updateOwnedTask({ stage: "laws" });
    }

    const deck = await generateGenesisDeck({
      mode,
      decree: task.decree,
      lorebookExcerpts: excerpts,
      materialSnapshot,
      streamCompletion: async function* () {
        for await (const chunk of stream("narrative", {
          task: "genesis",
          userId: USER_ID,
          maxTokens: 16000,
          failOnTruncation: true,
          cache: { namespace: `genesis:v1:${mode}` },
          messages: [
            { role: "system", content: genesisRequest.system, cacheScope: "global" },
            { role: "user", content: genesisRequest.user, cacheScope: "dynamic" },
          ],
        })) {
          if (chunk.type === "text") yield chunk.text;
        }
      },
      repairCompletion: (input) => {
        const repairPrompt = genesisRepairPrompt({
          mode: input.mode,
          decree: task.decree,
          lorebookExcerpts: excerpts,
          invalidOutput: input.invalidOutput,
          validationError: input.validationError,
          materialConstraints: materialText,
        });
        const request = {
          task: "genesis" as const,
          userId: USER_ID,
          system: genesisSystem(input.mode),
          user: repairPrompt,
          maxTokens: 16000,
          cache: { namespace: `genesis:v1:${input.mode}` },
        };
        return input.mode === "pantheon"
          ? completeStructured("narrative", { ...request, schema: input.schema })
          : completeStructured("narrative", { ...request, schema: input.schema });
      },
      onChunk: async (rawOutput) => {
        latestRaw = rawOutput;
        const now = Date.now();
        if (now - lastCheckpoint < CHECKPOINT_MS) return;
        lastCheckpoint = now;
        await updateOwnedTask({
          rawOutput: latestRaw,
          leaseExpiresAt: new Date(now + LEASE_MS),
        });
      },
      onProgress: async (completedKeys, rawOutput) => {
        latestRaw = rawOutput;
        persistedKeys = mergeCompletedKeys(persistedKeys, completedKeys);
        persistedStage = furthestStage(persistedStage, deriveStreamingStage(persistedKeys, mode));
        await updateOwnedTask({
          completedKeys: persistedKeys,
          stage: persistedStage,
          rawOutput: latestRaw,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        });
        lastCheckpoint = Date.now();
      },
      onStage: async (stage) => {
        persistedStage = furthestStage(persistedStage, stage);
        await updateOwnedTask({
          stage: persistedStage,
          ...(stage === "repair" ? { status: "repairing" } : {}),
          rawOutput: latestRaw,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        });
      },
    });

    // 报告型 AI 语义审计（§10.4）：校验通过后、落库前执行一次；仅 IP 世界
    // （temporalAnchor 存在 ∧ basis≠original）触发模型调用。审计失败返回 null
    // → 不落任何报告，静默跳过——绝不阻断创世。租约心跳仍在运行，覆盖调用时长。
    const auditReport = await auditTemporalSemantics(deck, { lorebookExcerpts: excerpts });

    persistedStage = furthestStage(persistedStage, "saving");
    await updateOwnedTask({
      stage: persistedStage,
      status: "running",
      rawOutput: latestRaw,
      ...(auditReport === null
        ? {}
        : { auditReport: auditReport as unknown as Prisma.InputJsonValue }),
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    });
    clearInterval(leaseHeartbeat);
    await persistWorld(prisma as unknown as PersistWorldDb, task, leaseToken, deck, parsedEntries);
  } catch (error) {
    // 瞬时网络故障（中转站掐断长响应等）自动重排队，而非终局失败；其余错误照旧终局。
    const transient = isTransientLlmError(error) && task.attempt < MAX_TRANSIENT_ATTEMPTS;
    await prisma.genesisTask.updateMany({
      where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
      data: transient
        ? {
            status: "queued",
            error: null,
            rawOutput: latestRaw,
            leaseToken: null,
            leaseExpiresAt: null,
          }
        : {
            status: "failed",
            error: safeError(error),
            rawOutput: latestRaw,
            leaseToken: null,
            leaseExpiresAt: null,
          },
    });
    if (transient) {
      setTimeout(() => ensureGenesisTaskRunning(taskId), TRANSIENT_RETRY_DELAY_MS);
    }
  } finally {
    clearInterval(leaseHeartbeat);
  }
}

type PersistWorldTx = {
  genesisTask: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
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
      select: { id: true },
    });
    if (!owned) throw new Error("创世任务租约已失效");

    const world = await tx.world.create({
      data: {
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

    const completed = await tx.genesisTask.updateMany({
      where: { id: task.id, leaseToken, status: { in: ["running", "repairing"] } },
      data: {
        status: "completed",
        stage: "completed",
        completedKeys: Object.keys(deck),
        rawOutput: "",
        error: null,
        worldId: world.id,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (completed.count !== 1) throw new Error("创世任务租约已失效");
  }, { isolationLevel: "Serializable" });
}
