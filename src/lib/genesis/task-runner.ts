import { randomUUID } from "node:crypto";
import type { GenesisTask, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stream } from "@/lib/llm/gateway";
import { completeStructured } from "@/lib/llm/structured";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  type WorldDeck,
} from "@/lib/cards/schemas";
import { genesisRepairPrompt, genesisSystem, genesisUserPrompt } from "@/lib/prompts/genesis";
import { lorebookExcerpts, parseStWorldbook } from "@/lib/lorebook/st-import";
import { generateGenesisDeck } from "./generate";
import { GenesisMaterialSnapshotSchema, type GenesisMaterialSnapshot } from "@/lib/materials/types";
import { materialConstraintsPrompt } from "@/lib/materials/prompt";
import { deriveStreamingStage, furthestStage, mergeCompletedKeys } from "./stages";
import type { GenesisStageId, GenesisTaskStatus } from "./stages";
import type { GenesisTopLevelKey } from "./json-progress";
import { buildWorldIconTheme } from "@/lib/icons/theme";
import { WorldModeSchema, type WorldMode } from "@/lib/world-mode";

const USER_ID = "local";
const LEASE_MS = 60 * 1000;
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
};

type PublicTask = Pick<
  GenesisTask,
  "id" | "mode" | "status" | "stage" | "completedKeys" | "error" | "worldId" | "createdAt" | "updatedAt"
>;

export function toGenesisTaskDto(task: PublicTask): GenesisTaskDto {
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
    excerpts = lorebookExcerpts(parsedEntries) || undefined;
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
          maxTokens: 16000,
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

    persistedStage = furthestStage(persistedStage, "saving");
    await updateOwnedTask({
      stage: persistedStage,
      status: "running",
      rawOutput: latestRaw,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    });
    clearInterval(leaseHeartbeat);
    await persistWorld(prisma as unknown as PersistWorldDb, task, leaseToken, deck, parsedEntries);
  } catch (error) {
    await prisma.genesisTask.updateMany({
      where: { id: taskId, leaseToken, status: { in: ["running", "repairing"] } },
      data: {
        status: "failed",
        error: safeError(error),
        rawOutput: latestRaw,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
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
