import { describe, expect, it } from "vitest";
import { formatCacheRate, summarizeCacheAvailability } from "./prompt-cache-stats-state";

describe("prompt cache stats presentation", () => {
  it("distinguishes unavailable usage from a real zero hit", () => {
    expect(formatCacheRate(null)).toBe("端点未返回用量");
    expect(formatCacheRate(0)).toBe("0.0%");
    expect(formatCacheRate(0.725)).toBe("72.5%");
  });

  it("surfaces compatibility fallback without claiming cache failure", () => {
    expect(summarizeCacheAvailability({ fallbackCalls: 3, callsWithUsage: 0, calls: 5 }))
      .toContain("自动兼容回退 3 次");
  });
});
