import type { NormalizedUsage } from "./types";

function token(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

export function emptyUsage(): NormalizedUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };
}

export function normalizeOpenAiUsage(raw: unknown): NormalizedUsage {
  const value = record(raw);
  const details = record(value.prompt_tokens_details);
  return {
    inputTokens: token(value.prompt_tokens),
    outputTokens: token(value.completion_tokens),
    cacheReadTokens: token(details.cached_tokens),
    cacheWriteTokens: null,
  };
}

export function normalizeAnthropicUsage(raw: unknown): NormalizedUsage {
  const value = record(raw);
  const uncached = token(value.input_tokens);
  const read = token(value.cache_read_input_tokens);
  const write = token(value.cache_creation_input_tokens);
  const components = [uncached, read, write].filter(
    (item): item is number => item !== null,
  );
  const sum = components.reduce((total, item) => total + item, 0);
  return {
    inputTokens: components.length > 0 && Number.isSafeInteger(sum) ? sum : null,
    outputTokens: token(value.output_tokens),
    cacheReadTokens: read,
    cacheWriteTokens: write,
  };
}

export function normalizeGeminiUsage(raw: unknown): NormalizedUsage {
  const value = record(raw);
  return {
    inputTokens: token(value.promptTokenCount),
    outputTokens: token(value.candidatesTokenCount),
    cacheReadTokens: token(value.cachedContentTokenCount),
    cacheWriteTokens: null,
  };
}
