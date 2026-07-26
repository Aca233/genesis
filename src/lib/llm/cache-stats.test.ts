import { describe, expect, it } from "vitest";
import { aggregateCacheCalls, computeExpectedHits } from "./cache-stats";

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

describe("expected-vs-actual cache hits", () => {
  const base = Date.parse("2026-07-27T00:10:00Z");
  const at = (secondsAgo: number) => new Date(base - secondsAgo * 1000);

  it("treats same-hash calls inside the window as expected and classifies hit/miss/unknown", () => {
    expect(computeExpectedHits([
      { stablePrefixHash: "genesis:a", createdAt: at(300), cacheReadTokens: 0 },
      { stablePrefixHash: "genesis:a", createdAt: at(200), cacheReadTokens: 5000 },
      { stablePrefixHash: "genesis:a", createdAt: at(100), cacheReadTokens: 0 },
      { stablePrefixHash: "genesis:a", createdAt: at(0), cacheReadTokens: null },
    ])).toEqual({
      expectedCalls: 3,
      hitCalls: 1,
      missedCalls: 1,
      unknownCalls: 1,
      rate: 0.5,
    });
  });

  it("expects nothing across the window boundary, distinct hashes, missing hashes or failures", () => {
    expect(computeExpectedHits([
      { stablePrefixHash: "genesis:a", createdAt: at(1000), cacheReadTokens: 0 },
      // 距同 hash 上一次调用 1000s > 5 分钟窗口:缓存可能已过期,不算应命中
      { stablePrefixHash: "genesis:a", createdAt: at(0), cacheReadTokens: 0 },
      { stablePrefixHash: "genesis:b", createdAt: at(30), cacheReadTokens: 0 },
      { stablePrefixHash: null, createdAt: at(20), cacheReadTokens: 0 },
      { stablePrefixHash: "genesis:c", createdAt: at(10), cacheReadTokens: 0, ok: false },
      // 前一条同 hash 调用失败被剔除,本条视为首个
      { stablePrefixHash: "genesis:c", createdAt: at(5), cacheReadTokens: 0 },
    ])).toMatchObject({ expectedCalls: 0, hitCalls: 0, missedCalls: 0, rate: null });
  });
});
