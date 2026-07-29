import { describe, expect, it, vi } from "vitest";

const taskRunners = vi.hoisted(() => ({
  ensureGenesisTaskRunning: vi.fn(),
  ensureRealityRewriteRunning: vi.fn(),
  retryRealityRewrite: vi.fn(),
}));

vi.mock("@/lib/genesis/task-runner", () => ({ ensureGenesisTaskRunning: taskRunners.ensureGenesisTaskRunning }));
vi.mock("@/lib/reality/task-runner", () => ({
  ensureRealityRewriteRunning: taskRunners.ensureRealityRewriteRunning,
  retryRealityRewrite: taskRunners.retryRealityRewrite,
}));

import { mutateAdminTask, mutateAdminUser } from "./actions";

function userDb(overrides: Record<string, unknown> = {}) {
  const db = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: "user-2", name: "旅者", email: "u@example.com", role: "user", banned: false }),
      count: vi.fn().mockResolvedValue(2),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
    ...overrides,
  };
  return db;
}

describe("mutateAdminUser", () => {
  it("bans a user, revokes sessions and records an audit row", async () => {
    const db = userDb();
    await expect(mutateAdminUser({ actorUserId: "admin-1", requestIp: "203.0.113.1" }, { targetUserId: "user-2", action: "ban", reason: "滥用服务" }, db as never)).resolves.toEqual({ ok: true });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "user-2" }, data: { banned: true, banReason: "滥用服务" } });
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-2" } });
    expect(db.adminAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "ban-user", success: true, requestIp: "203.0.113.1" }) });
  });

  it("rejects deletion unless the email confirmation matches", async () => {
    const db = userDb();
    await expect(mutateAdminUser({ actorUserId: "admin-1", requestIp: null }, { targetUserId: "user-2", action: "delete", reason: "用户请求", confirmation: "wrong@example.com" }, db as never)).rejects.toThrow("确认文字不匹配");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("mutateAdminTask", () => {
  it("cancels a pending narrative task without exposing or replaying its content", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      generationRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: "generation-1", status: "pending", chapter: { timeline: { world: { id: "world-1", name: "星海" } } } }),
        updateMany,
      },
      adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await expect(mutateAdminTask({ actorUserId: "admin-1", requestIp: null }, { kind: "narrative", taskId: "generation-1", action: "cancel", reason: "异常卡住" }, db as never)).resolves.toEqual({ ok: true });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "generation-1", status: "pending" }, data: expect.objectContaining({ status: "cancelled", leaseExpiresAt: null }) });
  });

  it("does not pretend narrative jobs are safely retryable from the admin panel", async () => {
    const create = vi.fn().mockResolvedValue({});
    await expect(mutateAdminTask({ actorUserId: "admin-1", requestIp: null }, { kind: "narrative", taskId: "generation-1", action: "retry", reason: "重试" }, { generationRequest: { findUnique: vi.fn().mockResolvedValue({ id: "generation-1", status: "failed", leaseExpiresAt: null, chapter: { timeline: { world: { id: "world-1", name: "星海" } } } }) }, adminAuditLog: { create } } as never)).rejects.toThrow("任务当前不可执行此操作");
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "retry-task", success: false, targetType: "narrative-task" }) });
  });


  it("fails closed before executing a disallowed genesis action", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      genesisTask: {
        findUnique: vi.fn().mockResolvedValue({ id: "genesis-1", userId: "user-1", status: "completed", stage: "complete", leaseExpiresAt: null }),
        updateMany,
      },
      adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await expect(mutateAdminTask(
      { actorUserId: "admin-1", requestIp: null },
      { kind: "genesis", taskId: "genesis-1", action: "cancel", reason: "状态核验" },
      db as never,
    )).rejects.toThrow("任务当前不可执行此操作");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("fails closed before invoking rewrite retry/recovery for terminal tasks with residual leases", async () => {
    taskRunners.retryRealityRewrite.mockReset();
    const db = {
      realityRewrite: {
        findUnique: vi.fn().mockResolvedValue({
          id: "rewrite-1",
          status: "cancelled",
          leaseExpiresAt: new Date("2000-07-29T00:00:00.000Z"),
          world: { userId: "user-1", name: "星海" },
        }),
      },
      adminAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await expect(mutateAdminTask(
      { actorUserId: "admin-1", requestIp: null },
      { kind: "rewrite", taskId: "rewrite-1", action: "recover", reason: "状态核验" },
      db as never,
    )).rejects.toThrow("任务当前不可执行此操作");
    expect(taskRunners.retryRealityRewrite).not.toHaveBeenCalled();
  });
});
