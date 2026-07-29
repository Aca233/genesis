import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import { WorldModeSchema } from "@/lib/world-mode";
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
import {
  getGenesisV2StageContract,
  type GenesisV2StageId,
} from "./stage-registry";
import { validateGenesisV2ShadowOutput } from "./validation";

const SHADOW_LEASE_MS = 60_000;
type ClaimedShadowJob = {
  id: string;
  genesisTaskId: string;
  nodeKey: string;
  leaseToken: string;
  leaseEpoch: number;
  leaseExpiresAt: Date;
  attempt: number;
  inputHash: string | null;
  task: {
    userId: string;
    mode: string;
    decree: string;
    intentContract: unknown;
    shadowPreflight: unknown;
    shadowPreflightHash: string | null;
  };
};

function stageIdFromNodeKey(nodeKey: string): GenesisV2StageId {
  if (!nodeKey.startsWith("shadow:")) throw new Error("不是 Genesis V2 shadow 节点");
  return getGenesisV2StageContract(nodeKey.slice("shadow:".length) as GenesisV2StageId).id;
}

function parseFrozenPreflight(value: unknown): DeterministicPreflightResult {
  if (!value || typeof value !== "object") throw new Error("Genesis V2 shadow 缺少冻结预检");
  const result = value as DeterministicPreflightResult;
  if (!result.preflightHash || !result.structuralManifest || !result.sourceObligationManifest) {
    throw new Error("Genesis V2 shadow 冻结预检无效");
  }
  return result;
}

export async function claimGenesisShadowJob(jobId: string, now = new Date()): Promise<ClaimedShadowJob | null> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.genesisJob.findUnique({
      where: { id: jobId },
      include: {
        task: {
          select: {
            userId: true,
            mode: true,
            decree: true,
            intentContract: true,
            status: true,
            shadowEnabled: true,
            shadowPreflight: true,
            shadowPreflightHash: true,
          },
        },
      },
    });
    if (!candidate || !candidate.nodeKey.startsWith("shadow:") || !candidate.task.shadowEnabled
      || candidate.task.status !== "completed") return null;

    const contract = getGenesisV2StageContract(stageIdFromNodeKey(candidate.nodeKey));
    if (contract.dependencies.length) {
      const accepted = await tx.genesisArtifact.count({
        where: {
          genesisTaskId: candidate.genesisTaskId,
          stageKey: { in: [...contract.dependencies] },
          status: { in: ["accepted", "sealed"] },
          visibility: "shadow",
        },
      });
      if (accepted !== contract.dependencies.length) return null;
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + SHADOW_LEASE_MS);
    const claimed = await tx.genesisJob.updateMany({
      where: {
        id: jobId,
        engineVersion: "dag-v2-shadow",
        OR: [
          { status: "queued" },
          { status: "running", leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "running",
        leaseToken,
        leaseEpoch: { increment: 1 },
        leaseExpiresAt,
        attempt: { increment: 1 },
        startedAt: now,
        error: null,
      },
    });
    if (claimed.count !== 1) return null;
    const job = await tx.genesisJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        task: {
          select: {
            userId: true,
            mode: true,
            decree: true,
            intentContract: true,
            shadowPreflight: true,
            shadowPreflightHash: true,
          },
        },
      },
    });
    return job as ClaimedShadowJob;
  }, { isolationLevel: "Serializable" });
}

export async function runGenesisShadowJob(jobId: string): Promise<void> {
  const job = await claimGenesisShadowJob(jobId);
  if (!job) return;
  const stageId = stageIdFromNodeKey(job.nodeKey);
  const contract = getGenesisV2StageContract(stageId);
  const heartbeat = setInterval(() => {
    void prisma.genesisJob.updateMany({
      where: { id: job.id, leaseToken: job.leaseToken, leaseEpoch: job.leaseEpoch, status: "running" },
      data: { leaseExpiresAt: new Date(Date.now() + SHADOW_LEASE_MS) },
    }).catch(() => undefined);
  }, SHADOW_LEASE_MS / 3);
  heartbeat.unref();
  try {
    const preflight = parseFrozenPreflight(job.task.shadowPreflight);
    const mode = WorldModeSchema.parse(job.task.mode);
    if (preflight.preflightHash !== job.task.shadowPreflightHash) {
      throw new Error("Genesis V2 shadow 预检哈希不匹配");
    }
    const dependencies = await prisma.genesisArtifact.findMany({
      where: {
        genesisTaskId: job.genesisTaskId,
        stageKey: { in: [...contract.dependencies] },
        status: { in: ["accepted", "sealed"] },
        visibility: "shadow",
      },
      orderBy: { stageKey: "asc" },
      select: { stageKey: true, outputHash: true, content: true },
    });
    const blueprint = stageId === "blueprint"
      ? null
      : await prisma.genesisArtifact.findFirst({
          where: {
            genesisTaskId: job.genesisTaskId,
            stageKey: "blueprint",
            status: { in: ["accepted", "sealed"] },
            visibility: "shadow",
          },
          select: { content: true, outputHash: true },
        });
    const bundle = compileGenesisV2PromptBundle({
      stageId,
      engineVersion: "dag-v2-shadow",
      globalContractVersion: "genesis-v2/core/v1",
      mode,
      normalizedDecree: job.task.decree.trim(),
      rawUserIntentHash: preflight.preflightHash,
      intentContract: job.task.intentContract,
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
        targetSlotRefs: preflight.structuralManifest.slots
          .filter((slot) => preflight.sourceObligationManifest.obligations
            .some((obligation) => obligation.targetStages.includes(stageId)
              && obligation.targetSlots.includes(slot.slotId)))
          .map((slot) => slot.canonicalRef),
        issues: [],
      },
    });
    const content = await completeStructured("backstage", {
      task: "world-director-probe",
      userId: job.task.userId,
      owner: {
        kind: "genesis_shadow_job",
        id: job.id,
        genesisTaskId: job.genesisTaskId,
        genesisJobId: job.id,
        leaseEpoch: job.leaseEpoch,
        leaseExpiresAt: job.leaseExpiresAt.toISOString(),
        budgetScope: "shadow",
      },
      system: bundle.blocks.globalCommon,
      stableContext: [
        bundle.blocks.globalWave,
        bundle.blocks.worldCommon,
        bundle.blocks.stageWave,
        bundle.blocks.worldStage,
      ],
      user: bundle.blocks.dynamicTail,
      schema: getGenesisV2StageOutputSchema(stageId, mode),
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      maxTokens: preflight.budgetPlan.stages.find((budget) => budget.stage === stageId)?.maxOutputTokens,
      cache: { namespace: bundle.routingNamespace },
    }) as Record<string, unknown>;
    const validation = validateGenesisV2ShadowOutput({
      stageId,
      output: content,
      structuralManifest: preflight.structuralManifest,
    });
    if (!validation.valid) {
      throw new Error(`Genesis V2 shadow 硬门失败：${validation.issues.join(",")}`);
    }
    const outputHash = hashGenesisV2ArtifactContent(content);
    const dependencyHashes = dependencies.map((dependency) => dependency.outputHash);
    const reuseKey = buildGenesisV2ReuseKey({
      stageId,
      contractVersion: contract.contractVersion,
      inputHash: bundle.hashes.bundleHash,
      dependencyHashes,
    });
    const dependencyContent = new Map(
      dependencies.map((dependency) => [dependency.stageKey, dependency.content]),
    );
    const playableCore = stageId === "characters"
      ? assembleGenesisV2WorldDeck({
          blueprint: blueprint?.content as GenesisV2StageOutputs["blueprint"],
          pantheon_domain: dependencyContent.get("pantheon_domain") as GenesisV2StageOutputs["pantheon_domain"],
          civilizations: dependencyContent.get("civilizations") as GenesisV2StageOutputs["civilizations"],
          eras: dependencyContent.get("eras") as GenesisV2StageOutputs["eras"],
          characters: content as GenesisV2StageOutputs["characters"],
        }, mode)
      : null;
    const playableCoreOutputHash = playableCore
      ? hashGenesisV2ArtifactContent(playableCore)
      : null;
    const playableCoreDependencyHashes = playableCore
      ? [blueprint?.outputHash, ...dependencyHashes, outputHash]
          .filter((hash): hash is string => Boolean(hash))
      : [];
    const playableCoreInputHash = playableCore
      ? hashGenesisV2ArtifactContent({
          kind: "playable_core",
          dependencyHashes: playableCoreDependencyHashes,
        })
      : null;
    await prisma.$transaction(async (tx) => {
      const owned = await tx.genesisJob.findFirst({
        where: { id: job.id, leaseToken: job.leaseToken, leaseEpoch: job.leaseEpoch, status: "running" },
        select: { id: true },
      });
      if (!owned) throw new Error("Genesis V2 shadow 节点租约已失效");
      await tx.genesisArtifact.updateMany({
        where: {
          genesisTaskId: job.genesisTaskId,
          stageKey: stageId,
          status: { in: ["accepted", "sealed"] },
        },
        data: { status: "superseded", supersededAt: new Date() },
      });
      await tx.genesisArtifact.create({
        data: {
          genesisTaskId: job.genesisTaskId,
          genesisJobId: job.id,
          stageKey: stageId,
          version: job.attempt,
          status: "accepted",
          visibility: "shadow",
          inputHash: bundle.hashes.bundleHash,
          outputHash,
          reuseKey,
          dependencyHashes,
          content: content as Prisma.InputJsonValue,
          validation,
          acceptedAt: new Date(),
        },
      });
      if (playableCore && playableCoreOutputHash && playableCoreInputHash) {
        await tx.genesisArtifact.updateMany({
          where: {
            genesisTaskId: job.genesisTaskId,
            stageKey: "playable_core",
            status: { in: ["accepted", "sealed"] },
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
            visibility: "shadow",
            inputHash: playableCoreInputHash,
            outputHash: playableCoreOutputHash,
            reuseKey: `genesis-v2:playable-core:${playableCoreInputHash}`,
            dependencyHashes: playableCoreDependencyHashes,
            content: playableCore as unknown as Prisma.InputJsonValue,
            validation: { valid: true, issues: [] },
            acceptedAt: new Date(),
          },
        });
      }
      await tx.genesisJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          error: null,
        },
      });
      if (stageId === "characters") {
        await tx.genesisTask.update({
          where: { id: job.genesisTaskId },
          data: { shadowStatus: "completed" },
        });
      } else if (stageId === "blueprint") {
        await tx.genesisTask.update({
          where: { id: job.genesisTaskId },
          data: { shadowStatus: "running" },
        });
      }
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    await prisma.genesisJob.updateMany({
      where: { id: job.id, leaseToken: job.leaseToken, leaseEpoch: job.leaseEpoch },
      data: {
        status: "failed",
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      },
    });
    await prisma.genesisTask.updateMany({
      where: { id: job.genesisTaskId, shadowEnabled: true },
      data: { shadowStatus: "failed" },
    });
  } finally {
    clearInterval(heartbeat);
  }
}

const activeShadowJobs = new Map<string, Promise<void>>();

export function ensureGenesisShadowJobRunning(jobId: string): void {
  if (activeShadowJobs.has(jobId)) return;
  const running = runGenesisShadowJob(jobId)
    .catch(() => undefined)
    .finally(() => activeShadowJobs.delete(jobId));
  activeShadowJobs.set(jobId, running);
}
