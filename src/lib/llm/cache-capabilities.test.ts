import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOWNGRADE_RETRY_AFTER_MS,
  cacheCapabilities,
  cacheCapabilitySnapshot,
  clearCacheCapabilitiesForTests,
  downgradeCacheCapability,
} from "./cache-capabilities";

describe("endpoint cache capabilities", () => {
  beforeEach(clearCacheCapabilitiesForTests);
  afterEach(() => vi.useRealTimers());

  it("downgrades usage independently before disabling cache keys", () => {
    const endpoint = "openai-compatible:https://models.test/v1:test-model";
    expect(cacheCapabilities(endpoint)).toEqual({ cacheKey: true, usageStream: true, cacheControl: true });
    downgradeCacheCapability(endpoint, "usageStream");
    expect(cacheCapabilities(endpoint)).toMatchObject({ cacheKey: true, usageStream: false });
    downgradeCacheCapability(endpoint, "cacheKey");
    expect(cacheCapabilities(endpoint)).toMatchObject({ cacheKey: false, usageStream: false });
  });

  it("returns a copy that callers cannot mutate", () => {
    const capabilities = cacheCapabilities("endpoint");
    capabilities.cacheKey = false;
    expect(cacheCapabilities("endpoint").cacheKey).toBe(true);
  });

  it("降级满时限后自愈重试原始形态,再次失败则重置计时", () => {
    vi.useFakeTimers();
    const endpoint = "relay";
    downgradeCacheCapability(endpoint, "cacheKey", "HTTP 400: unknown parameter prompt_cache_key");
    expect(cacheCapabilities(endpoint).cacheKey).toBe(false);

    vi.advanceTimersByTime(DOWNGRADE_RETRY_AFTER_MS - 1000);
    expect(cacheCapabilities(endpoint).cacheKey).toBe(false);

    vi.advanceTimersByTime(2000);
    // 到期放行一次原始形态;若上游仍拒绝,适配器会重新降级
    expect(cacheCapabilities(endpoint).cacheKey).toBe(true);
    expect(cacheCapabilitySnapshot(endpoint)).toBeNull();

    downgradeCacheCapability(endpoint, "cacheKey", "HTTP 400: again");
    vi.advanceTimersByTime(DOWNGRADE_RETRY_AFTER_MS - 1000);
    expect(cacheCapabilities(endpoint).cacheKey).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(cacheCapabilities(endpoint).cacheKey).toBe(true);
  });

  it("快照记录降级能力位与最近一次降级原因,且不触发自愈", () => {
    vi.useFakeTimers();
    const endpoint = "relay";
    expect(cacheCapabilitySnapshot(endpoint)).toBeNull();
    downgradeCacheCapability(endpoint, "usageStream", "HTTP 400: unknown parameter: stream_options");
    downgradeCacheCapability(endpoint, "cacheControl", "HTTP 422: extra inputs are not permitted: cache_control");
    const snapshot = cacheCapabilitySnapshot(endpoint);
    expect(snapshot).toContain("usageStream:off");
    expect(snapshot).toContain("stream_options");
    expect(snapshot).toContain("cacheControl:off");
    expect(snapshot).toContain("cache_control");
    expect(snapshot).not.toContain("cacheKey");

    // 快照只读:即便超过自愈时限,读取快照不应清除降级状态(如实记录调用运行时的形态)
    vi.advanceTimersByTime(DOWNGRADE_RETRY_AFTER_MS + 1000);
    expect(cacheCapabilitySnapshot(endpoint)).toContain("usageStream:off");
    // 构造请求的读取路径才触发自愈
    expect(cacheCapabilities(endpoint).usageStream).toBe(true);
    expect(cacheCapabilitySnapshot(endpoint)).toBeNull();
  });
});
