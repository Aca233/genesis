import { describe, expect, it, vi } from "vitest";
import { buildDailyTrend, deriveOverviewStatus, listAdminAudit, listAdminLlmCalls, listAdminTasks, listAdminWorlds, loadAdminOverview } from "./data";

describe("admin overview signals", () => {
  it("raises a critical status for database or stalled-task failures", () => {
    expect(deriveOverviewStatus({ database: false, stalledTasks: 0, failedTasks: 0, llmSuccessRate: 1, memoryUsedRate: 0.2, diskUsedRate: 0.3 })).toBe("critical");
    expect(deriveOverviewStatus({ database: true, stalledTasks: 1, failedTasks: 0, llmSuccessRate: 1, memoryUsedRate: 0.2, diskUsedRate: 0.3 })).toBe("critical");
  });

  it("raises a warning for degraded model reliability or resource pressure", () => {
    expect(deriveOverviewStatus({ database: true, stalledTasks: 0, failedTasks: 0, llmSuccessRate: 0.94, memoryUsedRate: 0.2, diskUsedRate: 0.3 })).toBe("warning");
    expect(deriveOverviewStatus({ database: true, stalledTasks: 0, failedTasks: 0, llmSuccessRate: 1, memoryUsedRate: 0.86, diskUsedRate: 0.3 })).toBe("warning");
  });

  it("fills missing dates in a seven-day trend", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    expect(buildDailyTrend([{ createdAt: new Date("2026-07-26T02:00:00.000Z") }, { createdAt: new Date("2026-07-26T18:00:00.000Z") }], now, 3)).toEqual([
      { date: "2026-07-26", count: 2 },
      { date: "2026-07-27", count: 0 },
      { date: "2026-07-28", count: 0 },
    ]);
  });
});

describe("admin data privacy", () => {
  it("world listing selects metadata and counts but never content fields", async () => {
    const db = {
      world: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    await listAdminWorlds({ search: "", status: "all", archived: "all", page: 1, pageSize: 25, skip: 0 }, db as never);
    const query = db.world.findMany.mock.calls[0]![0];
    expect(query.select).toEqual(expect.objectContaining({ id: true, name: true, status: true, _count: expect.any(Object) }));
    for (const forbidden of ["genesisInput", "draftDeck", "themeCard", "styleCard", "cosmology", "lorebookEntries"]) {
      expect(query.select).not.toHaveProperty(forbidden);
    }
  });

  it("overview uses bounded 24-hour aggregates", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _count: { _all: 0 }, _avg: { durationMs: null }, _sum: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } });
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const db = {
      user: { count }, session: { count }, world: { count }, genesisTask: { count, findMany },
      generationRequest: { count }, realityRewrite: { count }, llmCall: { aggregate, count }, $queryRaw: queryRaw,
    };
    await loadAdminOverview(db as never);
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: expect.any(Date) } }) }));
  });
});
const fixedNow = new Date("2026-07-29T07:00:00.000Z");
const listInput = { search: "", kind: "all", status: "all", attention: "no", stale: "no", repeated: "no", page: 1, pageSize: 25, skip: 0 };

function taskListDb() {
  const model = () => ({ findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) });
  return { genesisTask: model(), generationRequest: model(), realityRewrite: model() };
}

function evidenceDb() {
  return {
    llmCall: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    adminAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  };
}

function expectMatchingWhere(model: ReturnType<typeof taskListDb>["genesisTask"], where: unknown) {
  expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
  expect(model.count).toHaveBeenCalledWith({ where });
}

describe("admin task list query filters", () => {
  it("applies stale rules to every task family findMany and count boundary", async () => {
    const db = taskListDb();
    await listAdminTasks({ ...listInput, stale: "yes" }, db as never, fixedNow);

    expectMatchingWhere(db.genesisTask, { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: fixedNow } });
    expectMatchingWhere(db.generationRequest, { status: "pending", leaseExpiresAt: { lt: fixedNow } });
    expectMatchingWhere(db.realityRewrite, { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: fixedNow } });
  });

  it("applies attention rules to every task family findMany and count boundary", async () => {
    const db = taskListDb();
    await listAdminTasks({ ...listInput, attention: "yes" }, db as never, fixedNow);

    expectMatchingWhere(db.genesisTask, { OR: [{ status: "failed" }, { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: fixedNow } }] });
    expectMatchingWhere(db.generationRequest, { OR: [{ status: "failed" }, { status: "pending", leaseExpiresAt: { lt: fixedNow } }] });
    expectMatchingWhere(db.realityRewrite, { OR: [{ status: "failed" }, { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: fixedNow } }] });
  });

  it("applies repeated-failure rules and makes rewrite an empty query at both boundaries", async () => {
    const db = taskListDb();
    await listAdminTasks({ ...listInput, repeated: "yes" }, db as never, fixedNow);

    expectMatchingWhere(db.genesisTask, { status: "failed", attempt: { gte: 3 } });
    expectMatchingWhere(db.generationRequest, { status: "failed", attempt: { gte: 3 } });
    expectMatchingWhere(db.realityRewrite, { id: { in: [] } });
  });

  it("composes status, search, attention, stale, and repeated instead of ignoring active filters", async () => {
    const db = taskListDb();
    await listAdminTasks({ ...listInput, search: "  user@example.com  ", status: "failed", attention: "yes", stale: "yes", repeated: "yes" }, db as never, fixedNow);

    const genesisWhere = db.genesisTask.findMany.mock.calls[0]![0].where;
    expect(genesisWhere).toEqual({ AND: [
      { status: "failed" },
      { OR: [{ id: { contains: "user@example.com", mode: "insensitive" } }, expect.any(Object), expect.any(Object), expect.any(Object), expect.any(Object), expect.any(Object)] },
      { OR: [{ status: "failed" }, { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: fixedNow } }] },
      { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: fixedNow } },
      { status: "failed", attempt: { gte: 3 } },
    ] });
    expect(db.genesisTask.count).toHaveBeenCalledWith({ where: genesisWhere });
    expect(db.genesisTask.findMany.mock.calls[0]![0]).toEqual(expect.objectContaining({ skip: 0, take: 25 }));
  });
});

describe("admin evidence query filters", () => {
  it("filters LLM calls by exact context and keeps a metadata-only select", async () => {
    const db = evidenceDb();
    await listAdminLlmCalls({ search: "", ok: "no", task: "narrative", userId: "user-1", worldId: "world-1", page: 1, pageSize: 25, skip: 0 }, db as never);

    const query = db.llmCall.findMany.mock.calls[0]![0];
    expect(query.where).toEqual({ ok: false, task: "narrative", userId: "user-1", worldId: "world-1" });
    expect(db.llmCall.count).toHaveBeenCalledWith({ where: query.where });
    expect(query.select).toEqual(expect.objectContaining({ id: true, task: true, userId: true, worldId: true, ok: true }));
    for (const forbidden of ["prompt", "response", "body", "requestBody", "responseBody", "apiKey"]) expect(query.select).not.toHaveProperty(forbidden);
  });

  it("filters audit rows by exact target, action, and boolean result", async () => {
    const db = evidenceDb();
    await listAdminAudit({ search: "", targetId: "task-1", action: "task.retry", success: "no", page: 1, pageSize: 25, skip: 0 }, db as never);

    const query = db.adminAuditLog.findMany.mock.calls[0]![0];
    expect(query.where).toEqual({ targetId: "task-1", action: "task.retry", success: false });
    expect(db.adminAuditLog.count).toHaveBeenCalledWith({ where: query.where });
    for (const forbidden of ["prompt", "response", "body", "error", "apiKey"]) expect(query.select).not.toHaveProperty(forbidden);
  });
});
