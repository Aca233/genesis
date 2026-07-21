export type CacheCapability = "cacheKey" | "usageStream" | "cacheControl";
export type EndpointCapabilities = Record<CacheCapability, boolean>;

const capabilitiesByEndpoint = new Map<string, EndpointCapabilities>();
const DEFAULT_CAPABILITIES: EndpointCapabilities = {
  cacheKey: true,
  usageStream: true,
  cacheControl: true,
};

export function cacheCapabilities(endpoint: string): EndpointCapabilities {
  return { ...(capabilitiesByEndpoint.get(endpoint) ?? DEFAULT_CAPABILITIES) };
}

export function downgradeCacheCapability(
  endpoint: string,
  capability: CacheCapability,
): void {
  const current = cacheCapabilities(endpoint);
  current[capability] = false;
  capabilitiesByEndpoint.set(endpoint, current);
}

export function clearCacheCapabilitiesForTests(): void {
  capabilitiesByEndpoint.clear();
}
