import { describe, expect, it, vi } from "vitest";
import { claimGenesisTask, renewGenesisLease, toGenesisTaskDto } from "./task-runner";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    status: "running",
    stage: "gods",
    completedKeys: ["worldName", "cosmology", "fusionAxiom"],
    error: null,
    worldId: null,
    createdAt: new Date("2026-07-21T00:00:00Z"),
    updatedAt: new Date("2026-07-21T00:00:10Z"),
    ...overrides,
  };
}

describe("genesis task runner", () => {
  it("DTO 不会泄露神谕、世界书或模型原始输出", () => {
    const dto = toGenesisTaskDto({
      ...task(),
      decree: "秘密神谕",
      lorebook: { secret: true },
      rawOutput: "模型原文",
    } as never);

    expect(dto).toEqual({
      id: "task-1",
      status: "running",
      stage: "gods",
      completedKeys: ["worldName", "cosmology", "fusionAxiom"],
      error: null,
      worldId: null,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:10.000Z",
    });
    expect(dto).not.toHaveProperty("rawOutput");
    expect(dto).not.toHaveProperty("decree");
  });

  it("长时间修补期间只由当前 lease token 续租并刷新心跳", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const db = { genesisTask: { updateMany } };

    await expect(renewGenesisLease(db, "task-1", "lease-current", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBe(true);
    await expect(renewGenesisLease(db, "task-1", "lease-stale", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1", leaseToken: "lease-current", status: { in: ["running", "repairing"] } },
      data: { leaseExpiresAt: new Date("2026-07-21T00:01:00.000Z") },
    }));
  });

  it("只有 queued 或租约过期的运行任务能被原子认领", async () => {
    const db = {
      genesisTask: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(task({ decree: "神谕", lorebook: null })),
      },
    };

    await expect(claimGenesisTask(db, "task-1", new Date("2026-07-21T00:00:00Z")))
      .resolves.toMatchObject({ id: "task-1" });
    await expect(claimGenesisTask(db, "task-1", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBeNull();

    expect(db.genesisTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "task-1",
        userId: "local",
        OR: expect.arrayContaining([
          { status: "queued" },
          expect.objectContaining({ status: { in: ["running", "repairing"] } }),
        ]),
      }),
      data: expect.objectContaining({ status: "running" }),
    }));
  });
});
