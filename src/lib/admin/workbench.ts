import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redactAdminError } from "./security";
import {
  deriveTaskAttention,
  type AdminAttentionTask,
  type AdminTaskKind,
  type AdminTaskSnapshot,
} from "./task-attention";

type AdminDb = typeof prisma;

export type AdminWorkbenchFilters = {
  view: "attention" | "failed" | "stale" | "repeated";
  search: string;
  selected: string | null;
};

export type AdminRecoveredToday =
  | { state: "ready"; value: number }
  | { state: "unavailable" };

export type AdminWorkbenchResult =
  | {
      state: "ready";
      generatedAt: Date;
      counts: {
        attention: number;
        failed: number;
        stale: number;
        repeated: number;
        recoveredToday: AdminRecoveredToday;
      };
      items: AdminAttentionTask[];
      total: number;
      hasMore: boolean;
      selected: AdminTaskSnapshot | null;
    }
  | { state: "unavailable"; message: "任务数据暂不可用" };

const userSelect = { id: true, name: true, email: true } as const;
const genesisAttentionSelect = {
  id: true,
  status: true,
  stage: true,
  attempt: true,
  leaseExpiresAt: true,
  createdAt: true,
  updatedAt: true,
  error: true,
  user: { select: userSelect },
  world: { select: { id: true, name: true } },
} as const;
const narrativeAttentionSelect = {
  id: true,
  status: true,
  stage: true,
  attempt: true,
  leaseExpiresAt: true,
  createdAt: true,
  updatedAt: true,
  safeError: true,
  error: true,
  chapter: {
    select: {
      timeline: {
        select: {
          world: { select: { id: true, name: true, user: { select: userSelect } } },
        },
      },
    },
  },
} as const;
const rewriteAttentionSelect = {
  id: true,
  status: true,
  scope: true,
  leaseExpiresAt: true,
  createdAt: true,
  updatedAt: true,
  error: true,
  world: { select: { id: true, name: true, user: { select: userSelect } } },
} as const;

type GenesisAttentionRow = Prisma.GenesisTaskGetPayload<{ select: typeof genesisAttentionSelect }>;
type NarrativeAttentionRow = Prisma.GenerationRequestGetPayload<{ select: typeof narrativeAttentionSelect }>;
type RewriteAttentionRow = Prisma.RealityRewriteGetPayload<{ select: typeof rewriteAttentionSelect }>;

function mapGenesis(row: GenesisAttentionRow): AdminTaskSnapshot {
  return {
    kind: "genesis",
    id: row.id,
    status: row.status,
    stage: row.stage,
    attempt: row.attempt,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    error: row.error ? redactAdminError(row.error) : null,
    user: row.user,
    world: row.world,
  };
}

function mapNarrative(row: NarrativeAttentionRow): AdminTaskSnapshot {
  const world = row.chapter.timeline.world;
  return {
    kind: "narrative",
    id: row.id,
    status: row.status,
    stage: row.stage,
    attempt: row.attempt,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    error: redactAdminError(row.safeError ?? row.error ?? "") || null,
    user: world.user,
    world: { id: world.id, name: world.name },
  };
}

function mapRewrite(row: RewriteAttentionRow): AdminTaskSnapshot {
  return {
    kind: "rewrite",
    id: row.id,
    status: row.status,
    stage: row.scope,
    attempt: null,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    error: row.error ? redactAdminError(row.error) : null,
    user: row.world.user,
    world: { id: row.world.id, name: row.world.name },
  };
}

function startOfLocalDay(now: Date) {
  const value = new Date(now);
  value.setHours(0, 0, 0, 0);
  return value;
}

function genesisAttentionWhere(now: Date): Prisma.GenesisTaskWhereInput {
  return { OR: [
    { status: "failed" },
    { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: now } },
  ] };
}

function narrativeAttentionWhere(now: Date): Prisma.GenerationRequestWhereInput {
  return { OR: [
    { status: "failed" },
    { status: "pending", leaseExpiresAt: { lt: now } },
  ] };
}

function rewriteAttentionWhere(now: Date): Prisma.RealityRewriteWhereInput {
  return { OR: [
    { status: "failed" },
    { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: now } },
  ] };
}

function genesisStaleWhere(now: Date): Prisma.GenesisTaskWhereInput {
  return { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: now } };
}

function narrativeStaleWhere(now: Date): Prisma.GenerationRequestWhereInput {
  return { status: "pending", leaseExpiresAt: { lt: now } };
}

function rewriteStaleWhere(now: Date): Prisma.RealityRewriteWhereInput {
  return { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: now } };
}

function combineWhere<T>(...conditions: Array<T | undefined>): T {
  const active = conditions.filter((condition): condition is T => condition !== undefined);
  if (active.length === 1) return active[0];
  return { AND: active } as T;
}

function normalizedSearch(rawSearch: string) {
  const search = rawSearch.trim();
  return search.length >= 2 ? search : "";
}

function genesisSearchWhere(search: string): Prisma.GenesisTaskWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: "insensitive" as const };
  return { OR: [
    { id: contains }, { status: contains }, { stage: contains }, { userId: contains }, { worldId: contains },
    { user: { name: contains } }, { user: { email: contains } }, { world: { name: contains } },
  ] };
}

function narrativeSearchWhere(search: string): Prisma.GenerationRequestWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: "insensitive" as const };
  return { OR: [
    { id: contains }, { status: contains }, { stage: contains },
    { chapter: { timeline: { worldId: contains } } },
    { chapter: { timeline: { world: { name: contains } } } },
    { chapter: { timeline: { world: { userId: contains } } } },
    { chapter: { timeline: { world: { user: { name: contains } } } } },
    { chapter: { timeline: { world: { user: { email: contains } } } } },
  ] };
}

function rewriteSearchWhere(search: string): Prisma.RealityRewriteWhereInput | undefined {
  if (!search) return undefined;
  const contains = { contains: search, mode: "insensitive" as const };
  return { OR: [
    { id: contains }, { status: contains }, { scope: contains }, { worldId: contains },
    { world: { name: contains } }, { world: { userId: contains } },
    { world: { user: { name: contains } } }, { world: { user: { email: contains } } },
  ] };
}

function viewWheres(view: AdminWorkbenchFilters["view"], now: Date) {
  if (view === "failed") return [
    { status: "failed" } satisfies Prisma.GenesisTaskWhereInput,
    { status: "failed" } satisfies Prisma.GenerationRequestWhereInput,
    { status: "failed" } satisfies Prisma.RealityRewriteWhereInput,
  ] as const;
  if (view === "stale") return [genesisStaleWhere(now), narrativeStaleWhere(now), rewriteStaleWhere(now)] as const;
  if (view === "repeated") return [
    { status: "failed", attempt: { gte: 3 } } satisfies Prisma.GenesisTaskWhereInput,
    { status: "failed", attempt: { gte: 3 } } satisfies Prisma.GenerationRequestWhereInput,
    { id: { in: [] } } satisfies Prisma.RealityRewriteWhereInput,
  ] as const;
  return [genesisAttentionWhere(now), narrativeAttentionWhere(now), rewriteAttentionWhere(now)] as const;
}

function listWheres(filters: AdminWorkbenchFilters, now: Date) {
  const search = normalizedSearch(filters.search);
  const [genesisView, narrativeView, rewriteView] = viewWheres(filters.view, now);
  return [
    combineWhere<Prisma.GenesisTaskWhereInput>(genesisView, genesisSearchWhere(search)),
    combineWhere<Prisma.GenerationRequestWhereInput>(narrativeView, narrativeSearchWhere(search)),
    combineWhere<Prisma.RealityRewriteWhereInput>(rewriteView, rewriteSearchWhere(search)),
  ] as const;
}

function matchesSearch(task: AdminTaskSnapshot, rawSearch: string) {
  const search = normalizedSearch(rawSearch).toLocaleLowerCase();
  if (!search) return true;
  return [
    task.id, task.kind, task.status, task.stage, task.user.id, task.user.name, task.user.email,
    task.world?.id, task.world?.name,
  ].some((value) => value?.toLocaleLowerCase().includes(search));
}

function parseSelectionKey(selected: string | null): { kind: AdminTaskKind; id: string } | null {
  if (!selected) return null;
  const separator = selected.indexOf(":");
  if (separator <= 0 || separator === selected.length - 1) return null;
  const kind = selected.slice(0, separator);
  if (kind !== "genesis" && kind !== "narrative" && kind !== "rewrite") return null;
  return { kind, id: selected.slice(separator + 1) };
}

async function loadSelectedTask(db: AdminDb, selected: string | null): Promise<AdminTaskSnapshot | null> {
  const key = parseSelectionKey(selected);
  if (!key) return null;
  if (key.kind === "genesis") {
    const row = await db.genesisTask.findUnique({ where: { id: key.id }, select: genesisAttentionSelect });
    return row ? mapGenesis(row) : null;
  }
  if (key.kind === "narrative") {
    const row = await db.generationRequest.findUnique({ where: { id: key.id }, select: narrativeAttentionSelect });
    return row ? mapNarrative(row) : null;
  }
  const row = await db.realityRewrite.findUnique({ where: { id: key.id }, select: rewriteAttentionSelect });
  return row ? mapRewrite(row) : null;
}

function normalizeAttention(
  genesis: GenesisAttentionRow[],
  narratives: NarrativeAttentionRow[],
  rewrites: RewriteAttentionRow[],
  now: Date,
) {
  return [
    ...genesis.map(mapGenesis),
    ...narratives.map(mapNarrative),
    ...rewrites.map(mapRewrite),
  ]
    .map((task) => deriveTaskAttention(task, now))
    .filter((task): task is AdminAttentionTask => task !== null)
    .sort((left, right) => {
      if (left.severity !== right.severity) return left.severity === "high" ? -1 : 1;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
}

export async function loadAdminTaskWorkbench(
  filters: AdminWorkbenchFilters,
  db: AdminDb = prisma,
  now = new Date(),
): Promise<AdminWorkbenchResult> {
  const recoveredTodayPromise = db.adminAuditLog.count({
    where: {
      success: true,
      action: { in: ["retry-task", "recover-task"] },
      createdAt: { gte: startOfLocalDay(now) },
    },
  }).then((value): AdminRecoveredToday => ({ state: "ready", value }))
    .catch((error): AdminRecoveredToday => {
      console.error("[admin.workbench] recovered count failed", error);
      return { state: "unavailable" };
    });

  try {
    const [genesisWhere, narrativeWhere, rewriteWhere] = listWheres(filters, now);
    const [
      genesis, narratives, rewrites,
      genesisTotal, narrativeTotal, rewriteTotal,
      genesisAttention, narrativeAttention, rewriteAttention,
      genesisFailed, narrativeFailed, rewriteFailed,
      genesisStale, narrativeStale, rewriteStale,
      genesisRepeated, narrativeRepeated,
      selectedTask, recoveredToday,
    ] = await Promise.all([
      db.genesisTask.findMany({ where: genesisWhere, select: genesisAttentionSelect, orderBy: { updatedAt: "desc" }, take: 50 }),
      db.generationRequest.findMany({ where: narrativeWhere, select: narrativeAttentionSelect, orderBy: { updatedAt: "desc" }, take: 50 }),
      db.realityRewrite.findMany({ where: rewriteWhere, select: rewriteAttentionSelect, orderBy: { updatedAt: "desc" }, take: 50 }),
      db.genesisTask.count({ where: genesisWhere }),
      db.generationRequest.count({ where: narrativeWhere }),
      db.realityRewrite.count({ where: rewriteWhere }),
      db.genesisTask.count({ where: genesisAttentionWhere(now) }),
      db.generationRequest.count({ where: narrativeAttentionWhere(now) }),
      db.realityRewrite.count({ where: rewriteAttentionWhere(now) }),
      db.genesisTask.count({ where: { status: "failed" } }),
      db.generationRequest.count({ where: { status: "failed" } }),
      db.realityRewrite.count({ where: { status: "failed" } }),
      db.genesisTask.count({ where: genesisStaleWhere(now) }),
      db.generationRequest.count({ where: narrativeStaleWhere(now) }),
      db.realityRewrite.count({ where: rewriteStaleWhere(now) }),
      db.genesisTask.count({ where: { status: "failed", attempt: { gte: 3 } } }),
      db.generationRequest.count({ where: { status: "failed", attempt: { gte: 3 } } }),
      loadSelectedTask(db, filters.selected),
      recoveredTodayPromise,
    ]);
    const items = normalizeAttention(genesis, narratives, rewrites, now);
    const total = genesisTotal + narrativeTotal + rewriteTotal;

    return {
      state: "ready",
      generatedAt: now,
      counts: {
        attention: genesisAttention + narrativeAttention + rewriteAttention,
        failed: genesisFailed + narrativeFailed + rewriteFailed,
        stale: genesisStale + narrativeStale + rewriteStale,
        repeated: genesisRepeated + narrativeRepeated,
        recoveredToday,
      },
      items,
      total,
      hasMore: total > items.length,
      selected: selectedTask && matchesSearch(selectedTask, filters.search) ? selectedTask : null,
    };
  } catch (error) {
    console.error("[admin.workbench] task query failed", error);
    return { state: "unavailable", message: "任务数据暂不可用" };
  }
}

export async function loadAdminAttentionCount(db: AdminDb = prisma, now = new Date()) {
  const counts = await Promise.all([
    db.genesisTask.count({ where: genesisAttentionWhere(now) }),
    db.generationRequest.count({ where: narrativeAttentionWhere(now) }),
    db.realityRewrite.count({ where: rewriteAttentionWhere(now) }),
  ]);
  return counts.reduce((total, count) => total + count, 0);
}
