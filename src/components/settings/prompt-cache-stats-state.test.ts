import { describe, expect, it } from "vitest";
import {
  formatCacheRate,
  formatExpectedHits,
  roundLabel,
  summarizeCacheAvailability,
} from "./prompt-cache-stats-state";

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

  it("summarizes expected-vs-actual hits with an achievement rate", () => {
    expect(formatExpectedHits({
      expectedCalls: 4, hitCalls: 2, missedCalls: 1, unknownCalls: 1, rate: 2 / 3,
    })).toBe("应命中 4 次 · 实际命中 2 次 · 未命中 1 次 · 应命中达成率 67% · 1 次无用量不可判定");
    expect(formatExpectedHits({
      expectedCalls: 0, hitCalls: 0, missedCalls: 0, unknownCalls: 0, rate: null,
    })).toContain("尚无同前缀");
  });

  it("labels continuation rounds but stays silent for the first round and legacy rows", () => {
    expect(roundLabel(null)).toBe("");
    expect(roundLabel(0)).toBe("");
    expect(roundLabel(2)).toBe("第3轮");
  });
});
