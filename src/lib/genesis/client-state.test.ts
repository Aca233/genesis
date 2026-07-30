import { describe, expect, it } from "vitest";
import { acceptTaskSnapshot } from "./client-state";

const task = (stage: string, updatedAt: string) => ({ stage, updatedAt });

describe("acceptTaskSnapshot", () => {
  it("拒绝迟到的 GET 快照覆盖较新的 SSE 状态", () => {
    expect(acceptTaskSnapshot(
      task("characters", "2026-07-21T00:00:02.000Z"),
      task("gods", "2026-07-21T00:00:01.000Z"),
    )).toBe(false);
  });

  it("接受相同时间戳但阶段更靠后的快照", () => {
    expect(acceptTaskSnapshot(
      task("gods", "2026-07-21T00:00:01.000Z"),
      task("characters", "2026-07-21T00:00:01.000Z"),
    )).toBe(true);
  });

  it("优先使用单调 aggregateVersion，拒绝重复或乱序事件回退", () => {
    const current = { ...task("characters", "2026-07-21T00:00:02.000Z"), aggregateVersion: 8 };
    expect(acceptTaskSnapshot(current, {
      ...task("completed", "2026-07-21T00:00:03.000Z"),
      aggregateVersion: 7,
    })).toBe(false);
    expect(acceptTaskSnapshot(current, {
      ...task("conflict", "2026-07-21T00:00:03.000Z"),
      aggregateVersion: 9,
    })).toBe(true);
  });
});
