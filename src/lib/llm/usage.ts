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
  // 兼容中转站在 OpenAI envelope 里透传的异构缓存字段:
  // - anthropic 风格顶层 cache_read_input_tokens / cache_creation_input_tokens(实测常见)
  // - DeepSeek 风格顶层 prompt_cache_hit_tokens
  // details.cached_tokens 为 0 时可能是中转站的死字段占位,此时也看顶层兜底;
  // 顶层同样缺失才保留 0/null 原值,以免把"真未命中"误报成"无用量"。
  const cachedDetail = token(details.cached_tokens);
  const cacheReadTokens = cachedDetail !== null && cachedDetail > 0
    ? cachedDetail
    : token(value.prompt_cache_hit_tokens)
      ?? token(value.cache_read_input_tokens)
      ?? cachedDetail;
  return {
    inputTokens: token(value.prompt_tokens),
    outputTokens: token(value.completion_tokens),
    cacheReadTokens,
    cacheWriteTokens: token(value.cache_creation_input_tokens),
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
