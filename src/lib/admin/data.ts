import "server-only";
import os from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { redactAdminError } from "./security";

type AdminDb = typeof prisma;
export type AdminListInput = { search: string; page: number; pageSize: number; skip: number };
export type OverviewStatus = "healthy" | "warning" | "critical";

type OverviewStatusInput = {
  database: boolean;
  stalledTasks: number;
  failedTasks: number;
  llmSuccessRate: number;
  memoryUsedRate: number;
  diskUsedRate: number | null;
};

export function deriveOverviewStatus(input: OverviewStatusInput): OverviewStatus {
  if (!input.database || input.stalledTasks > 0) return "critical";
  if (input.failedTasks > 0 || input.llmSuccessRate < 0.97 || input.memoryUsedRate >= 0.85 || (input.diskUsedRate !== null && input.diskUsedRate >= 0.85)) return "warning";
  return "healthy";
}

export function buildDailyTrend(rows: Array<{ createdAt: Date }>, now = new Date(), days = 7) {
  const format = (date: Date) => date.toISOString().slice(0, 10);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(format(row.createdAt), (counts.get(format(row.createdAt)) ?? 0) + 1);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (days - index - 1));
    const key = format(date);
    return { date: key, count: counts.get(key) ?? 0 };
  });
}

function searchFilter(search: string) {
  const value = search.trim();
  return value.length >= 2 ? value : "";
}

export async function loadAdminSystemHealth() {
  const diskRoot = process.platform === "win32" ? `${process.cwd().slice(0, 2)}\\` : "/";
  const [disk, memoryInfo] = await Promise.all([
    statfs(diskRoot).then((value) => ({ totalBytes: value.blocks * value.bsize, freeBytes: value.bavail * value.bsize })).catch(() => null),
    process.platform === "linux" ? readFile("/proc/meminfo", "utf8").catch(() => "") : Promise.resolve(""),
  ]);
  const metric = (name: string) => {
    const match = memoryInfo.match(new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, "m"));
    return match ? Number(match[1]) * 1024 : null;
  };
  const swapTotalBytes = metric("SwapTotal");
  const swapFreeBytes = metric("SwapFree");
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    rssBytes: process.memoryUsage().rss,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    loadAverage: os.loadavg(),
    disk,
    swap: swapTotalBytes === null || swapFreeBytes === null ? null : { totalBytes: swapTotalBytes, freeBytes: swapFreeBytes },
    release: process.env.GENESIS_RELEASE ?? process.env.npm_package_version ?? "unknown",
  };
}

export async function loadAdminOverview(db: AdminDb = prisma) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const active = new Date();
  const [users, newUsers, sessions, bannedUsers, worlds, newWorlds, drafts, playing, concluded, archived, queued, running, failed, stalled, narrativeRunning, narrativeFailed, narrativeStalled, rewriteRunning, rewriteFailed, rewriteStalled, llm, llmFailed, recentFailures, database, systemHealth] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: since } } }),
    db.session.count({ where: { expiresAt: { gt: active } } }),
    db.user.count({ where: { banned: true } }),
    db.world.count(),
    db.world.count({ where: { createdAt: { gte: since } } }),
    db.world.count({ where: { status: "draft", archivedAt: null } }),
    db.world.count({ where: { status: "playing", archivedAt: null } }),
    db.world.count({ where: { status: "concluded", archivedAt: null } }),
    db.world.count({ where: { archivedAt: { not: null } } }),
    db.genesisTask.count({ where: { status: "queued" } }),
    db.genesisTask.count({ where: { status: { in: ["running", "repairing"] } } }),
    db.genesisTask.count({ where: { status: "failed" } }),
    db.genesisTask.count({ where: { status: { in: ["running", "repairing"] }, leaseExpiresAt: { lt: active } } }),
    db.generationRequest.count({ where: { status: "pending" } }),
    db.generationRequest.count({ where: { status: "failed" } }),
    db.generationRequest.count({ where: { status: "pending", leaseExpiresAt: { lt: active } } }),
    db.realityRewrite.count({ where: { status: { in: ["planning", "applying", "narrating"] } } }),
    db.realityRewrite.count({ where: { status: "failed" } }),
    db.realityRewrite.count({ where: { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: active } } }),
    db.llmCall.aggregate({
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true },
    }),
    db.llmCall.count({ where: { createdAt: { gte: since }, ok: false } }),
    db.genesisTask.findMany({
      where: { status: "failed" }, orderBy: { updatedAt: "desc" }, take: 5,
      select: { id: true, stage: true, error: true, user: { select: { id: true, name: true } }, world: { select: { id: true, name: true } }, updatedAt: true },
    }),
    db.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`.then(() => true).catch(() => false),
    loadAdminSystemHealth(),
  ]);
  const calls = llm._count._all;
  return {
    users: { total: users, new24h: newUsers, activeSessions: sessions, banned: bannedUsers },
    worlds: { total: worlds, new24h: newWorlds, draft: drafts, playing, concluded, archived },
    tasks: { queued, running: running + narrativeRunning + rewriteRunning, failed: failed + narrativeFailed + rewriteFailed, stalled: stalled + narrativeStalled + rewriteStalled },
    llm: { calls, successRate: calls ? (calls - llmFailed) / calls : 1, averageDurationMs: Math.round(llm._avg.durationMs ?? 0), inputTokens: llm._sum.inputTokens ?? 0, outputTokens: llm._sum.outputTokens ?? 0, cacheReadTokens: llm._sum.cacheReadTokens ?? 0 },
    recentFailures: recentFailures.map((row) => ({ ...row, error: redactAdminError(row.error ?? "未知错误") })),
    health: { database, ...systemHealth },
  };
}

export async function listAdminWorlds(input: AdminListInput & { status: string; archived: string }, db: AdminDb = prisma) {
  const search = searchFilter(input.search);
  const where = {
    ...(search ? { OR: [{ id: { contains: search, mode: "insensitive" as const } }, { name: { contains: search, mode: "insensitive" as const } }, { user: { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }] } }] } : {}),
    ...(input.status !== "all" ? { status: input.status } : {}),
    ...(input.archived === "yes" ? { archivedAt: { not: null } } : input.archived === "no" ? { archivedAt: null } : {}),
  };
  const select = { id: true, name: true, mode: true, status: true, archivedAt: true, createdAt: true, updatedAt: true, user: { select: { id: true, name: true, email: true } }, _count: { select: { timelines: true, rewrites: true } } } as const;
  const [items, total] = await Promise.all([db.world.findMany({ where, select, orderBy: { updatedAt: "desc" }, skip: input.skip, take: input.pageSize }), db.world.count({ where })]);
  return { items, total };
}

export async function listAdminUsers(input: AdminListInput & { role: string; banned: string }, db: AdminDb = prisma) {
  const search = searchFilter(input.search);
  const where = {
    ...(search ? { OR: [{ id: { contains: search, mode: "insensitive" as const } }, { name: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }] } : {}),
    ...(input.role !== "all" ? { role: input.role } : {}),
    ...(input.banned === "yes" ? { banned: true } : input.banned === "no" ? { OR: [{ banned: false }, { banned: null }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: input.skip, take: input.pageSize, select: { id: true, name: true, email: true, image: true, role: true, banned: true, banReason: true, createdAt: true, updatedAt: true, accounts: { select: { providerId: true } }, _count: { select: { sessions: true, worlds: true, genesisTasks: true } } } }),
    db.user.count({ where }),
  ]);
  return { items, total };
}

export async function listAdminTasks(input: AdminListInput & { kind: string; status: string }, db: AdminDb = prisma) {
  const status = input.status === "all" ? undefined : input.status;
  const kinds = input.kind === "all" ? ["genesis", "narrative", "rewrite"] : [input.kind];
  const take = input.kind === "all" ? input.skip + input.pageSize : input.pageSize;
  const skip = input.kind === "all" ? 0 : input.skip;
  const [genesis, narratives, rewrites, genesisTotal, narrativeTotal, rewriteTotal] = await Promise.all([
    kinds.includes("genesis") ? db.genesisTask.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: "desc" }, take, skip, select: { id: true, status: true, stage: true, attempt: true, leaseExpiresAt: true, createdAt: true, updatedAt: true, error: true, user: { select: { id: true, name: true, email: true } }, world: { select: { id: true, name: true } } } }) : [],
    kinds.includes("narrative") ? db.generationRequest.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: "desc" }, take, skip, select: { id: true, status: true, stage: true, attempt: true, leaseExpiresAt: true, createdAt: true, updatedAt: true, safeError: true, error: true, chapter: { select: { timeline: { select: { world: { select: { id: true, name: true, user: { select: { id: true, name: true, email: true } } } } } } } } } }) : [],
    kinds.includes("rewrite") ? db.realityRewrite.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: "desc" }, take, skip, select: { id: true, status: true, scope: true, leaseExpiresAt: true, createdAt: true, updatedAt: true, error: true, world: { select: { id: true, name: true, user: { select: { id: true, name: true, email: true } } } } } }) : [],
    kinds.includes("genesis") ? db.genesisTask.count({ where: status ? { status } : {} }) : 0,
    kinds.includes("narrative") ? db.generationRequest.count({ where: status ? { status } : {} }) : 0,
    kinds.includes("rewrite") ? db.realityRewrite.count({ where: status ? { status } : {} }) : 0,
  ]);
  const items = [
    ...genesis.map((row) => ({ kind: "genesis" as const, id: row.id, status: row.status, stage: row.stage, attempt: row.attempt, leaseExpiresAt: row.leaseExpiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt, error: row.error ? redactAdminError(row.error) : null, user: row.user, world: row.world })),
    ...narratives.map((row) => ({ kind: "narrative" as const, id: row.id, status: row.status, stage: row.stage, attempt: row.attempt, leaseExpiresAt: row.leaseExpiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt, error: row.safeError ? redactAdminError(row.safeError) : row.error ? redactAdminError(row.error) : null, user: row.chapter.timeline.world.user, world: { id: row.chapter.timeline.world.id, name: row.chapter.timeline.world.name } })),
    ...rewrites.map((row) => ({ kind: "rewrite" as const, id: row.id, status: row.status, stage: row.scope, attempt: null, leaseExpiresAt: row.leaseExpiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt, error: row.error ? redactAdminError(row.error) : null, user: row.world.user, world: { id: row.world.id, name: row.world.name } })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return { items: input.kind === "all" ? items.slice(input.skip, input.skip + input.pageSize) : items, total: genesisTotal + narrativeTotal + rewriteTotal };
}

export async function listAdminLlmCalls(input: AdminListInput & { ok: string; task: string }, db: AdminDb = prisma) {
  const where = { ...(input.ok === "yes" ? { ok: true } : input.ok === "no" ? { ok: false } : {}), ...(input.task !== "all" ? { task: input.task } : {}) };
  const [items, total] = await Promise.all([db.llmCall.findMany({ where, orderBy: { createdAt: "desc" }, skip: input.skip, take: input.pageSize, select: { id: true, task: true, slot: true, provider: true, model: true, durationMs: true, ok: true, error: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, cacheRequested: true, cacheFallback: true, userId: true, worldId: true, createdAt: true } }), db.llmCall.count({ where })]);
  return { items: items.map((row) => ({ ...row, error: row.error ? redactAdminError(row.error) : null })), total };
}

export async function listAdminAudit(input: AdminListInput, db: AdminDb = prisma) {
  const [items, total] = await Promise.all([db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, skip: input.skip, take: input.pageSize, select: { id: true, action: true, targetType: true, targetId: true, targetLabel: true, reason: true, success: true, requestIp: true, metadata: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } } }), db.adminAuditLog.count()]);
  return { items, total };
}
