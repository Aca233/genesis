import { createHash } from "node:crypto";
import type { CompletionRequest, ModelSlot } from "./types";

export const MIN_ACTIVE_CACHE_CHARS = 4000;

export type PromptCachePlan = {
  enabled: boolean;
  key: string | null;
  breakpoints: number[];
  stablePrefixEnd: number;
};

const CACHEABLE_TASKS = new Set(["genesis", "narrative", "settlement", "reroll"]);

export function normalizedEndpointKey(slot: ModelSlot): string {
  return `${slot.provider}:${slot.baseUrl.replace(/\/+$/, "")}:${slot.model}`;
}

export function buildPromptCachePlan(
  slot: ModelSlot,
  req: CompletionRequest,
): PromptCachePlan {
  let stablePrefixEnd = -1;
  let stableChars = 0;
  let lastGlobal = -1;
  let lastWorld = -1;

  for (let index = 0; index < req.messages.length; index += 1) {
    const message = req.messages[index];
    if (!message || message.cacheScope === undefined || message.cacheScope === "dynamic") break;
    stablePrefixEnd = index;
    stableChars += message.content.length;
    if (message.cacheScope === "global") lastGlobal = index;
    if (message.cacheScope === "world") lastWorld = index;
  }

  const breakpoints = [...new Set([lastGlobal, lastWorld].filter((index) => index >= 0))]
    .sort((left, right) => left - right);
  const eligible = Boolean(req.cache)
    && CACHEABLE_TASKS.has(req.task)
    && stableChars >= MIN_ACTIVE_CACHE_CHARS
    && stablePrefixEnd >= 0;

  if (!eligible || !req.cache) {
    return { enabled: false, key: null, breakpoints, stablePrefixEnd };
  }

  const digest = createHash("sha256")
    .update(JSON.stringify({
      provider: slot.provider,
      baseUrl: slot.baseUrl.replace(/\/+$/, ""),
      model: slot.model,
      namespace: req.cache.namespace,
      stableMessages: req.messages
        .slice(0, stablePrefixEnd + 1)
        .map(({ role, content }) => ({ role, content })),
    }))
    .digest("hex")
    .slice(0, 64);

  return {
    enabled: true,
    key: `genesis:${digest}`,
    breakpoints,
    stablePrefixEnd,
  };
}

export function isCacheCompatibilityError(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const mentionsExtension = /prompt_cache_key|stream_options|cache_control|system(?:\s+must\s+be\s+(?:a\s+)?string|\s+array)/i.test(body);
  const rejectsField = /unknown|unsupported|unrecognized|unexpected|invalid\s+(?:parameter|field)|extra(?:_forbidden|\s+inputs?)|not\s+permitted|must\s+be/i.test(body);
  return mentionsExtension && rejectsField;
}
