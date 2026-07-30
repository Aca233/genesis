import { describe, expect, it, vi } from "vitest";
import { loadAdminAttentionCount, loadAdminTaskWorkbench } from "./workbench";

const now = new Date("2026-07-29T07:00:00.000Z");

function taskDb() {
  return {
    genesisTask: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    generationRequest: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    realityRewrite: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
    adminAuditLog: { count: vi.fn().mockResolvedValue(0) },
  };
}

describe("admin task workbench", () => {
  it("queries only failed or lease-expired metadata", async () => {
    const db = taskDb();

    await loadAdminTaskWorkbench({ view: "attention", search: "", selected: null }, db as never, now);

    expect(db.genesisTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { status: "failed" },
        { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: now } },
      ] },
      select: expect.objectContaining({ id: true, status: true, stage: true, attempt: true, leaseExpiresAt: true }),
      take: 50,
    }));
    expect(db.generationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { status: "failed" },
        { status: "pending", leaseExpiresAt: { lt: now } },
      ] },
      take: 50,
    }));
    expect(db.realityRewrite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { status: "failed" },
        { status: { in: ["planning", "applying", "narrating"] }, leaseExpiresAt: { lt: now } },
      ] },
      take: 50,
    }));
    const serialized = JSON.stringify([
      db.genesisTask.findMany.mock.calls[0],
      db.generationRequest.findMany.mock.calls[0],
      db.realityRewrite.findMany.mock.calls[0],
    ]);
    expect(serialized).not.toMatch(/genesisInput|content|rawOutput|decree|directive|password|accessToken|refreshToken/);
    expect(db.adminAuditLog.count).toHaveBeenCalledWith({
      where: {
        success: true,
        action: { in: ["retry-task", "recover-task"] },
        createdAt: { gte: expect.any(Date) },
      },
    });
  });

  it("returns unavailable instead of a false empty queue", async () => {
    const db = taskDb();
    db.genesisTask.findMany.mockRejectedValueOnce(new Error("offline"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(loadAdminTaskWorkbench({ view: "attention", search: "", selected: null }, db as never, now)).resolves.toEqual({
      state: "unavailable",
      message: "任务数据暂不可用",
    });
    expect(error).toHaveBeenCalledWith("[admin.workbench] task query failed", expect.any(Error));
    error.mockRestore();
  });

  it("normalizes, redacts, counts, filters, sorts, searches, and selects task metadata", async () => {
    const genesisRows = [
      {
        id: "genesis-repeated", status: "failed", stage: "pantheon", attempt: 3, leaseExpiresAt: null,
        createdAt: new Date("2026-07-29T06:00:00.000Z"), updatedAt: new Date("2026-07-29T06:30:00.000Z"),
        error: "Bearer secret-token timed out", user: { id: "user-1", name: "林默", email: "lin@example.com" },
        world: { id: "world-1", name: "雾港纪元" },
      },
      {
        id: "genesis-failed", status: "failed", stage: "world", attempt: 1, leaseExpiresAt: null,
        createdAt: new Date("2026-07-29T06:10:00.000Z"), updatedAt: new Date("2026-07-29T06:50:00.000Z"),
        error: "ordinary failure", user: { id: "user-2", name: "周岚", email: "zhou@example.com" }, world: null,
      },
    ];
    const narrativeRows = [{
      id: "narrative-stale", status: "pending", stage: "draft", attempt: 1,
      leaseExpiresAt: new Date("2026-07-29T06:59:00.000Z"), createdAt: new Date("2026-07-29T06:20:00.000Z"),
      updatedAt: new Date("2026-07-29T06:55:00.000Z"), safeError: "safe summary", error: "raw provider detail",
      chapter: { timeline: { world: { id: "world-2", name: "星海", user: { id: "user-3", name: "沈星", email: "shen@example.com" } } } },
    }];
    const db = taskDb();
    db.adminAuditLog.count.mockResolvedValueOnce(2);
    db.genesisTask.findMany.mockResolvedValueOnce(genesisRows);
    db.genesisTask.findUnique.mockResolvedValueOnce(genesisRows[0]);
    db.generationRequest.findMany.mockResolvedValueOnce(narrativeRows);
    db.genesisTask.count
      .mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    db.generationRequest.count
      .mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const all = await loadAdminTaskWorkbench({ view: "attention", search: "", selected: "genesis:genesis-repeated" }, db as never, now);

    expect(all).toEqual(expect.objectContaining({
      state: "ready", generatedAt: now,
      counts: { attention: 3, failed: 2, stale: 1, repeated: 1, recoveredToday: { state: "ready", value: 2 } },
      selected: expect.objectContaining({ id: "genesis-repeated" }),
    }));
    if (all.state !== "ready") throw new Error("expected ready workbench");
    expect(all.items.map((item) => item.id)).toEqual(["genesis-repeated", "narrative-stale", "genesis-failed"]);
    expect(all.items[0].error).not.toContain("secret-token");

    const shortSearchDb = taskDb();
    shortSearchDb.genesisTask.findMany.mockResolvedValueOnce(genesisRows);
    const shortSearch = await loadAdminTaskWorkbench({ view: "failed", search: "林", selected: null }, shortSearchDb as never, now);
    expect(shortSearch).toEqual(expect.objectContaining({ state: "ready", items: [
      expect.objectContaining({ id: "genesis-repeated" }),
      expect.objectContaining({ id: "genesis-failed" }),
    ] }));

    const searchDb = taskDb();
    searchDb.genesisTask.findMany.mockResolvedValueOnce([genesisRows[0]]);
    const searched = await loadAdminTaskWorkbench({ view: "repeated", search: "雾港", selected: "genesis:missing" }, searchDb as never, now);
    expect(searched).toEqual(expect.objectContaining({
      state: "ready", items: [expect.objectContaining({ id: "genesis-repeated" })], selected: null,
    }));
  });



  it("keeps the core queue ready when only recovered-today counting fails", async () => {
    const db = taskDb();
    db.adminAuditLog.count.mockRejectedValueOnce(new Error("audit offline"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await loadAdminTaskWorkbench({ view: "attention", search: "", selected: null }, db as never, now);

    expect(result).toEqual(expect.objectContaining({
      state: "ready",
      counts: expect.objectContaining({ recoveredToday: { state: "unavailable" } }),
      items: [],
    }));
    expect(error).toHaveBeenCalledWith("[admin.workbench] recovered count failed", expect.any(Error));
    error.mockRestore();
  });

  it("uses database filters and independent counts, exposes overflow, and resolves a truncated terminal deep link", async () => {
    const db = taskDb();
    const queueRow = {
      id: "genesis-visible", status: "failed", stage: "pantheon", attempt: 1, leaseExpiresAt: null,
      createdAt: new Date("2026-07-29T06:00:00.000Z"), updatedAt: new Date("2026-07-29T06:30:00.000Z"),
      error: "safe failure", user: { id: "user-1", name: "值守样本", email: "sample@example.com" }, world: null,
    };
    const selectedRow = {
      ...queueRow,
      id: "genesis-truncated",
      status: "completed",
      stage: "complete",
      updatedAt: new Date("2026-07-29T06:59:00.000Z"),
      error: null,
    };
    db.genesisTask.findMany.mockResolvedValueOnce([queueRow]);
    db.genesisTask.findUnique.mockResolvedValueOnce(selectedRow);
    db.genesisTask.count.mockResolvedValue(51);
    db.adminAuditLog.count.mockResolvedValueOnce(7);

    const result = await loadAdminTaskWorkbench({
      view: "attention",
      search: "值守",
      selected: "genesis:genesis-truncated",
    }, db as never, now);

    expect(result).toEqual(expect.objectContaining({
      state: "ready",
      total: 51,
      hasMore: true,
      counts: expect.objectContaining({ attention: 51, recoveredToday: { state: "ready", value: 7 } }),
      items: [expect.objectContaining({ id: "genesis-visible" })],
      selected: expect.objectContaining({ id: "genesis-truncated", status: "completed", stage: "complete" }),
    }));
    expect(db.genesisTask.findUnique).toHaveBeenCalledWith({
      where: { id: "genesis-truncated" },
      select: expect.objectContaining({ id: true, status: true, stage: true, leaseExpiresAt: true }),
    });
    const selectedQuery = JSON.stringify(db.genesisTask.findUnique.mock.calls[0]);
    expect(selectedQuery).not.toMatch(/genesisInput|content|rawOutput|decree|directive|password|accessToken|refreshToken/);
    const listQuery = JSON.stringify(db.genesisTask.findMany.mock.calls[0]);
    expect(listQuery).toContain("值守");
    expect(listQuery).toContain("failed");
    expect(db.genesisTask.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.any(Object) }));
  });

  it("keeps an independently selected task only while metadata search still matches", async () => {
    const selectedRow = {
      id: "genesis-selected", status: "completed", stage: "complete", attempt: 1, leaseExpiresAt: null,
      createdAt: new Date("2026-07-29T06:00:00.000Z"), updatedAt: new Date("2026-07-29T06:30:00.000Z"),
      error: null, user: { id: "user-1", name: "林舟", email: "lin@example.com" }, world: { id: "world-1", name: "雾港纪元" },
    };
    const matchingDb = taskDb();
    matchingDb.genesisTask.findUnique.mockResolvedValueOnce(selectedRow);
    const matching = await loadAdminTaskWorkbench({ view: "failed", search: "雾港", selected: "genesis:genesis-selected" }, matchingDb as never, now);
    expect(matching).toEqual(expect.objectContaining({ state: "ready", selected: expect.objectContaining({ id: "genesis-selected" }) }));

    const mismatchDb = taskDb();
    mismatchDb.genesisTask.findUnique.mockResolvedValueOnce(selectedRow);
    const mismatch = await loadAdminTaskWorkbench({ view: "failed", search: "不匹配", selected: "genesis:genesis-selected" }, mismatchDb as never, now);
    expect(mismatch).toEqual(expect.objectContaining({ state: "ready", selected: null }));
  });

  it("loads an attention count without converting query failures to zero", async () => {
    const db = taskDb();
    db.genesisTask.count.mockResolvedValueOnce(1);
    db.generationRequest.count.mockResolvedValueOnce(2);
    db.realityRewrite.count.mockResolvedValueOnce(3);

    await expect(loadAdminAttentionCount(db as never, now)).resolves.toBe(6);
    expect(db.genesisTask.count).toHaveBeenCalledWith({ where: {
      OR: [
        { status: "failed" },
        { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: now } },
      ],
    } });

    const offline = taskDb();
    offline.genesisTask.count.mockRejectedValueOnce(new Error("offline"));
    await expect(loadAdminAttentionCount(offline as never, now)).rejects.toThrow("offline");
  });
});
