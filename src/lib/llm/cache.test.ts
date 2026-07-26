import { describe, expect, it } from "vitest";
import { buildPromptCachePlan, isCacheCompatibilityError } from "./cache";

const slot = {
  provider: "openai-compatible" as const,
  baseUrl: "https://models.test/v1/",
  model: "gpt-test",
};

describe("prompt cache planner", () => {
  it("uses only the contiguous stable prefix and ignores dynamic content in the key", () => {
    const stable = "S".repeat(4100);
    const first = buildPromptCachePlan(slot, {
      task: "narrative",
      userId: "test-user",
      cache: { namespace: "narrative:world-1:v1" },
      messages: [
        { role: "system", content: stable, cacheScope: "global" },
        { role: "system", content: "world", cacheScope: "world" },
        { role: "user", content: "player A", cacheScope: "dynamic" },
      ],
    });
    const second = buildPromptCachePlan(slot, {
      task: "narrative",
      userId: "test-user",
      cache: { namespace: "narrative:world-1:v1" },
      messages: [
        { role: "system", content: stable, cacheScope: "global" },
        { role: "system", content: "world", cacheScope: "world" },
        { role: "user", content: "player B", cacheScope: "dynamic" },
      ],
    });
    expect(first.enabled).toBe(true);
    expect(first.key).toBe(second.key);
    expect(first.breakpoints).toEqual([0, 1]);
    expect(first.key).toMatch(/^genesis:[a-f0-9]{64}$/);
    expect(first.key).not.toContain("player");
  });

  it("disables active hints for test and short requests", () => {
    expect(buildPromptCachePlan(slot, {
      task: "test", userId: "test-user", cache: { namespace: "test" },
      messages: [{ role: "system", content: "S".repeat(5000), cacheScope: "global" }],
    }).enabled).toBe(false);
    expect(buildPromptCachePlan(slot, {
      task: "genesis", userId: "test-user", cache: { namespace: "genesis:v1" },
      messages: [{ role: "system", content: "short", cacheScope: "global" }],
    }).enabled).toBe(false);
  });

  it("never resumes the stable prefix after a dynamic message", () => {
    const plan = buildPromptCachePlan(slot, {
      task: "genesis", userId: "test-user", cache: { namespace: "genesis:v1" },
      messages: [
        { role: "system", content: "stable", cacheScope: "global" },
        { role: "user", content: "dynamic", cacheScope: "dynamic" },
        { role: "system", content: "S".repeat(5000), cacheScope: "world" },
      ],
    });
    expect(plan).toMatchObject({ enabled: false, stablePrefixEnd: 0 });
  });

  it("续写接力:prefixStable 断点不改变 key,索引相对完整消息列表", () => {
    const stable = "S".repeat(4100);
    const original = buildPromptCachePlan(slot, {
      task: "genesis",
      userId: "test-user",
      cache: { namespace: "genesis:v1" },
      messages: [
        { role: "system", content: stable, cacheScope: "global" },
        { role: "system", content: "world", cacheScope: "world" },
        { role: "user", content: "create" },
      ],
    });
    const continuation = buildPromptCachePlan(slot, {
      task: "genesis",
      userId: "test-user",
      cache: { namespace: "genesis:v1" },
      messages: [
        { role: "system", content: stable, cacheScope: "global" },
        { role: "system", content: "world", cacheScope: "world" },
        { role: "user", content: "create", prefixStable: true },
        { role: "assistant", content: "已产出的前半部分", prefixStable: true },
        { role: "user", content: "continue" },
      ],
    });
    expect(continuation.enabled).toBe(true);
    // 稳定前缀未变,provider 缓存键保持一致
    expect(continuation.key).toBe(original.key);
    expect(continuation.messageBreakpoints).toEqual([2, 3]);
    expect(original.messageBreakpoints).toEqual([]);
  });

  it("续写断点超过 4 断点预算时保留最靠后的标记", () => {
    const plan = buildPromptCachePlan(slot, {
      task: "genesis",
      userId: "test-user",
      cache: { namespace: "genesis:v1" },
      messages: [
        { role: "system", content: "S".repeat(4100), cacheScope: "global" },
        { role: "system", content: "world", cacheScope: "world" },
        { role: "user", content: "a", prefixStable: true },
        { role: "assistant", content: "b", prefixStable: true },
        { role: "user", content: "c", prefixStable: true },
        { role: "assistant", content: "d", prefixStable: true },
      ],
    });
    // 系统块断点占 2 个预算,续写断点仅保留最靠后的 2 个
    expect(plan.breakpoints).toEqual([0, 1]);
    expect(plan.messageBreakpoints).toEqual([4, 5]);
  });

  it("recognizes only explicit cache extension compatibility errors", () => {
    expect(isCacheCompatibilityError(400, "unknown parameter prompt_cache_key")).toBe(true);
    expect(isCacheCompatibilityError(422, "extra_forbidden stream_options")).toBe(true);
    expect(isCacheCompatibilityError(400, "extra inputs are not permitted: cache_control")).toBe(true);
    expect(isCacheCompatibilityError(401, "invalid api key")).toBe(false);
    expect(isCacheCompatibilityError(429, "rate limited")).toBe(false);
  });
});
