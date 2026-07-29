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