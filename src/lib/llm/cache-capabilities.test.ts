import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheCapabilities,
  clearCacheCapabilitiesForTests,
  downgradeCacheCapability,
} from "./cache-capabilities";

describe("endpoint cache capabilities", () => {
  beforeEach(clearCacheCapabilitiesForTests);

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
});
