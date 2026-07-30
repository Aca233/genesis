import { describe, expect, it, vi } from "vitest";
import type { RealityRewrite, Prisma } from "@prisma/client";
import { RewritePlanSchema, type RewritePlan } from "./schemas";
import {
  REWRITE_LEASE_MS,
  claimRealityRewriteTask,
  createRealityRewrite,
  createRealityRewriteRunnerScheduler,
  remapRewritePlanForClone,
  rewriteDurableProgress,
  retryRealityRewrite,
  rewriteStage,
  rewriteStages,
  sanitizeRewriteError,
  toRealityRewriteDto,
  RealityRewriteConflictError,
  RealityRewriteForbiddenError,
} from "./task-runner";

function plan(overrides: Partial<RewritePlan> = {}): RewritePlan {
  return RewritePlanSchema.parse({
    scope: "prospective",
    interpretation: "群星依照敕令改道",
    effectivePoint: "此刻",
    branchName: "群星改道新纪",
    realityCardPatches: [],
    godPatches: [],
    entityPatches: [],
    abilityPatches: [],
    chroniclePatches: [],
    memoryPatches: [],
    omenPatches: [],
    observerPatch: null,
    causalConsequences: ["新星升起"],
    narrationFocus: "众生第一次看见新星",
    subcommands: [{ decree: "群星改道", scope: "prospective", effectivePoint: "此刻" }],
    ...overrides,
  });
}

function task(overrides: Partial<RealityRewrite> = {}): RealityRewrite {
  return {
    id: "rewrite-1",
    worldId: "world-1",
    sourceTimelineId: "timeline-1",
    resultTimelineId: null,
    sourceChapterId: "chapter-1",
    decree: "群星改道",
    scope: "prospective",
    status: "planning",
    plan: null,
    summary: null,
    idempotencyKey: "idem-key-1",
    leaseToken: null,
    leaseExpiresAt: null,
    error: null,
    createdAt: new Date("2026-07-22T00:00:00Z"),
    updatedAt: new Date("2026-07-22T00:00:01Z"),
    ...overrides,
  };
}

describe("reality rewrite public state", () => {
  it("sanitizes DTOs and never serializes semantic plans or lease/idempotency tokens", () => {
    const rewritePlan = plan();
    const dto = toRealityRewriteDto(task({
      plan: rewritePlan as unknown as Prisma.JsonValue,
      leaseToken: "lease-secret",
      error: "provider sk-supersecret123 leaseToken=hidden-token",
    }));

    expect(dto).toMatchObject({
      id: "rewrite-1",
      interpretation: rewritePlan.interpretation,
      branchName: rewritePlan.branchName,
      error: "provider [已隐藏密钥] [已隐藏租约]",
    });
    expect(dto).not.toHaveProperty("plan");
    expect(dto).not.toHaveProperty("leaseToken");
    expect(dto).not.toHaveProperty("idempotencyKey");
    expect(sanitizeRewriteError("AIza1234567890 operationToken=abc")).not.toContain("abc");
  });

  it("reports every required SSE stage, including branching before applying", () => {
    expect(rewriteStage({ status: "applying", resultTimelineId: null })).toBe("branching");
    expect(rewriteStages({ status: "applying", resultTimelineId: null })).toEqual(["branching", "applying"]);
    expect(rewriteStages({ status: "planning", resultTimelineId: null })).toEqual(["planning"]);
    expect(rewriteStages({ status: "narrating", resultTimelineId: "child" })).toEqual(["narrating"]);
    expect(rewriteStages({ status: "completed", resultTimelineId: "child" })).toEqual(["completed"]);
  });

  it.each([
    ["planning", null, null, "intent_ready"],
    ["planning", plan(), null, "planned"],
    ["applying", plan(), null, "branching"],
    ["applying", plan(), "child", "applying"],
    ["narrating", plan(), "child", "narrating"],
    ["completed", plan(), "child", "completed"],
  ])("将 %s 持久状态映射到统一进度 %s", (status, storedPlan, resultTimelineId, stage) => {
    expect(rewriteDurableProgress(task({
      status,
      plan: storedPlan as unknown as Prisma.JsonValue,
      resultTimelineId,
    }))).toMatchObject({
      taskKind: "rewrite",
      taskId: "rewrite-1",
      stage,
    });
  });
});

describe("reality rewrite creation and leases", () => {
  it("replays the same semantic input and rejects reuse for another decree", async () => {
    const existing = task();
    const db = {
      realityRewrite: { findUnique: vi.fn().mockResolvedValue(existing) },
    };
    await expect(createRealityRewrite(db as never, {
      userId: "test-user", worldId: "world-1", decree: "群星改道", scope: "prospective", idempotencyKey: "idem-key-1",
    })).resolves.toEqual({ task: existing, replayed: true });
    await expect(createRealityRewrite(db as never, {
      userId: "test-user", worldId: "world-1", decree: "海洋升天", scope: "prospective", idempotencyKey: "idem-key-1",
    })).rejects.toBeInstanceOf(RealityRewriteConflictError);
  });

  it("checks creator mode and current chapter before creating a task", async () => {
    const makeDb = (mode: string, chapter: { id: string } | null = { id: "chapter-1" }) => ({
      realityRewrite: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        world: { findFirst: vi.fn().mockResolvedValue({ id: "world-1", mode, activeTimelineId: "timeline-1" }) },
        chapter: { findFirst: vi.fn().mockResolvedValue(chapter) },
        realityRewrite: { create: vi.fn().mockResolvedValue(task()) },
      })),
    });

    await expect(createRealityRewrite(makeDb("pantheon") as never, {
      userId: "test-user", worldId: "world-1", decree: "群星改道", scope: "prospective", idempotencyKey: "idem-key-1",
    })).rejects.toBeInstanceOf(RealityRewriteForbiddenError);
    await expect(createRealityRewrite(makeDb("creator", null) as never, {
      userId: "test-user", worldId: "world-1", decree: "群星改道", scope: "prospective", idempotencyKey: "idem-key-1",
    })).rejects.toThrow("当前记录段");
  });

  it("prevents a second live runner and reclaims an expired task lease", async () => {
    const now = new Date("2026-07-22T00:00:00Z");
    const row = task({ leaseToken: "owner", leaseExpiresAt: new Date(now.getTime() + 1_000) });
    const db = {
      realityRewrite: {
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<RealityRewrite> }) => {
          const expired = row.leaseExpiresAt === null || row.leaseExpiresAt <= now;
          if (!expired || where.id !== row.id) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
        findUnique: vi.fn(async () => ({ ...row })),
      },
    };

    await expect(claimRealityRewriteTask(db as never, row.id, now)).resolves.toBeNull();
    row.leaseExpiresAt = now;
    const claimed = await claimRealityRewriteTask(db as never, row.id, now);
    expect(claimed?.leaseToken).not.toBe("owner");
    expect(claimed?.leaseExpiresAt).toEqual(new Date(now.getTime() + REWRITE_LEASE_MS));
  });

  it("does not steal a live lease from a failed runner", async () => {
    const failed = task({
      status: "failed",
      leaseToken: "runner-a",
      leaseExpiresAt: new Date("2999-07-22T00:00:00Z"),
      error: "runner a is still cleaning up",
    });
    const updateMany = vi.fn();
    const db = { realityRewrite: { findFirst: vi.fn().mockResolvedValue(failed), updateMany } };

    await expect(retryRealityRewrite(db as never, "test-user", failed.id)).resolves.toBe(failed);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["without a lease", null, null],
    ["with an expired lease", "runner-a", new Date("2000-07-22T00:00:00Z")],
  ])("re-arms failed narration %s without discarding its existing result branch", async (_label, leaseToken, leaseExpiresAt) => {
    const failed = task({
      status: "failed",
      resultTimelineId: "child",
      plan: plan() as unknown as Prisma.JsonValue,
      leaseToken,
      leaseExpiresAt,
      error: "provider failed",
    });
    const rearmed = task({ ...failed, status: "narrating", leaseToken: null, leaseExpiresAt: null, error: null });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue(rearmed);
    const db = { realityRewrite: { findFirst: vi.fn().mockResolvedValue(failed), updateMany, findUnique } };

    const retried = await retryRealityRewrite(db as never, "test-user", failed.id);
    expect(retried).toMatchObject({ status: "narrating", resultTimelineId: "child", error: null });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: failed.id,
        status: "failed",
        leaseToken,
        leaseExpiresAt,
      }),
      data: expect.objectContaining({ status: "narrating", leaseToken: null, leaseExpiresAt: null }),
    });
  });

  it("returns the new owner after losing the retry CAS without overwriting it", async () => {
    const failed = task({
      status: "failed",
      leaseToken: "runner-a",
      leaseExpiresAt: new Date("2000-07-22T00:00:00Z"),
    });
    const newOwner = task({
      status: "narrating",
      resultTimelineId: "child",
      leaseToken: "runner-b",
      leaseExpiresAt: new Date("2999-07-22T00:00:00Z"),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(newOwner);
    const db = { realityRewrite: { findFirst: vi.fn().mockResolvedValue(failed), updateMany, findUnique } };

    await expect(retryRealityRewrite(db as never, "test-user", failed.id)).resolves.toBe(newOwner);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: failed.id } });
  });
});

describe("reality rewrite runner scheduling", () => {
  it("coalesces wakeups during an active run into one guaranteed follow-up attempt", async () => {
    let finishFirstRun!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      finishFirstRun = resolve;
    });
    const runTask = vi.fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue(undefined);
    const ensureRunning = createRealityRewriteRunnerScheduler(runTask);

    ensureRunning("rewrite-1");
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1));

    ensureRunning("rewrite-1");
    ensureRunning("rewrite-1");
    expect(runTask).toHaveBeenCalledTimes(1);

    finishFirstRun();
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(2));
    expect(runTask).toHaveBeenNthCalledWith(2, "rewrite-1");
  });
});

describe("rewrite plan clone remapping", () => {
  it("remaps every source-owned reference while preserving temp refs", () => {
    const sourcePlan = plan({
      godPatches: [{ op: "update", targetId: "god-old", changes: { relations: [{ targetRef: "god-new-temp", label: "ally", note: "同盟" }] } }],
      entityPatches: [{ op: "update", targetId: "entity-old", changes: { raceRef: "race-old" } }],
      abilityPatches: [{ op: "update", targetId: "ability-old", ownerRef: "god-old", changes: { sourceAbilityRef: "ability-source-old" } }],
      chroniclePatches: [{ op: "update", targetId: "chronicle-old", changes: { entityRefs: ["entity-old"], godRefs: ["god-old"] } }],
      memoryPatches: [{ entityId: "entity-old", operation: "append", text: "记得新星" }],
      omenPatches: [{ op: "create", tempRef: "omen-new", value: { godRef: "god-old", text: "新星升起", consumed: false } }],
      observerPatch: { focus: { focusType: "god", focusRef: "god-old" }, activeAvatarRef: "entity-old" },
    });
    const remapped = remapRewritePlanForClone(sourcePlan, {
      chapterIds: new Map(), messageIds: new Map(), abilityEventIds: new Map(),
      godIds: new Map([["god-old", "god-clone"]]),
      entityIds: new Map([["entity-old", "entity-clone"], ["race-old", "race-clone"]]),
      abilityIds: new Map([["ability-old", "ability-clone"], ["ability-source-old", "ability-source-clone"]]),
      chronicleIds: new Map([["chronicle-old", "chronicle-clone"]]),
    });

    expect(remapped.godPatches[0]).toMatchObject({ targetId: "god-clone", changes: { relations: [{ targetRef: "god-new-temp" }] } });
    expect(remapped.entityPatches[0]).toMatchObject({ targetId: "entity-clone", changes: { raceRef: "race-clone" } });
    expect(remapped.abilityPatches[0]).toMatchObject({ targetId: "ability-clone", ownerRef: "god-clone", changes: { sourceAbilityRef: "ability-source-clone" } });
    expect(remapped.chroniclePatches[0]).toMatchObject({ targetId: "chronicle-clone", changes: { entityRefs: ["entity-clone"], godRefs: ["god-clone"] } });
    expect(remapped.memoryPatches[0]?.entityId).toBe("entity-clone");
    expect(remapped.omenPatches[0]).toMatchObject({ value: { godRef: "god-clone" } });
    expect(remapped.observerPatch).toMatchObject({ focus: { focusRef: "god-clone" }, activeAvatarRef: "entity-clone" });
  });
});
