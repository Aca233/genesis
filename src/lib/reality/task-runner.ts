import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type RealityRewrite } from "@prisma/client";
import { prisma } from "@/lib/db";
import { complete } from "@/lib/llm/gateway";
import { completeStructured } from "@/lib/llm/structured";
import {
  rewritePlannerSystem,
  rewritePlannerUserPrompt,
  rewriteResultSystem,
  rewriteResultUserPrompt,
} from "@/lib/prompts/rewrite";
import { applyRewritePlan } from "./apply";
import { cloneTimelineGraph, type TimelineCloneMaps } from "./clone";
import {
  claimWorldOperation,
  OPERATION_LEASE_RENEW_MS,
  releaseWorldOperation,
  renewWorldOperation,
  WorldOperationConflictError,
} from "./operation-lock";
import {
  RewritePlanSchema,
  RewriteScopeSchema,
  type RewritePlan,
  type RewriteScope,
} from "./schemas";
import type { DurableTaskProgress } from "@/lib/tasks/progress";

export const REWRITE_LEASE_MS = 5 * 60 * 1000;
export const REWRITE_LEASE_RENEW_MS = REWRITE_LEASE_MS / 3;

export type RealityRewriteStatus =
  | "planning"
  | "applying"
  | "narrating"
  | "completed"
  | "failed";
export type RealityRewriteStage = RealityRewriteStatus | "branching";

export type RealityRewriteDto = {
  id: string;
  worldId: string;
  sourceTimelineId: string;
  resultTimelineId: string | null;
  decree: string;
  scope: RewriteScope;
  status: RealityRewriteStatus;
  interpretation: string | null;
  branchName: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type PublicRewrite = Pick<
  RealityRewrite,
  | "id"
  | "worldId"
  | "sourceTimelineId"
  | "resultTimelineId"
  | "decree"
  | "scope"
  | "status"
  | "plan"
  | "summary"
  | "error"
  | "createdAt"
  | "updatedAt"
>;

export class RealityRewriteNotFoundError extends Error {
  constructor(message = "现实改写任务不存在") {
    super(message);
    this.name = "RealityRewriteNotFoundError";
  }
}

export class RealityRewriteForbiddenError extends Error {
  constructor(message = "仅创世主模式可改写现实") {
    super(message);
    this.name = "RealityRewriteForbiddenError";
  }
}

export class RealityRewriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealityRewriteConflictError";
  }
}

export function sanitizeRewriteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:sk-|AIza|key-)[A-Za-z0-9_\-.]{8,}/g, "[已隐藏密钥]")
    .replace(/\b(?:operation|lease)(?:Token)?\s*[:=]\s*[^\s,;}]+/gi, "[已隐藏租约]")
    .slice(0, 1000);
}

function parseStoredPlan(value: Prisma.JsonValue | null): RewritePlan | null {
  if (value === null) return null;
  const parsed = RewritePlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toRealityRewriteDto(task: PublicRewrite): RealityRewriteDto {
  const plan = parseStoredPlan(task.plan);
  return {
    id: task.id,
    worldId: task.worldId,
    sourceTimelineId: task.sourceTimelineId,
    resultTimelineId: task.resultTimelineId,
    decree: task.decree,
    scope: RewriteScopeSchema.parse(task.scope),
    status: task.status as RealityRewriteStatus,
    interpretation: plan?.interpretation ?? null,
    branchName: plan?.branchName ?? null,
    summary: task.summary,
    error: task.error === null ? null : sanitizeRewriteError(task.error),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function rewriteStage(
  task: Pick<RealityRewriteDto, "status" | "resultTimelineId">,
): RealityRewriteStage {
  if (task.status === "applying" && task.resultTimelineId === null) return "branching";
  return task.status;
}

export function rewriteStages(
  task: Pick<RealityRewriteDto, "status" | "resultTimelineId">,
): RealityRewriteStage[] {
  if (task.status === "applying" && task.resultTimelineId === null) {
    return ["branching", "applying"];
  }
  return [task.status];
}

export function rewriteDurableProgress(
  task: Pick<
    PublicRewrite,
    "id" | "status" | "plan" | "resultTimelineId" | "error" | "updatedAt"
  >,
): DurableTaskProgress {
  const plan = parseStoredPlan(task.plan);
  let stage: string;
  if (task.status === "planning") stage = plan ? "planned" : "intent_ready";
  else if (task.status === "applying") {
    stage = task.resultTimelineId === null ? "branching" : "applying";
  } else if (task.status === "narrating") stage = "narrating";
  else if (task.status === "completed") stage = "completed";
  else stage = task.resultTimelineId === null ? "branching" : "narrating";

  return {
    taskKind: "rewrite",
    taskId: task.id,
    stage,
    status: task.status === "completed"
      ? "completed"
      : task.status === "failed"
        ? "failed"
        : "running",
    retryable: task.status === "failed",
    ...(task.error ? { safeError: sanitizeRewriteError(task.error) } : {}),
    updatedAt: task.updatedAt.toISOString(),
  };
}

type RewriteDb = PrismaClient;

export type CreateRealityRewriteInput = {
  userId: string;
  worldId: string;
  decree: string;
  scope: RewriteScope;
  idempotencyKey: string;
};

export async function createRealityRewrite(
  db: RewriteDb,
  input: CreateRealityRewriteInput,
): Promise<{ task: RealityRewrite; replayed: boolean }> {
  const existing = await db.realityRewrite.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing !== null) {
    if (
      existing.worldId !== input.worldId
      || existing.decree !== input.decree
      || existing.scope !== input.scope
    ) {
      throw new RealityRewriteConflictError("幂等键已用于另一项现实改写");
    }
    return { task: existing, replayed: true };
  }

  try {
    const task = await db.$transaction(async (tx) => {
      const world = await tx.world.findFirst({
        where: { id: input.worldId, userId: input.userId },
        select: { id: true, mode: true, activeTimelineId: true },
      });
      if (world === null) throw new RealityRewriteNotFoundError("世界不存在");
      if (world.mode !== "creator") throw new RealityRewriteForbiddenError();
      if (world.activeTimelineId === null) {
        throw new RealityRewriteConflictError("世界尚无可改写的活动现实");
      }
      const chapter = await tx.chapter.findFirst({
        where: { timelineId: world.activeTimelineId },
        orderBy: { index: "desc" },
        select: { id: true },
      });
      if (chapter === null) throw new RealityRewriteConflictError("活动现实尚无当前记录段");
      return tx.realityRewrite.create({
        data: {
          worldId: world.id,
          sourceTimelineId: world.activeTimelineId,
          sourceChapterId: chapter.id,
          decree: input.decree,
          scope: input.scope,
          status: "planning",
          idempotencyKey: input.idempotencyKey,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { task, replayed: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await db.realityRewrite.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (
        replay !== null
        && replay.worldId === input.worldId
        && replay.decree === input.decree
        && replay.scope === input.scope
      ) {
        return { task: replay, replayed: true };
      }
      throw new RealityRewriteConflictError("幂等键已用于另一项现实改写");
    }
    throw error;
  }
}

export async function claimRealityRewriteTask(
  db: Pick<PrismaClient, "realityRewrite">,
  taskId: string,
  now = new Date(),
): Promise<RealityRewrite | null> {
  const leaseToken = randomUUID();
  const claimed = await db.realityRewrite.updateMany({
    where: {
      id: taskId,
      status: { in: ["planning", "applying", "narrating"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: {
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + REWRITE_LEASE_MS),
      error: null,
    },
  });
  if (claimed.count !== 1) return null;
  return db.realityRewrite.findUnique({ where: { id: taskId } });
}

export async function renewRealityRewriteLease(
  db: Pick<PrismaClient, "realityRewrite">,
  taskId: string,
  leaseToken: string,
  now = new Date(),
): Promise<boolean> {
  const result = await db.realityRewrite.updateMany({
    where: {
      id: taskId,
      leaseToken,
      status: { in: ["planning", "applying", "narrating"] },
    },
    data: { leaseExpiresAt: new Date(now.getTime() + REWRITE_LEASE_MS) },
  });
  return result.count === 1;
}

export async function retryRealityRewrite(
  db: RewriteDb,
  userId: string,
  taskId: string,
): Promise<RealityRewrite> {
  const task = await db.realityRewrite.findFirst({
    where: { id: taskId, world: { userId } },
  });
  if (task === null) throw new RealityRewriteNotFoundError();
  if (task.status === "completed") return task;

  const hasLiveLease = task.leaseExpiresAt !== null && task.leaseExpiresAt > new Date();
  if (hasLiveLease) return task;

  const data = task.status === "failed"
    ? {
        status: task.resultTimelineId !== null
          ? "narrating" as const
          : task.plan !== null ? "applying" as const : "planning" as const,
        error: null,
        leaseToken: null,
        leaseExpiresAt: null,
      }
    : { error: null, leaseToken: null, leaseExpiresAt: null };
  await db.realityRewrite.updateMany({
    where: {
      id: task.id,
      status: task.status,
      leaseToken: task.leaseToken,
      leaseExpiresAt: task.leaseExpiresAt,
    },
    data,
  });

  const current = await db.realityRewrite.findUnique({ where: { id: task.id } });
  if (current === null) throw new RealityRewriteNotFoundError();
  return current;
}

type PlannerContext = {
  sourceRealitySummary: string;
  currentState: string;
  existingRecords: string;
};

async function loadPlannerContext(db: RewriteDb, task: RealityRewrite): Promise<PlannerContext> {
  const timeline = await db.timeline.findFirst({
    where: { id: task.sourceTimelineId, worldId: task.worldId },
    select: {
      branchSummary: true,
      realityState: true,
      observerState: true,
      gods: {
        select: { id: true, name: true, tier: true, rank: true, domains: true, relations: true, agenda: true },
      },
      entities: {
        select: {
          id: true,
          name: true,
          type: true,
          summary: true,
          raceId: true,
          sections: { select: { key: true, content: true, revealed: true } },
        },
      },
      abilities: {
        select: { id: true, name: true, entityId: true, godId: true, sourceAbilityId: true, effect: true },
      },
      chronicles: {
        select: { id: true, chapterIndex: true, yearLabel: true, text: true, entityIds: true, godIds: true },
      },
      omens: {
        select: { id: true, godId: true, text: true, consumed: true },
      },
    },
  });
  if (timeline === null) throw new RealityRewriteConflictError("改写来源现实不存在");
  return {
    sourceRealitySummary: timeline.branchSummary ?? "",
    currentState: JSON.stringify({
      realityState: timeline.realityState ?? {},
      observerState: timeline.observerState ?? {},
    }),
    existingRecords: JSON.stringify({
      gods: timeline.gods,
      entities: timeline.entities,
      abilities: timeline.abilities,
      chronicles: timeline.chronicles,
      omens: timeline.omens,
    }),
  };
}

export type RealityRewriteRunnerDependencies = {
  db: RewriteDb;
  plan(task: RealityRewrite, context: PlannerContext): Promise<RewritePlan>;
  narrate(task: RealityRewrite, plan: RewritePlan, input: {
    sourceRealitySummary: string;
    newRealitySummary: string;
    consequenceLines: string[];
  }): Promise<string>;
};

const defaultDependencies: RealityRewriteRunnerDependencies = {
  db: prisma,
  async plan(task, context) {
    const owner = await prisma.world.findUniqueOrThrow({
      where: { id: task.worldId },
      select: { userId: true },
    });
    return completeStructured("backstage", {
      task: "extract",
      userId: owner.userId,
      system: rewritePlannerSystem(),
      user: rewritePlannerUserPrompt({
        decree: task.decree,
        requestedScope: RewriteScopeSchema.parse(task.scope),
        ...context,
      }),
      schema: RewritePlanSchema,
      maxTokens: 16000,
      cache: { namespace: `reality-rewrite:v1:${task.worldId}` },
    });
  },
  async narrate(task, plan, input) {
    const owner = await prisma.world.findUniqueOrThrow({
      where: { id: task.worldId },
      select: { userId: true },
    });
    return complete("narrative", {
      task: "narrative",
      userId: owner.userId,
      maxTokens: 4000,
      cache: { namespace: `reality-rewrite-result:v1:${task.worldId}` },
      messages: [
        { role: "system", content: rewriteResultSystem(), cacheScope: "global" },
        {
          role: "user",
          content: rewriteResultUserPrompt({
            decree: task.decree,
            interpretation: plan.interpretation,
            scope: plan.scope,
            effectivePoint: plan.effectivePoint,
            sourceRealitySummary: input.sourceRealitySummary,
            newRealitySummary: input.newRealitySummary,
            appliedConsequences: input.consequenceLines,
            narrationFocus: plan.narrationFocus,
          }),
          cacheScope: "dynamic",
        },
      ],
    });
  },
};

async function persistOwned(
  db: RewriteDb,
  taskId: string,
  leaseToken: string,
  data: Prisma.RealityRewriteUpdateManyMutationInput,
): Promise<void> {
  const result = await db.realityRewrite.updateMany({
    where: {
      id: taskId,
      leaseToken,
      status: { in: ["planning", "applying", "narrating"] },
      leaseExpiresAt: { gt: new Date() },
    },
    data,
  });
  if (result.count !== 1) throw new RealityRewriteConflictError("现实改写任务租约已失效");
}

function isSerializableConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

type AppliedReality = {
  resultTimelineId: string;
  sourceSummary: string;
  newSummary: string;
  consequenceLines: string[];
};

function remapStableRef(
  ref: string,
  maps: ReadonlyArray<ReadonlyMap<string, string>>,
): string {
  for (const map of maps) {
    const mapped = map.get(ref);
    if (mapped !== undefined) return mapped;
  }
  return ref;
}

/** Translate source-graph IDs in a validated plan to the cloned graph. */
export function remapRewritePlanForClone(
  plan: RewritePlan,
  maps: Pick<
    TimelineCloneMaps,
    "godIds" | "entityIds" | "abilityIds" | "chronicleIds"
  > & Partial<Omit<
    TimelineCloneMaps,
    "godIds" | "entityIds" | "abilityIds" | "chronicleIds"
  >>,
  omenIds: ReadonlyMap<string, string> = new Map(),
): RewritePlan {
  const godRef = (ref: string) => remapStableRef(ref, [maps.godIds]);
  const entityRef = (ref: string) => remapStableRef(ref, [maps.entityIds]);
  const ownerRef = (ref: string) => remapStableRef(ref, [maps.entityIds, maps.godIds]);
  const abilityRef = (ref: string) => remapStableRef(ref, [maps.abilityIds]);
  const chronicleRef = (ref: string) => remapStableRef(ref, [maps.chronicleIds]);
  const omenRef = (ref: string) => remapStableRef(ref, [omenIds]);

  return RewritePlanSchema.parse({
    ...plan,
    godPatches: plan.godPatches.map((patch) => {
      if (patch.op === "create") {
        return {
          ...patch,
          value: {
            ...patch.value,
            relations: patch.value.relations.map((relation) => ({
              ...relation,
              targetRef: godRef(relation.targetRef),
            })),
          },
        };
      }
      if (patch.op === "remove") return { ...patch, targetId: godRef(patch.targetId) };
      return {
        ...patch,
        targetId: godRef(patch.targetId),
        changes: patch.changes.relations === undefined
          ? patch.changes
          : {
              ...patch.changes,
              relations: patch.changes.relations.map((relation) => ({
                ...relation,
                targetRef: godRef(relation.targetRef),
              })),
            },
      };
    }),
    entityPatches: plan.entityPatches.map((patch) => {
      if (patch.op === "create") {
        return {
          ...patch,
          value: {
            ...patch.value,
            raceRef: patch.value.raceRef === null ? null : entityRef(patch.value.raceRef),
          },
        };
      }
      if (patch.op === "remove") return { ...patch, targetId: entityRef(patch.targetId) };
      return {
        ...patch,
        targetId: entityRef(patch.targetId),
        changes: patch.changes.raceRef === undefined
          ? patch.changes
          : {
              ...patch.changes,
              raceRef: patch.changes.raceRef === null ? null : entityRef(patch.changes.raceRef),
            },
      };
    }),
    abilityPatches: plan.abilityPatches.map((patch) => {
      if (patch.op === "create") {
        return {
          ...patch,
          ownerRef: ownerRef(patch.ownerRef),
          value: {
            ...patch.value,
            sourceAbilityRef: patch.value.sourceAbilityRef === null
              ? null
              : abilityRef(patch.value.sourceAbilityRef),
          },
        };
      }
      if (patch.op === "remove") return { ...patch, targetId: abilityRef(patch.targetId) };
      return {
        ...patch,
        targetId: abilityRef(patch.targetId),
        ...(patch.ownerRef === undefined ? {} : { ownerRef: ownerRef(patch.ownerRef) }),
        changes: patch.changes.sourceAbilityRef === undefined
          ? patch.changes
          : {
              ...patch.changes,
              sourceAbilityRef: patch.changes.sourceAbilityRef === null
                ? null
                : abilityRef(patch.changes.sourceAbilityRef),
            },
      };
    }),
    chroniclePatches: plan.chroniclePatches.map((patch) => {
      if (patch.op === "create") {
        return {
          ...patch,
          value: {
            ...patch.value,
            entityRefs: patch.value.entityRefs.map(entityRef),
            godRefs: patch.value.godRefs.map(godRef),
          },
        };
      }
      if (patch.op === "remove") return { ...patch, targetId: chronicleRef(patch.targetId) };
      return {
        ...patch,
        targetId: chronicleRef(patch.targetId),
        changes: {
          ...patch.changes,
          ...(patch.changes.entityRefs === undefined
            ? {}
            : { entityRefs: patch.changes.entityRefs.map(entityRef) }),
          ...(patch.changes.godRefs === undefined
            ? {}
            : { godRefs: patch.changes.godRefs.map(godRef) }),
        },
      };
    }),
    memoryPatches: plan.memoryPatches.map((patch) => ({
      ...patch,
      entityId: entityRef(patch.entityId),
    })),
    omenPatches: plan.omenPatches.map((patch) => {
      if (patch.op === "create") {
        return {
          ...patch,
          value: { ...patch.value, godRef: godRef(patch.value.godRef) },
        };
      }
      if (patch.op === "remove") return { ...patch, targetId: omenRef(patch.targetId) };
      return {
        ...patch,
        targetId: omenRef(patch.targetId),
        changes: patch.changes.godRef === undefined
          ? patch.changes
          : { ...patch.changes, godRef: godRef(patch.changes.godRef) },
      };
    }),
    observerPatch: plan.observerPatch === null
      ? null
      : {
          ...plan.observerPatch,
          ...(plan.observerPatch.focus === undefined
            ? {}
            : {
                focus: {
                  ...plan.observerPatch.focus,
                  focusRef: plan.observerPatch.focus.focusRef === null
                    ? null
                    : plan.observerPatch.focus.focusType === "god"
                      ? godRef(plan.observerPatch.focus.focusRef)
                      : entityRef(plan.observerPatch.focus.focusRef),
                },
              }),
          ...(plan.observerPatch.activeAvatarRef === undefined
            ? {}
            : {
                activeAvatarRef: plan.observerPatch.activeAvatarRef === null
                  ? null
                  : entityRef(plan.observerPatch.activeAvatarRef),
              }),
        },
  });
}

async function applyInSerializableTransaction(
  db: RewriteDb,
  taskId: string,
  leaseToken: string,
  plan: RewritePlan,
): Promise<AppliedReality> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const task = await tx.realityRewrite.findFirst({ where: { id: taskId, leaseToken } });
        if (task === null) throw new RealityRewriteConflictError("现实改写任务租约已失效");
        if (task.resultTimelineId !== null) {
          const [source, result] = await Promise.all([
            tx.timeline.findUniqueOrThrow({
              where: { id: task.sourceTimelineId },
              select: { branchSummary: true },
            }),
            tx.timeline.findUniqueOrThrow({
              where: { id: task.resultTimelineId },
              select: { id: true, branchSummary: true },
            }),
          ]);
          return {
            resultTimelineId: result.id,
            sourceSummary: source.branchSummary ?? "",
            newSummary: result.branchSummary ?? plan.interpretation,
            consequenceLines: [...plan.causalConsequences],
          };
        }

        const world = await tx.world.findUnique({
          where: { id: task.worldId },
          select: {
            mode: true,
            activeTimelineId: true,
            operationKind: true,
            operationToken: true,
            operationLeaseExpiresAt: true,
          },
        });
        if (world === null) throw new RealityRewriteNotFoundError("世界不存在");
        if (world.mode !== "creator") throw new RealityRewriteForbiddenError();
        if (
          world.operationKind !== "rewrite"
          || world.operationToken !== task.id
          || world.operationLeaseExpiresAt === null
          || world.operationLeaseExpiresAt <= new Date()
        ) {
          throw new RealityRewriteConflictError("世界操作租约已失效");
        }
        if (world.activeTimelineId !== task.sourceTimelineId) {
          throw new RealityRewriteConflictError("来源现实已不再是当前现实，改写已取消");
        }
        const source = await tx.timeline.findFirst({
          where: { id: task.sourceTimelineId, worldId: task.worldId },
          select: { branchSummary: true },
        });
        if (source === null) throw new RealityRewriteConflictError("改写来源现实不存在");
        const currentChapter = await tx.chapter.findFirst({
          where: { timelineId: task.sourceTimelineId },
          orderBy: { index: "desc" },
          select: { id: true },
        });
        if (currentChapter?.id !== task.sourceChapterId) {
          throw new RealityRewriteConflictError("来源记录段已变化，改写已取消");
        }

        const cloned = await cloneTimelineGraph(tx, {
          sourceTimelineId: task.sourceTimelineId,
          worldId: task.worldId,
          rewriteId: task.id,
          branchName: plan.branchName,
          branchSummary: plan.interpretation,
        });
        const [sourceOmens, clonedOmens] = await Promise.all([
          tx.omenQueue.findMany({
            where: { timelineId: task.sourceTimelineId },
            select: { id: true, godId: true, text: true, consumed: true, createdAt: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
          tx.omenQueue.findMany({
            where: { timelineId: cloned.timelineId },
            select: { id: true, godId: true, text: true, consumed: true, createdAt: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }),
        ]);
        const usedClonedOmenIds = new Set<string>();
        const omenIds = new Map<string, string>();
        for (const sourceOmen of sourceOmens) {
          const clonedOmen = clonedOmens.find((candidate) =>
            !usedClonedOmenIds.has(candidate.id)
            && candidate.godId === cloned.maps.godIds.get(sourceOmen.godId)
            && candidate.text === sourceOmen.text
            && candidate.consumed === sourceOmen.consumed
            && candidate.createdAt.getTime() === sourceOmen.createdAt.getTime()
          );
          if (clonedOmen === undefined) {
            throw new RealityRewriteConflictError(`征兆缺少克隆映射：${sourceOmen.id}`);
          }
          usedClonedOmenIds.add(clonedOmen.id);
          omenIds.set(sourceOmen.id, clonedOmen.id);
        }
        const applied = await applyRewritePlan(tx, {
          worldId: task.worldId,
          timelineId: cloned.timelineId,
          rewriteId: task.id,
          plan: remapRewritePlanForClone(plan, cloned.maps, omenIds),
        });
        const latestChapter = await tx.chapter.findFirst({
          where: { timelineId: cloned.timelineId },
          orderBy: { index: "desc" },
          select: { index: true },
        });
        await tx.chapter.create({
          data: {
            timelineId: cloned.timelineId,
            index: (latestChapter?.index ?? -1) + 1,
            title: null,
            summary: applied.summary,
            settleState: "open",
          },
        });
        const switched = await tx.world.updateMany({
          where: {
            id: task.worldId,
            activeTimelineId: task.sourceTimelineId,
            operationKind: "rewrite",
            operationToken: task.id,
            operationLeaseExpiresAt: { gt: new Date() },
          },
          data: { activeTimelineId: cloned.timelineId },
        });
        if (switched.count !== 1) {
          throw new RealityRewriteConflictError("来源现实已不再是当前现实，改写已取消");
        }
        const advanced = await tx.realityRewrite.updateMany({
          where: { id: task.id, leaseToken, resultTimelineId: null },
          data: {
            resultTimelineId: cloned.timelineId,
            scope: plan.scope,
            status: "narrating",
            summary: applied.summary,
            error: null,
          },
        });
        if (advanced.count !== 1) throw new RealityRewriteConflictError("现实改写任务租约已失效");
        return {
          resultTimelineId: cloned.timelineId,
          sourceSummary: source.branchSummary ?? "",
          newSummary: applied.summary,
          consequenceLines: applied.consequenceLines,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < 2 && isSerializableConflict(error)) continue;
      throw error;
    }
  }
  throw new RealityRewriteConflictError("现实改写事务无法完成");
}

function hasRewriteMeta(meta: Prisma.JsonValue | null, taskId: string): boolean {
  return meta !== null
    && typeof meta === "object"
    && !Array.isArray(meta)
    && (meta as Record<string, Prisma.JsonValue>).realityRewriteId === taskId;
}

async function completeNarration(
  deps: RealityRewriteRunnerDependencies,
  taskId: string,
  leaseToken: string,
  task: RealityRewrite,
  plan: RewritePlan,
  result: AppliedReality,
  assertLeases: () => Promise<void>,
): Promise<void> {
  const chapter = await deps.db.chapter.findFirst({
    where: { timelineId: result.resultTimelineId },
    orderBy: { index: "desc" },
    select: { id: true },
  });
  if (chapter === null) throw new RealityRewriteConflictError("改写结果记录段不存在");
  const existing = await deps.db.message.findMany({
    where: { chapterId: chapter.id },
    select: { meta: true },
  });
  if (existing.some((message) => hasRewriteMeta(message.meta, taskId))) {
    await persistOwned(deps.db, taskId, leaseToken, {
      status: "completed",
      error: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    return;
  }

  const prose = await deps.narrate(task, plan, {
    sourceRealitySummary: result.sourceSummary,
    newRealitySummary: result.newSummary,
    consequenceLines: result.consequenceLines,
  });
  if (!prose.trim()) throw new Error("现实重铸结果叙事为空");
  await assertLeases();

  await deps.db.$transaction(async (tx) => {
    const now = new Date();
    const [owned, world] = await Promise.all([
      tx.realityRewrite.findFirst({
        where: {
          id: taskId,
          leaseToken,
          leaseExpiresAt: { gt: now },
          resultTimelineId: result.resultTimelineId,
        },
        select: { id: true },
      }),
      tx.world.findFirst({
        where: {
          id: task.worldId,
          activeTimelineId: result.resultTimelineId,
          operationKind: "rewrite",
          operationToken: task.id,
          operationLeaseExpiresAt: { gt: now },
        },
        select: { id: true },
      }),
    ]);
    if (owned === null || world === null) {
      throw new RealityRewriteConflictError("现实改写执行租约已失效");
    }
    const messages = await tx.message.findMany({
      where: { chapterId: chapter.id },
      select: { index: true, meta: true },
      orderBy: { index: "asc" },
    });
    if (!messages.some((message) => hasRewriteMeta(message.meta, taskId))) {
      await tx.message.create({
        data: {
          chapterId: chapter.id,
          index: (messages.at(-1)?.index ?? -1) + 1,
          role: "narrator",
          content: prose.trim(),
          scale: plan.scope === "retroactive" ? "epoch" : plan.scope === "memory_only" ? "era" : "scene",
          meta: {
            kind: "reality_rewrite_result",
            realityRewriteId: taskId,
            scope: plan.scope,
            decree: task.decree,
            settlementRequired: true,
            settlementReasons: ["major_event"],
          },
        },
      });
    }
    const completed = await tx.realityRewrite.updateMany({
      where: {
        id: taskId,
        leaseToken,
        leaseExpiresAt: { gt: new Date() },
        resultTimelineId: result.resultTimelineId,
      },
      data: {
        status: "completed",
        error: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (completed.count !== 1) throw new RealityRewriteConflictError("现实改写任务租约已失效");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function runRealityRewriteTask(
  taskId: string,
  dependencies: RealityRewriteRunnerDependencies = defaultDependencies,
): Promise<void> {
  const deps = dependencies;
  const claimed = await claimRealityRewriteTask(deps.db, taskId);
  if (claimed?.leaseToken === null || claimed?.leaseToken === undefined) return;
  const leaseToken = claimed.leaseToken;
  const operationToken = claimed.id;
  let worldLeaseAcquired = false;
  let lostLeaseError: RealityRewriteConflictError | null = null;
  const renewLeases = async (): Promise<void> => {
    if (lostLeaseError !== null) throw lostLeaseError;
    const [taskRenewed, worldRenewed] = await Promise.all([
      renewRealityRewriteLease(deps.db, taskId, leaseToken),
      worldLeaseAcquired
        ? renewWorldOperation(deps.db, claimed.worldId, "rewrite", operationToken)
        : Promise.resolve(true),
    ]);
    if (!taskRenewed || !worldRenewed) {
      lostLeaseError = new RealityRewriteConflictError("现实改写执行租约已失效");
      throw lostLeaseError;
    }
  };
  const heartbeat = setInterval(() => {
    void renewLeases().catch((error) => {
      lostLeaseError = error instanceof RealityRewriteConflictError
        ? error
        : new RealityRewriteConflictError("现实改写执行租约续期失败");
    });
  }, Math.min(REWRITE_LEASE_RENEW_MS, OPERATION_LEASE_RENEW_MS));

  try {
    const worldLease = await claimWorldOperation(deps.db, claimed.worldId, "rewrite", operationToken);
    if (!worldLease.acquired) throw new WorldOperationConflictError(worldLease.activeKind);
    worldLeaseAcquired = true;
    await renewLeases();

    let task = claimed;
    let plan = parseStoredPlan(task.plan);
    if (task.resultTimelineId === null && plan === null) {
      const context = await loadPlannerContext(deps.db, task);
      plan = RewritePlanSchema.parse(await deps.plan(task, context));
      await renewLeases();
      await persistOwned(deps.db, taskId, leaseToken, {
        plan: plan as unknown as Prisma.InputJsonValue,
        scope: plan.scope,
        status: "applying",
        error: null,
      });
      task = { ...task, plan: plan as unknown as Prisma.JsonValue, scope: plan.scope, status: "applying" };
    }
    if (plan === null) throw new RealityRewriteConflictError("现实改写计划缺失或损坏");

    let result: AppliedReality;
    if (task.resultTimelineId === null) {
      if (task.status !== "applying") await persistOwned(deps.db, taskId, leaseToken, { status: "applying" });
      await renewLeases();
      result = await applyInSerializableTransaction(deps.db, taskId, leaseToken, plan);
      task = {
        ...task,
        resultTimelineId: result.resultTimelineId,
        status: "narrating",
        summary: result.newSummary,
      };
    } else {
      const [source, resultTimeline] = await Promise.all([
        deps.db.timeline.findUnique({
          where: { id: task.sourceTimelineId },
          select: { branchSummary: true },
        }),
        deps.db.timeline.findUnique({
          where: { id: task.resultTimelineId },
          select: { branchSummary: true },
        }),
      ]);
      if (resultTimeline === null) throw new RealityRewriteConflictError("改写结果现实不存在");
      result = {
        resultTimelineId: task.resultTimelineId,
        sourceSummary: source?.branchSummary ?? "",
        newSummary: task.summary ?? resultTimeline.branchSummary ?? plan.interpretation,
        consequenceLines: [...plan.causalConsequences],
      };
      if (task.status !== "narrating") await persistOwned(deps.db, taskId, leaseToken, { status: "narrating" });
    }
    await renewLeases();
    await completeNarration(deps, taskId, leaseToken, task, plan, result, renewLeases);
  } catch (error) {
    await deps.db.realityRewrite.updateMany({
      where: {
        id: taskId,
        leaseToken,
        status: { in: ["planning", "applying", "narrating"] },
      },
      data: {
        status: "failed",
        error: sanitizeRewriteError(error),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  } finally {
    clearInterval(heartbeat);
    if (worldLeaseAcquired) {
      await releaseWorldOperation(deps.db, claimed.worldId, "rewrite", operationToken).catch(() => false);
    }
  }
}

const activeRunners = new Map<string, Promise<void>>();

export function ensureRealityRewriteRunning(taskId: string): void {
  if (activeRunners.has(taskId)) return;
  const promise = runRealityRewriteTask(taskId).finally(() => activeRunners.delete(taskId));
  activeRunners.set(taskId, promise);
  void promise.catch(() => {
    // The runner persists sanitized failure state. Detached route tasks must not
    // produce unhandled rejections.
  });
}
