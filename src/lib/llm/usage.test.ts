import { describe, expect, it } from "vitest";
import {
  normalizeAnthropicUsage,
  normalizeGeminiUsage,
  normalizeOpenAiUsage,
} from "./usage";

describe("normalized provider usage", () => {
  it("normalizes OpenAI cached prompt tokens", () => {
    expect(normalizeOpenAiUsage({
      prompt_tokens: 12000,
      completion_tokens: 900,
      prompt_tokens_details: { cached_tokens: 8000 },
    })).toEqual({
      inputTokens: 12000,
      outputTokens: 900,
      cacheReadTokens: 8000,
      cacheWriteTokens: null,
    });
  });

  it("reads anthropic-style cache fields relayed at the top of an OpenAI envelope", () => {
    expect(normalizeOpenAiUsage({
      prompt_tokens: 12000,
      completion_tokens: 900,
      cache_read_input_tokens: 7000,
      cache_creation_input_tokens: 4000,
    })).toEqual({
      inputTokens: 12000,
      outputTokens: 900,
      cacheReadTokens: 7000,
      cacheWriteTokens: 4000,
    });
  });

  it("falls back to DeepSeek prompt_cache_hit_tokens when details are absent", () => {
    expect(normalizeOpenAiUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_cache_hit_tokens: 60,
    })).toMatchObject({ cacheReadTokens: 60, cacheWriteTokens: null });
  });

  it("prefers relayed top-level cache reads over a dead-zero details stub", () => {
    expect(normalizeOpenAiUsage({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
      cache_read_input_tokens: 80,
    })).toMatchObject({ cacheReadTokens: 80 });
    // 顶层兜底也缺失时保留真实的 0(真未命中)而非误报为无用量
    expect(normalizeOpenAiUsage({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
    })).toMatchObject({ cacheReadTokens: 0 });
  });

  it("includes Anthropic cache creation and read tokens in logical input", () => {
    expect(normalizeAnthropicUsage({
      input_tokens: 1000,
      output_tokens: 300,
      cache_read_input_tokens: 7000,
      cache_creation_input_tokens: 4000,
    })).toEqual({
      inputTokens: 12000,
      outputTokens: 300,
      cacheReadTokens: 7000,
      cacheWriteTokens: 4000,
    });
  });

  it("keeps unavailable Gemini cache write tokens null", () => {
    expect(normalizeGeminiUsage({
      promptTokenCount: 5000,
      candidatesTokenCount: 450,
      cachedContentTokenCount: 3000,
    })).toEqual({
      inputTokens: 5000,
      outputTokens: 450,
      cacheReadTokens: 3000,
      cacheWriteTokens: null,
    });
  });

  it("rejects negative, fractional and unsafe token counts", () => {
    expect(normalizeOpenAiUsage({ prompt_tokens: -1 })).toMatchObject({ inputTokens: null });
    expect(normalizeGeminiUsage({ promptTokenCount: 1.5 })).toMatchObject({ inputTokens: null });
    expect(normalizeAnthropicUsage({ input_tokens: Number.MAX_SAFE_INTEGER + 1 }))
      .toMatchObject({ inputTokens: null });
  });
});
