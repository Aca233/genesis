import { Prisma, type PrismaClient } from "@prisma/client";
import {
  WorldOperationConflictError,
  claimWorldOperation,
  releaseWorldOperation,
  type WorldOperationClient,
} from "./operation-lock";

export type RealityNodeDto = {
  id: string;
  parentId: string | null;
  branchName: string;
  branchSummary: string | null;
  forkChapter: number | null;
  rewriteId: string | null;
  rewriteDecree: string | null;
  childCount: number;
  isActive: boolean;
  updatedAt: string;
};

export type RealityTreeDto = {
  nodes: RealityNodeDto[];
  activeId: string;
};

export type RealityTreeTimeline = {
  id: string;
  worldId: string;
  parentId: string | null;
  branchName: string;
  branchSummary: string | null;
  forkChapter: number | null;
  forkRewriteId: string | null;
  updatedAt: Date;
};

export type RealityTreeRewrite = {
  id: string;
  worldId: string;
  sourceTimelineId: string;
  resultTimelineId: string | null;
  decree: string;
};

export type RealityTreeInput = {
  worldId: string;
  activeTimelineId: string | null;
  timelines: RealityTreeTimeline[];
  rewrites: RealityTreeRewrite[];
};

export class RealityTreeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealityTreeValidationError";
  }
}

export class RealityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealityNotFoundError";
  }
}

export class RealityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealityConflictError";
  }
}

type TreeReader = Pick<PrismaClient, "world" | "timeline" | "realityRewrite">;
type SwitchClient = Pick<
  PrismaClient,
  "world" | "timeline" | "chapter" | "generationRequest"
>;
type TransactionalClient = TreeReader & Pick<PrismaClient, "$transaction">;

function invalid(message: string): never {
  throw new RealityTreeValidationError(message);
}

/** Validate a complete world's topology and return its client-safe tree projection. */
export function buildRealityTree(input: RealityTreeInput): RealityTreeDto {
  const timelines = new Map<string, RealityTreeTimeline>();
  for (const timeline of input.timelines) {
    if (timeline.worldId !== input.worldId) {
      invalid(`现实节点 ${timeline.id} 不属于同一世界`);
    }
    if (timelines.has(timeline.id)) invalid(`现实节点 ID 重复：${timeline.id}`);
    timelines.set(timeline.id, timeline);
  }

  const roots = input.timelines.filter((timeline) => timeline.parentId === null);
  if (roots.length !== 1) invalid("现实树根节点必须唯一");
  if (input.activeTimelineId === null || !timelines.has(input.activeTimelineId)) {
    invalid("活动现实必须存在于现实树中");
  }

  const childCounts = new Map<string, number>();
  for (const timeline of input.timelines) {
    if (timeline.parentId !== null) {
      if (!timelines.has(timeline.parentId)) {
        invalid(`现实节点 ${timeline.id} 的父节点不属于同一世界`);
      }
      childCounts.set(timeline.parentId, (childCounts.get(timeline.parentId) ?? 0) + 1);
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) invalid(`现实树存在环：${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const parentId = timelines.get(id)?.parentId;
    if (parentId !== null && parentId !== undefined) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of timelines.keys()) visit(id);

  const rewrites = new Map<string, RealityTreeRewrite>();
  for (const rewrite of input.rewrites) {
    if (rewrite.worldId !== input.worldId) {
      invalid(`现实改写 ${rewrite.id} 不属于同一世界`);
    }
    if (rewrites.has(rewrite.id)) invalid(`现实改写 ID 重复：${rewrite.id}`);
    const source = timelines.get(rewrite.sourceTimelineId);
    if (source === undefined) invalid(`现实改写 ${rewrite.id} 的来源现实不存在`);
    if (rewrite.resultTimelineId !== null) {
      const result = timelines.get(rewrite.resultTimelineId);
      if (
        result === undefined
        || result.parentId !== source.id
        || result.forkRewriteId !== rewrite.id
      ) {
        invalid(`现实改写 ${rewrite.id} 的来源、结果与父子关系不一致`);
      }
    }
    rewrites.set(rewrite.id, rewrite);
  }

  for (const timeline of input.timelines) {
    if (timeline.parentId === null && timeline.forkRewriteId !== null) {
      invalid("根现实不可绑定分叉改写");
    }
    if (timeline.forkRewriteId === null) continue;
    const rewrite = rewrites.get(timeline.forkRewriteId);
    if (
      rewrite === undefined
      || rewrite.sourceTimelineId !== timeline.parentId
      || rewrite.resultTimelineId !== timeline.id
    ) {
      invalid(`现实节点 ${timeline.id} 的现实改写绑定不一致`);
    }
  }

  return {
    activeId: input.activeTimelineId,
    nodes: input.timelines.map((timeline) => {
      const rewrite = timeline.forkRewriteId === null
        ? null
        : rewrites.get(timeline.forkRewriteId) ?? null;
      return {
        id: timeline.id,
        parentId: timeline.parentId,
        branchName: timeline.branchName,
        branchSummary: timeline.branchSummary,
        forkChapter: timeline.forkChapter,
        rewriteId: rewrite?.id ?? null,
        rewriteDecree: rewrite?.decree ?? null,
        childCount: childCounts.get(timeline.id) ?? 0,
        isActive: timeline.id === input.activeTimelineId,
        updatedAt: timeline.updatedAt.toISOString(),
      };
    }),
  };
}

async function readRealityTreeInput(db: TreeReader, worldId: string): Promise<RealityTreeInput> {
  const world = await db.world.findUnique({
    where: { id: worldId },
    select: { activeTimelineId: true },
  });
  if (world === null) throw new RealityNotFoundError("世界不存在");

  const [timelines, rewrites] = await Promise.all([
    db.timeline.findMany({
      where: { worldId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        worldId: true,
        parentId: true,
        branchName: true,
        branchSummary: true,
        forkChapter: true,
        forkRewriteId: true,
        updatedAt: true,
      },
    }),
    db.realityRewrite.findMany({
      where: { worldId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        worldId: true,
        sourceTimelineId: true,
        resultTimelineId: true,
        decree: true,
      },
    }),
  ]);
  return { worldId, activeTimelineId: world.activeTimelineId, timelines, rewrites };
}

export async function loadRealityTree(db: TreeReader, worldId: string): Promise<RealityTreeDto> {
  return buildRealityTree(await readRealityTreeInput(db, worldId));
}

export function parseRealityBranchName(value: string): string {
  const branchName = value.trim();
  const length = Array.from(branchName).length;
  if (length < 1 || length > 80) {
    throw new RealityConflictError("现实名称须为 1–80 个字符");
  }
  return branchName;
}

async function assertTargetIdle(db: SwitchClient, timelineId: string, now: Date): Promise<void> {
  const [liveGenerationCount, settlingChapterCount] = await Promise.all([
    db.generationRequest.count({
      where: {
        chapter: { timelineId },
        status: "pending",
        leaseExpiresAt: { gt: now },
      },
    }),
    db.chapter.count({
      where: { timelineId, settleState: { startsWith: "settling:" } },
    }),
  ]);
  if (liveGenerationCount > 0 || settlingChapterCount > 0) {
    throw new RealityConflictError("目标现实仍有叙事生成或章节结算进行中");
  }
}

export type SwitchRealityInput = {
  worldId: string;
  targetTimelineId: string;
  expectedActiveId: string;
  token?: string;
};

async function withSwitchLease<T>(
  db: SwitchClient,
  input: { worldId: string; token?: string },
  operation: () => Promise<T>,
): Promise<T> {
  const token = input.token ?? crypto.randomUUID();
  const operationDb = db as unknown as WorldOperationClient;
  const claim = await claimWorldOperation(operationDb, input.worldId, "switch", token);
  if (!claim.acquired) throw new WorldOperationConflictError(claim.activeKind);

  try {
    return await operation();
  } finally {
    await releaseWorldOperation(operationDb, input.worldId, "switch", token);
  }
}

async function switchRealityWhileLeased(
  db: SwitchClient,
  input: Omit<SwitchRealityInput, "token">,
): Promise<{ activeId: string }> {
  const target = await db.timeline.findFirst({
    where: { id: input.targetTimelineId, worldId: input.worldId },
    select: { id: true },
  });
  if (target === null) throw new RealityNotFoundError("目标现实不存在");

  await assertTargetIdle(db, target.id, new Date());
  const updated = await db.world.updateMany({
    where: { id: input.worldId, activeTimelineId: input.expectedActiveId },
    data: { activeTimelineId: target.id },
  });
  if (updated.count !== 1) {
    throw new RealityConflictError("当前现实已变化，请刷新现实树后重试");
  }
  return { activeId: target.id };
}

export async function switchReality(
  db: SwitchClient,
  input: SwitchRealityInput,
): Promise<{ activeId: string }> {
  return withSwitchLease(db, input, () => switchRealityWhileLeased(db, input));
}

export async function undoReality(
  db: SwitchClient,
  input: Omit<SwitchRealityInput, "targetTimelineId">,
): Promise<{ activeId: string }> {
  return withSwitchLease(db, input, async () => {
    const active = await db.timeline.findFirst({
      where: { id: input.expectedActiveId, worldId: input.worldId },
      select: { parentId: true },
    });
    if (active === null) throw new RealityNotFoundError("当前现实不存在");
    if (active.parentId === null) throw new RealityConflictError("根现实无法撤销到父现实");
    return switchRealityWhileLeased(db, {
      worldId: input.worldId,
      targetTimelineId: active.parentId,
      expectedActiveId: input.expectedActiveId,
    });
  });
}
export async function renameReality(
  db: Pick<PrismaClient, "timeline">,
  input: { worldId: string; timelineId: string; branchName: string },
): Promise<{ id: string; branchName: string }> {
  const branchName = parseRealityBranchName(input.branchName);
  const updated = await db.timeline.updateMany({
    where: { id: input.timelineId, worldId: input.worldId },
    data: { branchName },
  });
  if (updated.count !== 1) throw new RealityNotFoundError("现实节点不存在");
  return { id: input.timelineId, branchName };
}

function collectSubtree(rootId: string, timelines: RealityTreeTimeline[]): string[] {
  const children = new Map<string, string[]>();
  for (const timeline of timelines) {
    if (timeline.parentId === null) continue;
    const siblings = children.get(timeline.parentId) ?? [];
    siblings.push(timeline.id);
    children.set(timeline.parentId, siblings);
  }
  const result: string[] = [];
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    result.push(id);
    pending.push(...(children.get(id) ?? []));
  }
  return result;
}

export async function deleteRealitySubtree(
  db: TransactionalClient,
  input: { worldId: string; timelineId: string; expectedActiveId: string; token?: string },
): Promise<{ deletedIds: string[] }> {
  const token = input.token ?? crypto.randomUUID();
  const operationDb = db as unknown as WorldOperationClient;
  const claim = await claimWorldOperation(operationDb, input.worldId, "switch", token);
  if (!claim.acquired) throw new WorldOperationConflictError(claim.activeKind);

  try {
    return await db.$transaction(async (tx) => {
      const treeInput = await readRealityTreeInput(tx as unknown as TreeReader, input.worldId);
      buildRealityTree(treeInput);
      if (treeInput.activeTimelineId !== input.expectedActiveId) {
        throw new RealityConflictError("当前现实已变化，请刷新现实树后重试");
      }
      const target = treeInput.timelines.find((timeline) => timeline.id === input.timelineId);
      if (target === undefined) throw new RealityNotFoundError("现实节点不存在");
      if (target.parentId === null) throw new RealityConflictError("根现实不可删除");

      const deletedIds = collectSubtree(target.id, treeInput.timelines);
      if (deletedIds.includes(input.expectedActiveId)) {
        throw new RealityConflictError("当前现实不可删除");
      }

      await tx.realityRewrite.deleteMany({
        where: {
          worldId: input.worldId,
          OR: [
            { sourceTimelineId: { in: deletedIds } },
            { resultTimelineId: { in: deletedIds } },
          ],
        },
      });
      const deleted = await tx.timeline.deleteMany({
        where: { worldId: input.worldId, id: { in: deletedIds } },
      });
      if (deleted.count !== deletedIds.length) {
        throw new RealityConflictError("现实树已变化，请刷新后重试");
      }
      return { deletedIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } finally {
    await releaseWorldOperation(operationDb, input.worldId, "switch", token);
  }
}
