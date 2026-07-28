import { describe, expect, it } from "vitest";
import { buildDailySeries, clusterAdminErrors, comparePeriods, percentile } from "./analytics";

describe("admin analytics", () => {
  it("calculates period-over-period change with a stable zero baseline", () => {
    expect(comparePeriods(120, 100)).toEqual({ current: 120, previous: 100, delta: 20, changeRate: 0.2 });
    expect(comparePeriods(4, 0)).toEqual({ current: 4, previous: 0, delta: 4, changeRate: null });
  });

  it("calculates nearest-rank latency percentiles", () => {
    const values = [100, 200, 300, 400, 1000];
    expect(percentile(values, 0.5)).toBe(300);
    expect(percentile(values, 0.95)).toBe(1000);
    expect(percentile([], 0.99)).toBe(0);
  });

  it("fills missing dates and sums a numeric daily series", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    expect(buildDailySeries([
      { occurredAt: new Date("2026-07-26T02:00:00.000Z"), value: 2 },
      { occurredAt: new Date("2026-07-26T18:00:00.000Z"), value: 3 },
    ], now, 3)).toEqual([
      { date: "2026-07-26", value: 5 },
      { date: "2026-07-27", value: 0 },
      { date: "2026-07-28", value: 0 },
    ]);
  });

  it("clusters variable errors and reports affected users and worlds", () => {
    const clusters = clusterAdminErrors([
      { kind: "genesis", error: "Request 42 timed out after 30001ms", userId: "u1", worldId: "w1", occurredAt: new Date("2026-07-28T10:00:00.000Z") },
      { kind: "genesis", error: "Request 77 timed out after 45000ms", userId: "u2", worldId: "w1", occurredAt: new Date("2026-07-27T10:00:00.000Z") },
    ], new Date("2026-07-28T12:00:00.000Z"));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toEqual(expect.objectContaining({ kind: "genesis", occurrences: 2, affectedUsers: 2, affectedWorlds: 1, active: true }));
  });
});
