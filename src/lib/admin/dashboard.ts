import "server-only";
import { prisma } from "@/lib/db";
import { buildDailyTrend, deriveOverviewStatus, loadAdminSystemHealth } from "./data";
import { redactAdminError } from "./security";

type AdminDb = typeof prisma;
type StatusCount = { status: string; _count: { _all: number } };

function statusCount(rows: StatusCount[], status: string) {
  return rows.find((row) => row.status === status)?._count._all ?? 0;
}

function ratio(part: number, total: number) {
  return total > 0 ? part / total : 0;
}

export async function loadAdminDashboard(db: AdminDb = prisma) {
  const now = new Date();
  const since24h = new Date(now.getTime() - 86_400_000);
  const since7d = new Date(now.getTime() - 7 * 86_400_000);
  const staleSince = new Date(now.getTime() - 30 * 86_400_000);
  const probeStarted = performance.now();
  const databaseProbe = db.$queryRawUnsafe<Array<{ ok: number }>>("SELECT 1 AS ok")
    .then(() => ({ ok: true, latencyMs: Math.max(1, Math.round(performance.now() - probeStarted)) }))
    .catch(() => ({ ok: false, latencyMs: null }));

  const [
    users, userRows7d, activeSessions, activeUserRows, bannedUsers, adminUsers, recentUsers,
    worlds, worldRows7d, archivedWorlds, staleWorlds, worldStatuses, worldModes, recentWorlds,
    timelines, chapters, messages, gods, entities, abilities, chronicles, materials,
    genesisStatuses, genesis24h, genesisStalled, narrativeStatuses, narrative24h, narrativeStalled, rewriteStatuses, rewrite24h, rewriteStalled,
    genesisFailures, narrativeFailures, rewriteFailures, llm, llmRows, recentAudits, database, systemHealth,
  ] = await Promise.all([
    db.user.count(),
    db.user.findMany({ where: { createdAt: { gte: since7d } }, orderBy: { createdAt: "asc" }, take: 10_000, select: { createdAt: true } }),
    db.session.count({ where: { expiresAt: { gt: now } } }),
    db.session.groupBy({ by: ["userId"], where: { expiresAt: { gt: now } } }),
    db.user.count({ where: { banned: true } }),
    db.user.count({ where: { role: "admin", banned: { not: true } } }),
    db.user.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, email: true, role: true, banned: true, createdAt: true, _count: { select: { worlds: true, sessions: true } } } }),
    db.world.count(),
    db.world.findMany({ where: { createdAt: { gte: since7d } }, orderBy: { createdAt: "asc" }, take: 10_000, select: { createdAt: true } }),
    db.world.count({ where: { archivedAt: { not: null } } }).catch(() => null),
    db.world.count({ where: { updatedAt: { lt: staleSince } } }),
    db.world.groupBy({ by: ["status"], _count: { _all: true } }),
    db.world.groupBy({ by: ["mode"], _count: { _all: true } }),
    db.world.findMany({ orderBy: { updatedAt: "desc" }, take: 6, select: { id: true, name: true, mode: true, status: true, createdAt: true, updatedAt: true, user: { select: { id: true, name: true } }, _count: { select: { timelines: true, rewrites: true } } } }),
    db.timeline.count(), db.chapter.count(), db.message.count(), db.god.count(), db.entity.count(), db.ability.count(), db.chronicleEntry.count(), db.materialCard.count(),
    db.genesisTask.groupBy({ by: ["status"], _count: { _all: true } }),
    db.genesisTask.groupBy({ by: ["status"], where: { updatedAt: { gte: since24h } }, _count: { _all: true } }),
    db.genesisTask.count({ where: { status: { in: ["running", "repairing"] }, leaseExpiresAt: { lt: now } } }),
    db.generationRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    db.generationRequest.groupBy({ by: ["status"], where: { updatedAt: { gte: since24h } }, _count: { _all: true } }),
    db.generationRequest.count({ where: { status: "pending", leaseExpiresAt: { lt: now } } }),
    db.realityRewrite.groupBy({ by: ["status"], _count: { _all: true } }),
    db.realityRewrite.groupBy({ by: ["status"], where: { updatedAt: { gte: since24h } }, _count: { _all: true } }),
    db.realityRewrite.count({ where: { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: now } } }),
    db.genesisTask.findMany({ where: { status: "failed" }, orderBy: { updatedAt: "desc" }, take: 4, select: { id: true, stage: true, attempt: true, error: true, user: { select: { id: true, name: true } }, world: { select: { id: true, name: true } }, updatedAt: true } }),
    db.generationRequest.findMany({ where: { status: "failed" }, orderBy: { updatedAt: "desc" }, take: 4, select: { id: true, stage: true, attempt: true, safeError: true, error: true, updatedAt: true, chapter: { select: { timeline: { select: { world: { select: { id: true, name: true, user: { select: { id: true, name: true } } } } } } } } } }),
    db.realityRewrite.findMany({ where: { status: "failed" }, orderBy: { updatedAt: "desc" }, take: 4, select: { id: true, scope: true, error: true, updatedAt: true, world: { select: { id: true, name: true, user: { select: { id: true, name: true } } } } } }),
    db.llmCall.aggregate({ where: { createdAt: { gte: since24h } }, _count: { _all: true }, _avg: { durationMs: true }, _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, dynamicTokens: true, toolResultTokens: true } }),
    db.llmCall.findMany({ where: { createdAt: { gte: since24h } }, orderBy: { createdAt: "desc" }, take: 5_000, select: { id: true, task: true, provider: true, model: true, durationMs: true, ok: true, error: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, cacheFallback: true, userId: true, worldId: true, createdAt: true } }),
    db.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, action: true, targetType: true, targetId: true, targetLabel: true, reason: true, success: true, requestIp: true, createdAt: true, actor: { select: { id: true, name: true, email: true } } } }).catch(() => []),
    databaseProbe, loadAdminSystemHealth(),
  ]);

  const calls = llm._count._all;
  const llmFailed = llmRows.filter((row) => !row.ok).length;
  const successRate = calls ? (calls - llmFailed) / calls : 1;
  const durations = llmRows.map((row) => row.durationMs).sort((a, b) => a - b);
  const percentile95Ms = durations.length ? durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] : 0;
  const modelMap = new Map<string, { provider: string; model: string; calls: number; failed: number; durationMs: number; tokens: number }>();
  const taskMap = new Map<string, { task: string; calls: number; failed: number; durationMs: number; tokens: number }>();
  for (const row of llmRows) {
    const provider = row.provider ?? "未标记";
    const model = row.model ?? "未标记";
    const tokens = (row.inputTokens ?? 0) + (row.outputTokens ?? 0) + (row.cacheReadTokens ?? 0);
    const modelKey = provider + "/" + model;
    const modelItem = modelMap.get(modelKey) ?? { provider, model, calls: 0, failed: 0, durationMs: 0, tokens: 0 };
    modelItem.calls += 1; modelItem.failed += row.ok ? 0 : 1; modelItem.durationMs += row.durationMs; modelItem.tokens += tokens; modelMap.set(modelKey, modelItem);
    const taskItem = taskMap.get(row.task) ?? { task: row.task, calls: 0, failed: 0, durationMs: 0, tokens: 0 };
    taskItem.calls += 1; taskItem.failed += row.ok ? 0 : 1; taskItem.durationMs += row.durationMs; taskItem.tokens += tokens; taskMap.set(row.task, taskItem);
  }
  const summarize = <T extends { calls: number; failed: number; durationMs: number }>(items: T[]) => items.map((item) => ({ ...item, successRate: item.calls ? (item.calls - item.failed) / item.calls : 1, averageDurationMs: item.calls ? Math.round(item.durationMs / item.calls) : 0 })).sort((a, b) => b.calls - a.calls);
  const pipelines = [
    { key: "genesis", label: "创世任务", queued: statusCount(genesisStatuses, "queued"), running: statusCount(genesisStatuses, "running") + statusCount(genesisStatuses, "repairing"), completed: statusCount(genesisStatuses, "completed"), completed24h: statusCount(genesis24h, "completed"), failed: statusCount(genesisStatuses, "failed"), failed24h: statusCount(genesis24h, "failed"), cancelled: statusCount(genesisStatuses, "cancelled"), stalled: genesisStalled },
    { key: "narrative", label: "叙事生成", queued: statusCount(narrativeStatuses, "pending"), running: statusCount(narrativeStatuses, "pending"), completed: statusCount(narrativeStatuses, "completed"), completed24h: statusCount(narrative24h, "completed"), failed: statusCount(narrativeStatuses, "failed"), failed24h: statusCount(narrative24h, "failed"), cancelled: statusCount(narrativeStatuses, "cancelled"), stalled: narrativeStalled },
    { key: "rewrite", label: "现实重写", queued: statusCount(rewriteStatuses, "planning"), running: statusCount(rewriteStatuses, "planning") + statusCount(rewriteStatuses, "applying") + statusCount(rewriteStatuses, "narrating"), completed: statusCount(rewriteStatuses, "completed"), completed24h: statusCount(rewrite24h, "completed"), failed: statusCount(rewriteStatuses, "failed"), failed24h: statusCount(rewrite24h, "failed"), cancelled: statusCount(rewriteStatuses, "cancelled"), stalled: rewriteStalled },
  ];
  const failedTasks = pipelines.reduce((total, item) => total + item.failed, 0);
  const stalledTasks = pipelines.reduce((total, item) => total + item.stalled, 0);
  const memoryUsedRate = ratio(systemHealth.totalMemoryBytes - systemHealth.freeMemoryBytes, systemHealth.totalMemoryBytes);
  const diskUsedRate = systemHealth.disk ? ratio(systemHealth.disk.totalBytes - systemHealth.disk.freeBytes, systemHealth.disk.totalBytes) : null;
  const status = deriveOverviewStatus({ database: database.ok, stalledTasks, failedTasks, llmSuccessRate: successRate, memoryUsedRate, diskUsedRate });
  const issues = [
    ...(!database.ok ? [{ severity: "critical" as const, title: "数据库探测失败", detail: "管理端无法确认数据存储服务可用性", href: "/admin" }] : []),
    ...(stalledTasks ? [{ severity: "critical" as const, title: stalledTasks + " 个任务租约已过期", detail: "任务可能已经失去执行者，需要恢复或取消", href: "/admin/tasks" }] : []),
    ...(failedTasks ? [{ severity: "warning" as const, title: failedTasks + " 个任务处于失败状态", detail: "按任务类型与阶段检查失败原因", href: "/admin/tasks?status=failed" }] : []),
    ...(calls && successRate < 0.97 ? [{ severity: "warning" as const, title: "模型成功率低于 97%", detail: "24 小时内 " + llmFailed + " / " + calls + " 次调用失败", href: "/admin/llm?ok=no" }] : []),
    ...(memoryUsedRate >= 0.85 ? [{ severity: "warning" as const, title: "主机内存接近容量上限", detail: "当前使用 " + Math.round(memoryUsedRate * 100) + "%", href: "/admin" }] : []),
    ...(diskUsedRate !== null && diskUsedRate >= 0.85 ? [{ severity: "warning" as const, title: "磁盘空间接近容量上限", detail: "当前使用 " + Math.round(diskUsedRate * 100) + "%", href: "/admin" }] : []),
  ];
  const recentFailures = [
    ...genesisFailures.map((row) => ({ kind: "genesis" as const, id: row.id, stage: row.stage, attempt: row.attempt, error: redactAdminError(row.error ?? "未知错误"), user: row.user, world: row.world, updatedAt: row.updatedAt })),
    ...narrativeFailures.map((row) => ({ kind: "narrative" as const, id: row.id, stage: row.stage, attempt: row.attempt, error: redactAdminError(row.safeError ?? row.error ?? "未知错误"), user: row.chapter.timeline.world.user, world: { id: row.chapter.timeline.world.id, name: row.chapter.timeline.world.name }, updatedAt: row.updatedAt })),
    ...rewriteFailures.map((row) => ({ kind: "rewrite" as const, id: row.id, stage: row.scope, attempt: null, error: redactAdminError(row.error ?? "未知错误"), user: row.world.user, world: { id: row.world.id, name: row.world.name }, updatedAt: row.updatedAt })),
  ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 8);
  const countNew24h = (rows: Array<{ createdAt: Date }>) => rows.filter((row) => row.createdAt >= since24h).length;

  return {
    generatedAt: now, status, issues,
    users: { total: users, new24h: countNew24h(userRows7d), new7d: userRows7d.length, activeSessions, activeUsers: activeUserRows.length, admins: adminUsers, banned: bannedUsers, trend: buildDailyTrend(userRows7d, now), recent: recentUsers },
    worlds: { total: worlds, new24h: countNew24h(worldRows7d), new7d: worldRows7d.length, draft: statusCount(worldStatuses, "draft"), playing: statusCount(worldStatuses, "playing"), concluded: statusCount(worldStatuses, "concluded"), archived: archivedWorlds, stale: staleWorlds, modes: worldModes.map((row) => ({ mode: row.mode, count: row._count._all })).sort((a, b) => b.count - a.count), trend: buildDailyTrend(worldRows7d, now), recent: recentWorlds },
    content: { timelines, chapters, messages, gods, entities, abilities, chronicles, materials },
    tasks: { queued: pipelines.reduce((total, item) => total + item.queued, 0), running: pipelines.reduce((total, item) => total + item.running, 0), failed: failedTasks, stalled: stalledTasks, pipelines },
    llm: { calls, failures: llmFailed, successRate, averageDurationMs: Math.round(llm._avg.durationMs ?? 0), percentile95Ms, slowestDurationMs: durations.at(-1) ?? 0, inputTokens: llm._sum.inputTokens ?? 0, outputTokens: llm._sum.outputTokens ?? 0, cacheReadTokens: llm._sum.cacheReadTokens ?? 0, cacheWriteTokens: llm._sum.cacheWriteTokens ?? 0, dynamicTokens: llm._sum.dynamicTokens ?? 0, toolResultTokens: llm._sum.toolResultTokens ?? 0, cacheFallbacks: llmRows.filter((row) => row.cacheFallback).length, models: summarize(Array.from(modelMap.values())), tasks: summarize(Array.from(taskMap.values())), recentFailures: llmRows.filter((row) => !row.ok).slice(0, 5).map((row) => ({ ...row, error: redactAdminError(row.error ?? "未知错误") })) },
    recentFailures, recentAudits,
    health: { database: database.ok, databaseLatencyMs: database.latencyMs, memoryUsedRate, diskUsedRate, ...systemHealth },
  };
}
