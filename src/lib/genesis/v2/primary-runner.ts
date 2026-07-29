import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildWorldIconTheme } from "@/lib/icons/theme";
import {
  completeStructured,
  StructuredOutputValidationError,
} from "@/lib/llm/structured";
import { isTransientLlmError } from "@/lib/llm/gateway";
import { LlmCircuitOpenError } from "@/lib/llm/permits";
import { classifyTransportFailure } from "@/lib/llm/transport";
import { parseStWorldbook } from "@/lib/lorebook/st-import";
import { materialConstraintsPrompt } from "@/lib/materials/prompt";
import { GenesisMaterialSnapshotSchema } from "@/lib/materials/types";
import { WorldModeSchema } from "@/lib/world-mode";
import { validateGenesisDeck } from "../generate";
import { generateGenesisIntent, GenesisIntentGenerationError } from "../intent-generator";
import { parseGenesisIntent, type GenesisIntentContract } from "../intent";
import { countGenesisSemanticIssues, recordGenesisQualityEvent } from "../quality-observability";
import { enforceGenesisQuality, GenesisSemanticGateError } from "../semantic-gate";
import { resolveLorebookExcerpts, safeError } from "../task-runner";
import {
  buildGenesisV2ReuseKey,
  hashGenesisV2ArtifactContent,
} from "./artifacts";
import { compileGenesisV2PromptBundle } from "./prompt-bundle";
import type { DeterministicPreflightResult } from "./preflight";
import {
  assembleGenesisV2WorldDeck,
  getGenesisV2StageOutputSchema,
  type GenesisV2StageOutputs,
} from "./stage-output";
import { getGenesisV2StageContract, type GenesisV2StageId } from "./stage-registry";
import { validateGenesisV2ShadowOutput } from "./validation";

const LEASE_MS = 60_000;
const MAX_JOB_ATTEMPTS = 3;
const activeJobs = new Map<string, Promise<void>>();

class GenesisV2RecoverableStageError extends Error {
  override name = "GenesisV2RecoverableStageError";
}

function isRetryablePersistenceError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["P2028", "P2034"].includes(String((error as { code?: unknown }).code));
}

type PrimaryJob = {
  id: string;
  genesisTaskId: string;
  nodeKey: string;
  leaseToken: string;
  leaseEpoch: number;
  leaseExpiresAt: Date;
  attempt: number;
  previousError: string | null;
  task: {
    id: string;
    userId: string;
    mode: string;
    decree: string;
    status: string;
    engineVersion: string;
    intentContract: unknown;
    preflight: unknown;
    preflightHash: string | null;
    lorebook: unknown;
    materialSelection: unknown;
    aggregateVersion: number;
  };
};

function stageIdFromNodeKey(nodeKey: string): GenesisV2StageId {
  if (!nodeKey.startsWith("v2:")) throw new Error("不是 Genesis V2 主节点");
  return getGenesisV2StageContract(nodeKey.slice(3) as GenesisV2StageId).id;
}

function parsePreflight(value: unknown): DeterministicPreflightResult {
  if (!value || typeof value !== "object") throw new Error("Genesis V2 缺少冻结预检");
  const result = value as DeterministicPreflightResult;
  if (!result.preflightHash || !result.structuralManifest || !result.sourceObligationManifest) {
    throw new Error("Genesis V2 冻结预检无效");
  }
  return result;
}

function stageProgress(stageId: GenesisV2StageId): string {
  if (stageId === "blueprint") return "laws";
  if (stageId === "characters") return "characters";
  return "gods";
}

export async function claimGenesisV2PrimaryJob(jobId: string, now = new Date()): Promise<PrimaryJob | null> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.genesisJob.findUnique({
      where: { id: jobId },
      include: { task: true },
    });
    if (!candidate || candidate.engineVersion !== "dag-v2" || !candidate.nodeKey.startsWith("v2:")
      || candidate.task.engineVersion !== "dag-v2"
      || !["queued", "running", "repairing"].includes(candidate.task.status)) return null;
    const contract = getGenesisV2StageContract(stageIdFromNodeKey(candidate.nodeKey));
    if (contract.dependencies.length) {
      const accepted = await tx.genesisArtifact.count({
        where: {
          genesisTaskId: candidate.genesisTaskId,
          stageKey: { in: [...contract.dependencies] },
          status: { in: ["accepted", "sealed"] },
          visibility: "primary",
        },
      });
      if (accepted !== contract.dependencies.length) return null;
    }
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed = await tx.genesisJob.updateMany({
      where: {
        id: jobId,
        engineVersion: "dag-v2",
        OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: "running",
        leaseToken,
        leaseEpoch: { increment: 1 },
        leaseExpiresAt,
        attempt: { increment: 1 },
        startedAt: now,
        completedAt: null,
        error: null,
      },
    });
    if (claimed.count !== 1) return null;
    const aggregateVersion = candidate.task.aggregateVersion + 1;
    await tx.genesisTask.update({
      where: { id: candidate.genesisTaskId },
      data: {
        status: "running",
        stage: stageProgress(contract.id),
        error: null,
        aggregateVersion,
      },
    });
    await tx.genesisOutbox.create({
      data: {
        taskId: candidate.genesisTaskId,
        aggregateVersion,
        eventType: "v2_stage_started",
        payloadProjection: { status: "running", stage: stageProgress(contract.id), nodeKey: candidate.nodeKey },
      },
    });
    const job = await tx.genesisJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { task: true },
    });
    return { ...job, previousError: candidate.error } as unknown as PrimaryJob;
  }, { isolationLevel: "Serializable" });
}

async function resolveIntent(job: PrimaryJob): Promise<{
  intent: GenesisIntentContract;
  entries: ReturnType<typeof parseStWorldbook>;
  excerpts: string | undefined;
}> {
  const entries = job.task.lorebook ? parseStWorldbook(job.task.lorebook) : [];
  const excerpts = await resolveLorebookExcerpts(entries, job.task.userId);
  const existing = parseGenesisIntent(job.task.intentContract);
  if (existing) return { intent: existing, entries, excerpts };
  if (stageIdFromNodeKey(job.nodeKey) !== "blueprint") {
    throw new Error("Genesis V2 缺少冻结意图契约");
  }
  const mode = WorldModeSchema.parse(job.task.mode);
  const intent = await generateGenesisIntent({
    mode,
    decree: job.task.decree,
    userId: job.task.userId,
    lorebookExcerpts: excerpts,
    owner: {
      kind: "genesis_v2_job",
      id: job.id,
      genesisTaskId: job.genesisTaskId,
      genesisJobId: job.id,
      leaseEpoch: job.leaseEpoch,
      leaseExpiresAt: job.leaseExpiresAt.toISOString(),
      budgetScope: "primary",
    },
  });
  const updated = await prisma.genesisTask.updateMany({
    where: {
      id: job.genesisTaskId,
      engineVersion: "dag-v2",
      OR: [
        { intentContract: { equals: Prisma.DbNull } },
        { intentContract: { equals: Prisma.JsonNull } },
      ],
    },
    data: { intentContract: intent as unknown as Prisma.InputJsonValue, stage: "laws" },
  });
  if (updated.count !== 1) {
    const current = await prisma.genesisTask.findUnique({
      where: { id: job.genesisTaskId },
      select: { intentContract: true },
    });
    const persisted = parseGenesisIntent(current?.intentContract);
    if (!persisted) throw new Error("Genesis V2 意图冻结竞争失败");
    return { intent: persisted, entries, excerpts };
  }
  return { intent, entries, excerpts };
}

export async function runGenesisV2PrimaryJob(jobId: string): Promise<void> {
  const job = await claimGenesisV2PrimaryJob(jobId);
  if (!job) return;
  const stageId = stageIdFromNodeKey(job.nodeKey);
  const contract = getGenesisV2StageContract(stageId);
  const heartbeat = setInterval(() => {
    void prisma.genesisJob.updateMany({
      where: { id: job.id, leaseToken: job.leaseToken, leaseEpoch: job.leaseEpoch, status: "running" },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    }).catch(() => undefined);
  }, LEASE_MS / 3);
  heartbeat.unref();
  try {
    const mode = WorldModeSchema.parse(job.task.mode);
    const preflight = parsePreflight(job.task.preflight);
    if (preflight.preflightHash !== job.task.preflightHash) throw new Error("Genesis V2 预检哈希不匹配");
    const { intent, entries, excerpts } = await resolveIntent(job);
    const dependencies = await prisma.genesisArtifact.findMany({
      where: {
        genesisTaskId: job.genesisTaskId,
        stageKey: { in: [...contract.dependencies] },
        status: { in: ["accepted", "sealed"] },
        visibility: "primary",
      },
      orderBy: { stageKey: "asc" },
      select: { stageKey: true, outputHash: true, content: true },
    });
    const blueprint = stageId === "blueprint" ? null : await prisma.genesisArtifact.findFirst({
      where: {
        genesisTaskId: job.genesisTaskId,
        stageKey: "blueprint",
        status: { in: ["accepted", "sealed"] },
        visibility: "primary",
      },
      select: { content: true, outputHash: true },
    });
    const bundle = compileGenesisV2PromptBundle({
      stageId,
      engineVersion: "dag-v2",
      globalContractVersion: "genesis-v2/core/v1",
      mode,
      normalizedDecree: job.task.decree.trim(),
      rawUserIntentHash: preflight.preflightHash,
      intentContract: intent,
      manifestHash: preflight.structuralManifest.manifestHash,
      structuralManifestSummary: preflight.structuralManifest,
      canonBrief: (blueprint?.content as Record<string, unknown> | null)?.canonBrief ?? null,
      slotBriefs: (blueprint?.content as Record<string, unknown> | null)?.slotBriefs ?? null,
      obligations: preflight.sourceObligationManifest.obligations,
      acceptedDependencies: dependencies.map((dependency) => ({
        stageId: dependency.stageKey as GenesisV2StageId,
        artifactHash: dependency.outputHash,
        summary: dependency.content,
      })),
      dynamic: {
        nodeKey: job.nodeKey,
        attempt: job.attempt,
        targetSlotRefs: preflight.structuralManifest.slots.map((slot) => slot.canonicalRef),
        issues: job.previousError ? [job.previousError] : [],
      },
    });
    const owner = {
      kind: "genesis_v2_job",
      id: job.id,
      genesisTaskId: job.genesisTaskId,
      genesisJobId: job.id,
      leaseEpoch: job.leaseEpoch,
      leaseExpiresAt: job.leaseExpiresAt.toISOString(),
      budgetScope: "primary" as const,
    };
    const content = await completeStructured("backstage", {
      task: "genesis",
      userId: job.task.userId,
      owner,
      system: bundle.blocks.globalCommon,
      stableContext: [bundle.blocks.globalWave, bundle.blocks.worldCommon, bundle.blocks.stageWave, bundle.blocks.worldStage],
      user: bundle.blocks.dynamicTail,
      schema: getGenesisV2StageOutputSchema(stageId, mode),
      maxAttempts: 2,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      maxTokens: preflight.budgetPlan.stages.find((budget) => budget.stage === stageId)?.maxOutputTokens,
      cache: { namespace: bundle.routingNamespace },
    }) as Record<string, unknown>;
    const validation = validateGenesisV2ShadowOutput({ stageId, output: content, structuralManifest: preflight.structuralManifest });
    if (!validation.valid) {
      throw new GenesisV2RecoverableStageError(`Genesis V2 阶段硬门失败：${validation.issues.join(",")}`);
    }
    const outputHash = hashGenesisV2ArtifactContent(content);
    const dependencyHashes = dependencies.map((dependency) => dependency.outputHash);
    const dependencyContent = new Map(dependencies.map((dependency) => [dependency.stageKey, dependency.content]));
    let assembled = null;
    if (stageId === "characters") {
      try {
        assembled = assembleGenesisV2WorldDeck({
          blueprint: blueprint?.content as GenesisV2StageOutputs["blueprint"],
          pantheon_domain: dependencyContent.get("pantheon_domain") as GenesisV2StageOutputs["pantheon_domain"],
          civilizations: dependencyContent.get("civilizations") as GenesisV2StageOutputs["civilizations"],
          eras: dependencyContent.get("eras") as GenesisV2StageOutputs["eras"],
          characters: content as GenesisV2StageOutputs["characters"],
        }, mode);
      } catch (error) {
        throw new GenesisV2RecoverableStageError(`Genesis V2 汇合校验失败：${safeError(error)}`);
      }
    }
    const materialSnapshot = job.task.materialSelection
      ? GenesisMaterialSnapshotSchema.parse(job.task.materialSelection)
      : null;
    const checkedDeck = assembled ? validateGenesisDeck(assembled, mode, materialSnapshot) : null;
    const quality = checkedDeck ? await enforceGenesisQuality({
      deck: checkedDeck,
      mode,
      decree: job.task.decree,
      intent,
      userId: job.task.userId,
      lorebookExcerpts: excerpts,
      materialSnapshot,
      materialConstraints: materialConstraintsPrompt(materialSnapshot, mode),
      owner,
      onStage: async (stage) => {
        await prisma.genesisTask.updateMany({
          where: { id: job.genesisTaskId, engineVersion: "dag-v2", status: { in: ["running", "repairing"] } },
          data: { stage, ...(stage === "semantic_repair" ? { status: "repairing" } : {}) },
        });
      },
    }) : null;
    if (quality) {
      const meta = quality.report.meta;
      recordGenesisQualityEvent({
        kind: "semantic_gate_completed",
        taskId: job.genesisTaskId,
        initialErrorCount: meta?.initialErrorCount ?? 0,
        initialWarningCount: meta?.initialWarningCount ?? 0,
        repaired: meta?.repaired ?? false,
        auditPasses: meta?.auditPasses ?? 1,
        durationMs: meta?.durationMs ?? 0,
        issueCounts: countGenesisSemanticIssues(quality.report.issues),
      });
    }
    await prisma.$transaction(async (tx) => {
      const owned = await tx.genesisJob.findFirst({
        where: { id: job.id, leaseToken: job.leaseToken, leaseEpoch: job.leaseEpoch, status: "running" },
        select: { id: true },
      });
      const activeTask = await tx.genesisTask.findFirst({
        where: { id: job.genesisTaskId, engineVersion: "dag-v2", status: { in: ["running", "repairing"] } },
        select: { aggregateVersion: true, worldId: true, stage: true },
      });
      if (!owned || !activeTask) throw new Error("Genesis V2 主节点租约已失效");
      if (quality && activeTask.worldId) throw new Error("Genesis V2 任务已经绑定世界，拒绝重复落库");
      await tx.genesisArtifact.updateMany({
        where: { genesisTaskId: job.genesisTaskId, stageKey: stageId, status: { in: ["accepted", "sealed"] }, visibility: "primary" },
        data: { status: "superseded", supersededAt: new Date() },
      });
      await tx.genesisArtifact.create({
        data: {
          genesisTaskId: job.genesisTaskId,
          genesisJobId: job.id,
          stageKey: stageId,
          version: job.attempt,
          status: "accepted",
          visibility: "primary",
          inputHash: bundle.hashes.bundleHash,
          outputHash,
          reuseKey: buildGenesisV2ReuseKey({ stageId, contractVersion: contract.contractVersion, inputHash: bundle.hashes.bundleHash, dependencyHashes }),
          dependencyHashes,
          content: content as Prisma.InputJsonValue,
          validation,
          acceptedAt: new Date(),
        },
      });
      if (quality) {
        const coreHash = hashGenesisV2ArtifactContent(quality.deck);
        await tx.genesisArtifact.updateMany({
          where: {
            genesisTaskId: job.genesisTaskId,
            stageKey: "playable_core",
            status: { in: ["accepted", "sealed"] },
            visibility: "primary",
          },
          data: { status: "superseded", supersededAt: new Date() },
        });
        await tx.genesisArtifact.create({
          data: {
            genesisTaskId: job.genesisTaskId,
            genesisJobId: job.id,
            stageKey: "playable_core",
            version: job.attempt,
            status: "sealed",
            visibility: "primary",
            inputHash: outputHash,
            outputHash: coreHash,
            reuseKey: `genesis-v2:playable-core:${coreHash}`,
            dependencyHashes: [blueprint!.outputHash, ...dependencyHashes, outputHash],
            content: quality.deck as unknown as Prisma.InputJsonValue,
            validation: { valid: true, issues: [] },
            acceptedAt: new Date(),
            sealedAt: new Date(),
          },
        });
        const world = await tx.world.create({
          data: {
            userId: job.task.userId,
            name: quality.deck.worldName,
            genesisInput: job.task.decree,
            genesisIntent: intent as unknown as Prisma.InputJsonValue,
            mode,
            status: "draft",
            draftDeck: quality.deck as unknown as Prisma.InputJsonValue,
            themeCard: quality.deck.theme as unknown as Prisma.InputJsonValue,
            styleCard: quality.deck.style as unknown as Prisma.InputJsonValue,
            cosmology: quality.deck.cosmology as unknown as Prisma.InputJsonValue,
            fusionAxiom: quality.deck.fusionAxiom ? quality.deck.fusionAxiom as unknown as Prisma.InputJsonValue : undefined,
            iconTheme: buildWorldIconTheme(quality.deck) as unknown as Prisma.InputJsonValue,
            lorebookEntries: { create: entries.map((entry) => ({
              keys: entry.keys,
              content: entry.content,
              enabled: entry.enabled,
              stExtra: entry.stExtra as Prisma.InputJsonValue,
              source: "imported",
            })) },
          },
        });
        const completedTask = await tx.genesisTask.updateMany({
          where: {
            id: job.genesisTaskId,
            engineVersion: "dag-v2",
            aggregateVersion: activeTask.aggregateVersion,
            worldId: null,
            status: { in: ["running", "repairing"] },
          },
          data: {
            status: "completed",
            stage: "completed",
            completedKeys: Object.keys(quality.deck),
            worldId: world.id,
            auditReport: quality.report as unknown as Prisma.InputJsonValue,
            error: null,
            aggregateVersion: activeTask.aggregateVersion + 1,
          },
        });
        if (completedTask.count !== 1) throw new Error("Genesis V2 完成提交竞争失败");
        await tx.genesisOutbox.create({
          data: {
            taskId: job.genesisTaskId,
            aggregateVersion: activeTask.aggregateVersion + 1,
            eventType: "task_completed",
            payloadProjection: { status: "completed", stage: "completed", worldId: world.id },
          },
        });
      } else {
        const aggregateVersion = activeTask.aggregateVersion + 1;
        const advanced = await tx.genesisTask.updateMany({
          where: {
            id: job.genesisTaskId,
            engineVersion: "dag-v2",
            aggregateVersion: activeTask.aggregateVersion,
            status: { in: ["running", "repairing"] },
          },
          data: { aggregateVersion, error: null },
        });
        if (advanced.count !== 1) throw new Error("Genesis V2 阶段提交竞争失败");
        await tx.genesisOutbox.create({
          data: {
            taskId: job.genesisTaskId,
            aggregateVersion,
            eventType: "v2_stage_completed",
            payloadProjection: {
              status: "running",
              stage: activeTask.stage,
              nodeKey: job.nodeKey,
              artifactHash: outputHash,
            },
          },
        });
      }
      const completedJob = await tx.genesisJob.updateMany({
        where: {
          id: job.id,
          leaseToken: job.leaseToken,
          leaseEpoch: job.leaseEpoch,
          status: "running",
        },
        data: { status: "completed", completedAt: new Date(), leaseToken: null, leaseExpiresAt: null, error: null },
      });
      if (completedJob.count !== 1) throw new Error("Genesis V2 主节点租约已失效");
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof GenesisSemanticGateError) {
      recordGenesisQualityEvent({
        kind: "semantic_gate_rejected",
        taskId: job.genesisTaskId,
        errorCount: error.report.issues.filter(({ severity }) => severity === "error").length,
        issueCounts: countGenesisSemanticIssues(error.report.issues),
      });
    }
    const terminalQualityFailure = error instanceof GenesisSemanticGateError
      || error instanceof GenesisIntentGenerationError;
    const transportFailure = classifyTransportFailure(error);
    const waitingForProvider = !terminalQualityFailure && (
      error instanceof LlmCircuitOpenError
      || (transportFailure.terminalEvidence === "terminal_unknown"
        && transportFailure.stableErrorCode !== "UNKNOWN_ERROR")
    );
    const retry = !terminalQualityFailure
      && !waitingForProvider
      && (error instanceof GenesisV2RecoverableStageError
        || error instanceof StructuredOutputValidationError
        || isTransientLlmError(error)
        || isRetryablePersistenceError(error))
      && job.attempt < MAX_JOB_ATTEMPTS;
    const terminalError = retry || waitingForProvider ? null : safeError(error);
    await prisma.$transaction(async (tx) => {
      const activeTask = await tx.genesisTask.findFirst({
        where: {
          id: job.genesisTaskId,
          engineVersion: "dag-v2",
          status: { in: ["running", "repairing"] },
        },
        select: { aggregateVersion: true, stage: true, status: true },
      });
      if (!activeTask) return;
      const aggregateVersion = activeTask.aggregateVersion + 1;
      const updatedJob = await tx.genesisJob.updateMany({
        where: { id: job.id, leaseToken: job.leaseToken, leaseEpoch: job.leaseEpoch },
        data: {
          status: waitingForProvider ? "waiting_for_provider" : retry ? "queued" : "failed",
          error: terminalError,
          leaseToken: null,
          leaseExpiresAt: null,
          completedAt: retry || waitingForProvider ? null : new Date(),
        },
      });
      if (updatedJob.count !== 1) return;
      const updatedTask = await tx.genesisTask.updateMany({
        where: {
          id: job.genesisTaskId,
          engineVersion: "dag-v2",
          aggregateVersion: activeTask.aggregateVersion,
          status: { in: ["running", "repairing"] },
        },
        data: {
          status: waitingForProvider ? "waiting_for_provider" : retry ? activeTask.status : "failed",
          error: terminalError,
          aggregateVersion,
          ...(error instanceof GenesisSemanticGateError
            ? { auditReport: error.report as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (updatedTask.count !== 1) throw new Error("Genesis V2 失败状态提交竞争失败");
      await tx.genesisOutbox.create({
        data: {
          taskId: job.genesisTaskId,
          aggregateVersion,
          eventType: waitingForProvider
            ? "task_waiting_for_provider"
            : retry ? "v2_stage_requeued" : "task_failed",
          payloadProjection: {
            status: waitingForProvider ? "waiting_for_provider" : retry ? activeTask.status : "failed",
            stage: activeTask.stage,
            nodeKey: job.nodeKey,
            ...(terminalError ? { error: terminalError } : {}),
          },
        },
      });
    });
    if (retry || waitingForProvider) {
      const { wakeGenesisScheduler } = await import("../scheduler");
      wakeGenesisScheduler();
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export function ensureGenesisV2PrimaryJobRunning(jobId: string): void {
  if (activeJobs.has(jobId)) return;
  const running = runGenesisV2PrimaryJob(jobId).finally(() => activeJobs.delete(jobId));
  activeJobs.set(jobId, running);
  void running.catch(() => undefined);
}
