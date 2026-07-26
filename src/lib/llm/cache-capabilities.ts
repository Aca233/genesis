export type CacheCapability = "cacheKey" | "usageStream" | "cacheControl";
export type EndpointCapabilities = Record<CacheCapability, boolean>;

/**
 * 降级自愈窗口:单次偶发 400 不应令整个进程静默放弃 prompt_cache_key /
 * include_usage / cache_control 直至重启。降级满该时限后放行一次原始形态重试;
 * 若上游再次拒绝,适配器会重新降级并重置计时。
 */
export const DOWNGRADE_RETRY_AFTER_MS = 30 * 60 * 1000;

type DowngradeRecord = { at: number; reason: string | null };

type EndpointState = {
  capabilities: EndpointCapabilities;
  downgrades: Partial<Record<CacheCapability, DowngradeRecord>>;
};

const DEFAULT_CAPABILITIES: EndpointCapabilities = {
  cacheKey: true,
  usageStream: true,
  cacheControl: true,
};

const CAPABILITY_KEYS: CacheCapability[] = ["cacheKey", "usageStream", "cacheControl"];

const stateByEndpoint = new Map<string, EndpointState>();

/** 到期的降级恢复为原始形态(自愈重试)。仅在构造请求的读取路径上触发。 */
function healExpired(state: EndpointState): void {
  const now = Date.now();
  for (const capability of CAPABILITY_KEYS) {
    const record = state.downgrades[capability];
    if (record && now - record.at >= DOWNGRADE_RETRY_AFTER_MS) {
      state.capabilities[capability] = true;
      delete state.downgrades[capability];
    }
  }
}

export function cacheCapabilities(endpoint: string): EndpointCapabilities {
  const state = stateByEndpoint.get(endpoint);
  if (!state) return { ...DEFAULT_CAPABILITIES };
  healExpired(state);
  return { ...state.capabilities };
}

export function downgradeCacheCapability(
  endpoint: string,
  capability: CacheCapability,
  reason?: string,
): void {
  const state = stateByEndpoint.get(endpoint)
    ?? { capabilities: { ...DEFAULT_CAPABILITIES }, downgrades: {} };
  state.capabilities[capability] = false;
  state.downgrades[capability] = { at: Date.now(), reason: reason?.slice(0, 200) ?? null };
  stateByEndpoint.set(endpoint, state);
}

/**
 * 端点降级快照,由网关落库到 llm_calls.cache_capability 使降级事件可见。
 * 全部能力完好时为 null。注意此处不触发自愈,以如实记录"该次调用运行时"的状态。
 */
export function cacheCapabilitySnapshot(endpoint: string): string | null {
  const state = stateByEndpoint.get(endpoint);
  if (!state) return null;
  const parts = CAPABILITY_KEYS
    .filter((capability) => !state.capabilities[capability])
    .map((capability) => {
      const record = state.downgrades[capability];
      const at = record ? new Date(record.at).toISOString() : "";
      return `${capability}:off@${at}${record?.reason ? ` ${record.reason}` : ""}`;
    });
  return parts.length ? parts.join("; ").slice(0, 500) : null;
}

export function clearCacheCapabilitiesForTests(): void {
  stateByEndpoint.clear();
}
