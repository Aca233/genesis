import { describe, expect, it } from "vitest";
import { aggregateCacheCalls } from "./cache-stats";

describe("cache stats", () => {
  it("excludes unavailable usage from hit-rate denominator", () => {
    const aggregate = aggregateCacheCalls([
      { inputTokens: 10000, outputTokens: 500, cacheReadTokens: 7000, cacheWriteTokens: null, cacheFallback: false },
      { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cacheFallback: true },
    ]);
    expect(aggregate).toMatchObject({
      calls: 2,
      callsWithUsage: 1,
      inputTokens: 10000,
      cacheReadTokens: 7000,
      cacheWriteTokens: null,
      hitRate: 0.7,
      fallbackCalls: 1,
    });
  });

  it("returns null hit rate instead of zero when usage is unavailable", () => {
    expect(aggregateCacheCalls([{ inputTokens: null, cacheReadTokens: null }]).hitRate).toBeNull();
  });

  it("only includes complete positive rows in hit-rate arithmetic", () => {
    expect(aggregateCacheCalls([
      { inputTokens: 100, cacheReadTokens: 25 },
      { inputTokens: 0, cacheReadTokens: 0 },
      { inputTokens: 50, cacheReadTokens: null },
    ]).hitRate).toBe(0.25);
  });
});
