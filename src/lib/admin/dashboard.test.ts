import { describe, expect, it, vi } from "vitest";
import { loadAdminDashboard } from "./dashboard";
import { loadAdminAnalysis } from "./analysis";

describe("admin dashboard privacy", () => {
  it("queries aggregate metadata without selecting user-authored content", async () => {
    const calls: unknown[] = [];
    const empty = async (args?: unknown) => { calls.push(args); return []; };
    const zero = async (args?: unknown) => { calls.push(args); return 0; };
    const db = new Proxy({}, {
      get: (_target, name) => name === "$queryRawUnsafe" ? async () => [{ ok: 1 }] : { count: zero, findMany: empty, groupBy: empty, aggregate: async (args?: unknown) => { calls.push(args); return { _count: { _all: 0 }, _avg: { durationMs: null }, _sum: {} }; } },
    });
    await loadAdminDashboard(db as never);
    const serialized = JSON.stringify(calls);
    for (const forbidden of ["genesisInput", "decree", "rawOutput", "content", "directive", "password", "accessToken", "refreshToken", "narrativeSlot", "backstageSlot", "embeddingSlot"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("reports recent audits as unavailable when the audit query fails", async () => {
    const zero = async () => 0;
    const empty = async () => [];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = new Proxy({}, {
      get: (_target, name) => {
        if (name === "$queryRawUnsafe") return async () => [{ ok: 1 }];
        if (name === "adminAuditLog") return { findMany: vi.fn().mockRejectedValue(new Error("offline")) };
        return { count: zero, findMany: empty, groupBy: empty, aggregate: async () => ({ _count: { _all: 0 }, _avg: { durationMs: null }, _sum: {} }) };
      },
    });

    const dashboard = await loadAdminDashboard(db as never);

    expect(dashboard.recentAudits).toEqual({ state: "unavailable", items: [] });
    expect(error).toHaveBeenCalledWith("[admin.dashboard] audit query failed", expect.any(Error));
    error.mockRestore();
  });

  it("reports recent audits as ready when metadata is available", async () => {
    const audit = {
      id: "audit-1",
      action: "retry-task",
      targetType: "genesis-task",
      targetId: "task-1",
      targetLabel: "创世任务 task-1",
      reason: "管理员重试",
      success: true,
      requestIp: "127.0.0.1",
      createdAt: new Date("2026-07-29T06:00:00.000Z"),
      actor: { id: "admin-1", name: "Admin", email: "admin@example.com" },
    };
    const zero = async () => 0;
    const empty = async () => [];
    const db = new Proxy({}, {
      get: (_target, name) => {
        if (name === "$queryRawUnsafe") return async () => [{ ok: 1 }];
        if (name === "adminAuditLog") return { findMany: vi.fn().mockResolvedValue([audit]) };
        return { count: zero, findMany: empty, groupBy: empty, aggregate: async () => ({ _count: { _all: 0 }, _avg: { durationMs: null }, _sum: {} }) };
      },
    });

    const dashboard = await loadAdminDashboard(db as never);

    expect(dashboard.recentAudits).toEqual({ state: "ready", items: [audit] });
  });
});

describe("admin analysis privacy", () => {
  it("builds 30-day analysis without selecting authored content or credentials", async () => {
    const calls: unknown[] = [];
    const empty = async (args?: unknown) => { calls.push(args); return []; };
    const zero = async (args?: unknown) => { calls.push(args); return 0; };
    const db = new Proxy({}, { get: () => ({ count: zero, findMany: empty, groupBy: empty }) });
    await loadAdminAnalysis(db as never);
    const serialized = JSON.stringify(calls);
    for (const forbidden of ["genesisInput", "decree", "rawOutput", "content", "directive", "password", "accessToken", "refreshToken", "narrativeSlot", "backstageSlot", "embeddingSlot"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
