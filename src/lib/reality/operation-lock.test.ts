import { describe, expect, it } from "vitest";
import {
  OPERATION_LEASE_MS,
  WorldOperationConflictError,
  assertNoLiveWorldOperation,
  claimWorldOperation,
  releaseWorldOperation,
  renewWorldOperation,
  assertWorldOperationOwner,
  type WorldOperationKind,
} from "./operation-lock";

type LeaseState = {
  id: string;
  operationKind: WorldOperationKind | null;
  operationToken: string | null;
  operationLeaseExpiresAt: Date | null;
};

function matches(value: LeaseState, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Record<string, unknown>[]).some((item) => matches(value, item));
    const actual = value[key as keyof LeaseState];
    if (expected && typeof expected === "object" && "lte" in expected) {
      return actual instanceof Date && actual <= (expected as { lte: Date }).lte;
    }
    if (expected && typeof expected === "object" && "gt" in expected) {
      return actual instanceof Date && actual > (expected as { gt: Date }).gt;
    }
    return actual === expected;
  });
}

function database(initial?: Partial<LeaseState>) {
  const state: LeaseState = {
    id: "w1",
    operationKind: null,
    operationToken: null,
    operationLeaseExpiresAt: null,
    ...initial,
  };
  return {
    state,
    db: {
      world: {
        async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<LeaseState> }) {
          if (!matches(state, where)) return { count: 0 };
          Object.assign(state, data);
          return { count: 1 };
        },
        async findUnique() {
          return { ...state };
        },
      },
    },
  };
}

const now = new Date("2026-07-22T00:00:00.000Z");

describe("world operation lease", () => {
  it("claims an empty lease for five minutes and renews only the matching token", async () => {
    const { db, state } = database();

    await expect(claimWorldOperation(db, "w1", "rewrite", "r1", now)).resolves.toEqual({ acquired: true });
    expect(state).toMatchObject({
      operationKind: "rewrite",
      operationToken: "r1",
      operationLeaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS),
    });
    await expect(renewWorldOperation(db, "w1", "rewrite", "wrong", now)).resolves.toBe(false);
    await expect(renewWorldOperation(db, "w1", "rewrite", "r1", new Date(now.getTime() + 1_000))).resolves.toBe(true);
    expect(state.operationLeaseExpiresAt).toEqual(new Date(now.getTime() + 1_000 + OPERATION_LEASE_MS));
  });

  it.each<WorldOperationKind>(["chat", "settlement", "rewrite", "switch"])(
    "reports a live %s lease as the active conflict without exposing its token",
    async (kind) => {
      const { db } = database({
        operationKind: kind,
        operationToken: "secret-token",
        operationLeaseExpiresAt: new Date(now.getTime() + 10_000),
      });

      await expect(claimWorldOperation(db, "w1", "chat", "g1", now)).resolves.toEqual({
        acquired: false,
        activeKind: kind,
      });
      await expect(assertNoLiveWorldOperation(db, "w1", now)).rejects.toMatchObject({
        name: "WorldOperationConflictError",
        activeKind: kind,
      });
      await expect(assertNoLiveWorldOperation(db, "w1", now)).rejects.not.toHaveProperty("token");
    },
  );

  it("allows the same kind and token to renew through claim, but blocks every other operation", async () => {
    const { db } = database({
      operationKind: "chat",
      operationToken: "g1",
      operationLeaseExpiresAt: new Date(now.getTime() + 10_000),
    });

    await expect(claimWorldOperation(db, "w1", "chat", "g1", now)).resolves.toEqual({ acquired: true });
    await expect(claimWorldOperation(db, "w1", "settlement", "s1", now)).resolves.toEqual({
      acquired: false,
      activeKind: "chat",
    });
  });

  it("takes over an expired lease and treats expiry at now as expired", async () => {
    const { db, state } = database({
      operationKind: "rewrite",
      operationToken: "old",
      operationLeaseExpiresAt: now,
    });

    await expect(claimWorldOperation(db, "w1", "chat", "g1", now)).resolves.toEqual({ acquired: true });
    expect(state).toMatchObject({ operationKind: "chat", operationToken: "g1" });
    await expect(assertNoLiveWorldOperation(db, "w1", new Date(now.getTime() + OPERATION_LEASE_MS))).resolves.toBeUndefined();
  });

  it("retries CAS when the conflicting owner releases before the conflict read", async () => {
    const { db, state } = database();
    const originalUpdate = db.world.updateMany;
    let attempts = 0;
    db.world.updateMany = async (args) => {
      attempts += 1;
      if (attempts === 1) return { count: 0 };
      return originalUpdate(args);
    };

    await expect(claimWorldOperation(db, "w1", "chat", "g1", now)).resolves.toEqual({ acquired: true });
    expect(attempts).toBe(2);
    expect(state).toMatchObject({ operationKind: "chat", operationToken: "g1" });
  });

  it("asserts ownership only for the matching live token", async () => {
    const { db } = database({
      operationKind: "settlement",
      operationToken: "s1",
      operationLeaseExpiresAt: new Date(now.getTime() + 10_000),
    });

    await expect(assertWorldOperationOwner(db, "w1", "settlement", "s1", now)).resolves.toBeUndefined();
    await expect(assertWorldOperationOwner(db, "w1", "settlement", "wrong", now)).rejects.toThrow("世界操作租约已失效");
    await expect(assertWorldOperationOwner(db, "w1", "settlement", "s1", new Date(now.getTime() + 10_000))).rejects.toThrow("世界操作租约已失效");
  });

  it("wrong-token release is a no-op and matching release clears every lease field", async () => {
    const { db, state } = database({
      operationKind: "settlement",
      operationToken: "s1",
      operationLeaseExpiresAt: new Date(now.getTime() + 10_000),
    });

    await expect(releaseWorldOperation(db, "w1", "settlement", "wrong")).resolves.toBe(false);
    expect(state.operationToken).toBe("s1");
    await expect(releaseWorldOperation(db, "w1", "settlement", "s1")).resolves.toBe(true);
    expect(state).toMatchObject({
      operationKind: null,
      operationToken: null,
      operationLeaseExpiresAt: null,
    });
  });

  it("uses a Chinese active-kind message for conflicts", () => {
    expect(new WorldOperationConflictError("rewrite").message).toContain("现实改写");
  });
});
