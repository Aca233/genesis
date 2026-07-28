import "server-only";
import { prisma } from "@/lib/db";
import { buildDailySeries, clusterAdminErrors, comparePeriods, percentile } from "./analytics";
import { redactAdminError } from "./security";

type AdminDb = typeof prisma;
type Dated = { createdAt: Date };

function inPeriod(date: Date, start: Date, end: Date) {
  return date >= start && date < end;
}

function tokenTotal(row: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null }) {
  return (row.inputTokens ?? 0) + (row.outputTokens ?? 0) + (row.cacheReadTokens ?? 0) + (row.cacheWriteTokens ?? 0);
}

function periodCount(rows: Dated[], start: Date, end: Date) {
  return rows.filter((row) => inPeriod(row.createdAt, start, end)).length;
}

export async function loadAdminAnalysis(db: AdminDb = prisma) {
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 86_400_000);
  const since60d = new Date(now.getTime() - 60 * 86_400_000);
  const [
    usersTotal, usersWithWorld, userRows60d, worldRows60d, worldStatuses,
    llmRows60d, genesisRows60d, narrativeRows60d, rewriteRows60d,
    userLeaders, worldLeaders,
  ] = await Promise.all([
    db.user.count(),
    db.world.groupBy({ by: ["userId"] }),
    db.user.findMany({ where: { createdAt: { gte: since60d } }, take: 50_000, select: { createdAt: true } }),
    db.world.findMany({ where: { createdAt: { gte: since60d } }, take: 50_000, select: { createdAt: true } }),
    db.world.groupBy({ by: ["status"], _count: { _all: true } }),
    db.llmCall.findMany({ where: { createdAt: { gte: since60d } }, orderBy: { createdAt: "asc" }, take: 50_000, select: { id: true, task: true, provider: true, model: true, durationMs: true, ok: true, error: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, cacheRequested: true, cacheFallback: true, userId: true, worldId: true, createdAt: true } }),
    db.genesisTask.findMany({ where: { updatedAt: { gte: since60d }, status: { in: ["completed", "failed"] } }, take: 20_000, select: { id: true, status: true, error: true, updatedAt: true, userId: true, worldId: true } }),
    db.generationRequest.findMany({ where: { updatedAt: { gte: since60d }, status: { in: ["completed", "failed"] } }, take: 20_000, select: { id: true, status: true, safeError: true, error: true, updatedAt: true, chapter: { select: { timeline: { select: { world: { select: { id: true, userId: true } } } } } } } }),
    db.realityRewrite.findMany({ where: { updatedAt: { gte: since60d }, status: { in: ["completed", "failed"] } }, take: 20_000, select: { id: true, status: true, error: true, updatedAt: true, world: { select: { id: true, userId: true } } } }),
    db.user.findMany({ orderBy: { worlds: { _count: "desc" } }, take: 8, select: { id: true, name: true, email: true, createdAt: true, _count: { select: { worlds: true, sessions: true, genesisTasks: true } } } }),
    db.world.findMany({ orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, name: true, mode: true, status: true, updatedAt: true, user: { select: { id: true, name: true } }, _count: { select: { timelines: true, rewrites: true } } } }),
  ]);

  const currentLlm = llmRows60d.filter((row) => row.createdAt >= since30d);
  const previousLlm = llmRows60d.filter((row) => row.createdAt < since30d);
  const currentTaskRows = [
    ...genesisRows60d.map((row) => ({ kind: "genesis", status: row.status, error: row.error, occurredAt: row.updatedAt, userId: row.userId, worldId: row.worldId })),
    ...narrativeRows60d.map((row) => ({ kind: "narrative", status: row.status, error: row.safeError ?? row.error, occurredAt: row.updatedAt, userId: row.chapter.timeline.world.userId, worldId: row.chapter.timeline.world.id })),
    ...rewriteRows60d.map((row) => ({ kind: "rewrite", status: row.status, error: row.error, occurredAt: row.updatedAt, userId: row.world.userId, worldId: row.world.id })),
  ];
  const currentTasks = currentTaskRows.filter((row) => row.occurredAt >= since30d);
  const previousTasks = currentTaskRows.filter((row) => row.occurredAt < since30d);
  const currentDurations = currentLlm.map((row) => row.durationMs);
  const previousDurations = previousLlm.map((row) => row.durationMs);
  const currentTokens = currentLlm.reduce((total, row) => total + tokenTotal(row), 0);
  const previousTokens = previousLlm.reduce((total, row) => total + tokenTotal(row), 0);
  const currentFailures = currentLlm.filter((row) => !row.ok).length;
  const previousFailures = previousLlm.filter((row) => !row.ok).length;
  const currentCompletedTasks = currentTasks.filter((row) => row.status === "completed").length;
  const previousCompletedTasks = previousTasks.filter((row) => row.status === "completed").length;
  const currentFailedTasks = currentTasks.filter((row) => row.status === "failed").length;
  const previousFailedTasks = previousTasks.filter((row) => row.status === "failed").length;
  const cacheRequested = currentLlm.filter((row) => row.cacheRequested).length;
  const cacheHits = currentLlm.filter((row) => (row.cacheReadTokens ?? 0) > 0).length;

  const errorEvents = [
    ...currentTasks.filter((row) => row.status === "failed" && row.error).map((row) => ({ kind: row.kind, error: redactAdminError(row.error ?? "未知错误"), userId: row.userId, worldId: row.worldId, occurredAt: row.occurredAt })),
    ...currentLlm.filter((row) => !row.ok && row.error).map((row) => ({ kind: "llm:" + row.task, error: redactAdminError(row.error ?? "未知错误"), userId: row.userId, worldId: row.worldId, occurredAt: row.createdAt })),
  ];

  const userUsage = new Map<string, { calls: number; tokens: number; failures: number }>();
  const worldUsage = new Map<string, { calls: number; tokens: number; failures: number }>();
  for (const row of currentLlm) {
    if (row.userId) {
      const item = userUsage.get(row.userId) ?? { calls: 0, tokens: 0, failures: 0 };
      item.calls += 1; item.tokens += tokenTotal(row); item.failures += row.ok ? 0 : 1; userUsage.set(row.userId, item);
    }
    if (row.worldId) {
      const item = worldUsage.get(row.worldId) ?? { calls: 0, tokens: 0, failures: 0 };
      item.calls += 1; item.tokens += tokenTotal(row); item.failures += row.ok ? 0 : 1; worldUsage.set(row.worldId, item);
    }
  }
  const topUserIds = Array.from(userUsage.entries()).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 8).map(([id]) => id);
  const topWorldIds = Array.from(worldUsage.entries()).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 8).map(([id]) => id);
  const [usageUsers, usageWorlds] = await Promise.all([
    topUserIds.length ? db.user.findMany({ where: { id: { in: topUserIds } }, select: { id: true, name: true, email: true } }) : [],
    topWorldIds.length ? db.world.findMany({ where: { id: { in: topWorldIds } }, select: { id: true, name: true, status: true, user: { select: { name: true } } } }) : [],
  ]);
  const userById = new Map(usageUsers.map((item) => [item.id, item]));
  const worldById = new Map(usageWorlds.map((item) => [item.id, item]));
  const statusCount = (status: string) => worldStatuses.find((row) => row.status === status)?._count._all ?? 0;
  const taskTotal = currentCompletedTasks + currentFailedTasks;
  const previousTaskTotal = previousCompletedTasks + previousFailedTasks;

  return {
    period: { start: since30d, end: now, previousStart: since60d },
    comparisons: {
      newUsers: comparePeriods(periodCount(userRows60d, since30d, now), periodCount(userRows60d, since60d, since30d)),
      newWorlds: comparePeriods(periodCount(worldRows60d, since30d, now), periodCount(worldRows60d, since60d, since30d)),
      llmCalls: comparePeriods(currentLlm.length, previousLlm.length),
      tokens: comparePeriods(currentTokens, previousTokens),
      taskCompletions: comparePeriods(currentCompletedTasks, previousCompletedTasks),
      taskFailures: comparePeriods(currentFailedTasks, previousFailedTasks),
    },
    series: {
      users: buildDailySeries(userRows60d.filter((row) => row.createdAt >= since30d).map((row) => ({ occurredAt: row.createdAt, value: 1 })), now),
      worlds: buildDailySeries(worldRows60d.filter((row) => row.createdAt >= since30d).map((row) => ({ occurredAt: row.createdAt, value: 1 })), now),
      calls: buildDailySeries(currentLlm.map((row) => ({ occurredAt: row.createdAt, value: 1 })), now),
      tokens: buildDailySeries(currentLlm.map((row) => ({ occurredAt: row.createdAt, value: tokenTotal(row) })), now),
      taskCompletions: buildDailySeries(currentTasks.filter((row) => row.status === "completed").map((row) => ({ occurredAt: row.occurredAt, value: 1 })), now),
      failures: buildDailySeries([...currentLlm.filter((row) => !row.ok).map((row) => ({ occurredAt: row.createdAt, value: 1 })), ...currentTasks.filter((row) => row.status === "failed").map((row) => ({ occurredAt: row.occurredAt, value: 1 }))], now),
    },
    reliability: {
      llmSuccessRate: currentLlm.length ? (currentLlm.length - currentFailures) / currentLlm.length : 1,
      previousLlmSuccessRate: previousLlm.length ? (previousLlm.length - previousFailures) / previousLlm.length : 1,
      taskSuccessRate: taskTotal ? currentCompletedTasks / taskTotal : 1,
      previousTaskSuccessRate: previousTaskTotal ? previousCompletedTasks / previousTaskTotal : 1,
      latency: { p50: percentile(currentDurations, 0.5), p95: percentile(currentDurations, 0.95), p99: percentile(currentDurations, 0.99), previousP95: percentile(previousDurations, 0.95) },
      cache: { requested: cacheRequested, hits: cacheHits, hitRate: cacheRequested ? cacheHits / cacheRequested : null, fallbacks: currentLlm.filter((row) => row.cacheFallback).length, readTokens: currentLlm.reduce((total, row) => total + (row.cacheReadTokens ?? 0), 0) },
    },
    funnel: { registeredUsers: usersTotal, usersWithWorld: usersWithWorld.length, draftWorlds: statusCount("draft"), playingWorlds: statusCount("playing"), concludedWorlds: statusCount("concluded") },
    errorClusters: clusterAdminErrors(errorEvents, now).slice(0, 10),
    rankings: {
      usersByUsage: topUserIds.flatMap((id) => { const user = userById.get(id); const usage = userUsage.get(id); return user && usage ? [{ ...user, ...usage }] : []; }),
      worldsByUsage: topWorldIds.flatMap((id) => { const world = worldById.get(id); const usage = worldUsage.get(id); return world && usage ? [{ ...world, ...usage }] : []; }),
      usersByWorlds: userLeaders,
      recentWorlds: worldLeaders,
    },
  };
}
