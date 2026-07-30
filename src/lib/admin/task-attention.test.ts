import { describe, expect, it } from "vitest";
import { allowedAdminTaskActions, deriveTaskAttention } from "./task-attention";

const now = new Date("2026-07-29T07:00:00.000Z");
const base = {
  kind: "genesis" as const,
  id: "genesis-1",
  status: "failed",
  stage: "pantheon",
  attempt: 1,
  leaseExpiresAt: null,
  createdAt: new Date("2026-07-29T06:40:00.000Z"),
  updatedAt: new Date("2026-07-29T06:55:00.000Z"),
  error: "上游超时",
  user: { id: "user-1", name: "林舟", email: "lin@example.com" },
  world: { id: "world-1", name: "雾港纪元" },
};

describe("deriveTaskAttention", () => {
  it("marks a single failure medium and rerunnable", () => {
    expect(deriveTaskAttention(base, now)).toEqual(expect.objectContaining({ reason: "failed", severity: "medium", recommendation: "rerun" }));
  });

  it("marks attempt >= 3 as a high repeated failure", () => {
    expect(deriveTaskAttention({ ...base, attempt: 3 }, now)).toEqual(expect.objectContaining({ reason: "repeated_failure", severity: "high" }));
  });

  it("marks a lease expired for ten minutes as high", () => {
    expect(deriveTaskAttention({ ...base, status: "running", attempt: 1, leaseExpiresAt: new Date("2026-07-29T06:49:59.000Z") }, now)).toEqual(expect.objectContaining({ reason: "stale", severity: "high", recommendation: "recover" }));
  });

  it("does not offer retry or recover for narrative failures", () => {
    const narrative = { ...base, kind: "narrative" as const, status: "failed" };
    expect(deriveTaskAttention(narrative, now)?.recommendation).toBe("inspect");
    expect(allowedAdminTaskActions(narrative, now)).toEqual([]);
  });
});

describe("allowedAdminTaskActions capability matrix", () => {
  function snapshot(kind: "genesis" | "narrative" | "rewrite", status: string, leaseExpiresAt: Date | null = null) {
    return { ...base, kind, status, leaseExpiresAt };
  }

  it.each([
    ["genesis queued", snapshot("genesis", "queued"), ["cancel"]],
    ["genesis stale queued", snapshot("genesis", "queued", new Date("2026-07-29T06:00:00.000Z")), ["cancel"]],
    ["genesis running", snapshot("genesis", "running"), ["cancel"]],
    ["genesis stale running", snapshot("genesis", "running", new Date("2026-07-29T06:00:00.000Z")), ["recover", "cancel"]],
    ["genesis stale repairing", snapshot("genesis", "repairing", new Date("2026-07-29T06:00:00.000Z")), ["recover", "cancel"]],
    ["genesis failed", snapshot("genesis", "failed"), ["retry"]],
    ["genesis failed with an expired residual lease", snapshot("genesis", "failed", new Date("2026-07-29T06:00:00.000Z")), ["retry"]],
    ["genesis cancelled", snapshot("genesis", "cancelled"), []],
    ["genesis completed", snapshot("genesis", "completed"), []],
    ["narrative pending", snapshot("narrative", "pending"), ["cancel"]],
    ["narrative stale pending", snapshot("narrative", "pending", new Date("2026-07-29T06:00:00.000Z")), ["cancel"]],
    ["narrative failed", snapshot("narrative", "failed"), []],
    ["narrative cancelled", snapshot("narrative", "cancelled"), []],
    ["narrative completed", snapshot("narrative", "completed"), []],
    ["rewrite planning", snapshot("rewrite", "planning"), ["cancel"]],
    ["rewrite stale planning", snapshot("rewrite", "planning", new Date("2026-07-29T06:00:00.000Z")), ["recover", "cancel"]],
    ["rewrite applying", snapshot("rewrite", "applying"), ["cancel"]],
    ["rewrite stale applying", snapshot("rewrite", "applying", new Date("2026-07-29T06:00:00.000Z")), ["recover", "cancel"]],
    ["rewrite narrating", snapshot("rewrite", "narrating"), ["cancel"]],
    ["rewrite stale narrating", snapshot("rewrite", "narrating", new Date("2026-07-29T06:00:00.000Z")), ["recover", "cancel"]],
    ["rewrite failed", snapshot("rewrite", "failed"), ["retry"]],
    ["rewrite failed with an expired residual lease", snapshot("rewrite", "failed", new Date("2026-07-29T06:00:00.000Z")), ["retry"]],
    ["rewrite cancelled with an expired residual lease", snapshot("rewrite", "cancelled", new Date("2026-07-29T06:00:00.000Z")), []],
    ["rewrite completed with an expired residual lease", snapshot("rewrite", "completed", new Date("2026-07-29T06:00:00.000Z")), []],
  ] as const)("allows only %s actions", (_label, task, expected) => {
    expect(allowedAdminTaskActions(task, now)).toEqual(expected);
  });
});
