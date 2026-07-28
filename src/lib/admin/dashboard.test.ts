import { describe, expect, it } from "vitest";
import { loadAdminDashboard } from "./dashboard";

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
});
