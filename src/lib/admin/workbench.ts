import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redactAdminError } from "./security";
import {
  deriveTaskAttention,
  taskSelectionKey,
  type AdminAttentionTask,
  type AdminTaskSnapshot,
} from "./task-attention";

type AdminDb = typeof prisma;

export type AdminWorkbenchFilters = {
  view: "attention" | "failed" | "stale" | "repeated";
  search: string;
  selected: string | null;
};

export type AdminWorkbenchResult =
  | {
      state: "ready";
      generatedAt: Date;
      counts: {
        attention: number;
        failed: number;
        stale: number;
        repeated: number;
        recoveredToday: number;
      };
      items: AdminAttentionTask[];
      selected: AdminAttentionTask | null;
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

function mapGenesis(
  row: GenesisAttentionRow,
): AdminTaskSnapshot {
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

function mapNarrative(
  row: NarrativeAttentionRow,
): AdminTaskSnapshot {
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

function mapRewrite(
  row: RewriteAttentionRow,
): AdminTaskSnapshot {
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

function genesisAttentionWhere(now: Date) {
  return {
    OR: [
      { status: "failed" },
      { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: now } },
    ],
  };
}

function narrativeAttentionWhere(now: Date) {
  return {
    OR: [
      { status: "failed" },
      { status: "pending", leaseExpiresAt: { lt: now } },
    ],
  };
}

function rewriteAttentionWhere(now: Date) {
  return {
    OR: [
      { status: "failed" },
      { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: now } },
    ],
  };
}

function attentionQueries(db: AdminDb, now: Date) {
  return [
    db.genesisTask.findMany({
      where: genesisAttentionWhere(now),
      select: genesisAttentionSelect,
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    db.generationRequest.findMany({
      where: narrativeAttentionWhere(now),
      select: narrativeAttentionSelect,
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    db.realityRewrite.findMany({
      where: rewriteAttentionWhere(now),
      select: rewriteAttentionSelect,
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ] as const;
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
    .filter((task): task is AdminAttentionTask => task !== null);
}

function matchesView(task: AdminAttentionTask, view: AdminWorkbenchFilters["view"]) {
  if (view === "failed") return task.status === "failed";
  if (view === "stale") return task.reason === "stale";
  if (view === "repeated") return task.reason === "repeated_failure";
  return true;
}

function matchesSearch(task: AdminAttentionTask, rawSearch: string) {
  const search = rawSearch.trim().toLocaleLowerCase();
  if (search.length < 2) return true;
  return [
    task.id,
    task.kind,
    task.status,
    task.stage,
    task.user.id,
    task.user.name,
    task.user.email,
    task.world?.id,
    task.world?.name,
  ].some((value) => value?.toLocaleLowerCase().includes(search));
}

function sortAttention(items: AdminAttentionTask[]) {
  return items.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "high" ? -1 : 1;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

export async function loadAdminTaskWorkbench(
  filters: AdminWorkbenchFilters,
  db: AdminDb = prisma,
  now = new Date(),
): Promise<AdminWorkbenchResult> {
  try {
    const [genesis, narratives, rewrites, recoveredToday] = await Promise.all([
      ...attentionQueries(db, now),
      db.adminAuditLog.count({
        where: {
          success: true,
          action: { in: ["retry-task", "recover-task"] },
          createdAt: { gte: startOfLocalDay(now) },
        },
      }),
    ]);
    const attention = normalizeAttention(genesis, narratives, rewrites, now);
    const items = sortAttention(attention.filter((task) => matchesView(task, filters.view) && matchesSearch(task, filters.search)));

    return {
      state: "ready",
      generatedAt: now,
      counts: {
        attention: attention.length,
        failed: attention.filter((task) => task.status === "failed").length,
        stale: attention.filter((task) => task.reason === "stale").length,
        repeated: attention.filter((task) => task.reason === "repeated_failure").length,
        recoveredToday,
      },
      items,
      selected: items.find((task) => taskSelectionKey(task) === filters.selected) ?? null,
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
