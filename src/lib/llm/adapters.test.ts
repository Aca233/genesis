import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapters } from "./adapters";
import { clearCacheCapabilitiesForTests } from "./cache-capabilities";
import type { CompletionRequest, ModelSlot, StreamChunk } from "./types";

const openAiSlot: ModelSlot = {
  provider: "openai-compatible",
  baseUrl: "https://models.test/v1",
  model: "test-model",
};
const anthropicSlot: ModelSlot = {
  provider: "anthropic",
  baseUrl: "https://anthropic.test",
  model: "claude-test",
};
const geminiSlot: ModelSlot = {
  provider: "gemini",
  baseUrl: "https://gemini.test",
  model: "gemini-test",
};

function cacheableRequest(): CompletionRequest {
  return {
    task: "narrative",
    cache: { namespace: "narrative:world-1:v1" },
    messages: [
      { role: "system", content: "G".repeat(4100), cacheScope: "global" },
      { role: "system", content: "WORLD", cacheScope: "world" },
      { role: "user", content: "继续", cacheScope: "dynamic" },
    ],
  };
}

async function drain(generator: AsyncGenerator<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of generator) chunks.push(chunk);
  return chunks;
}

beforeEach(clearCacheCapabilitiesForTests);
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI-compatible prompt cache", () => {
  it("sends a hashed cache key, strips internal scopes and emits streamed usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"正文"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":12000,"completion_tokens":300,"prompt_tokens_details":{"cached_tokens":8000}}}',
      "data: [DONE]",
      "",
    ].join("\n\n"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await drain(adapters["openai-compatible"].stream(
      openAiSlot, cacheableRequest(), "key",
    ));
    const payload = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(payload.prompt_cache_key).toMatch(/^genesis:[a-f0-9]{64}$/);
    expect(payload.stream_options).toEqual({ include_usage: true });
    expect(payload.messages[0]).toEqual({ role: "system", content: "G".repeat(4100) });
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "usage",
      usage: expect.objectContaining({ cacheReadTokens: 8000 }),
      cacheRequested: true,
      cacheFallback: false,
    }));
  });

  it("removes only rejected stream usage fields and remembers the downgrade", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unknown parameter: stream_options", { status: 400 }))
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"正文"}}]}\n\ndata: [DONE]\n\n', { status: 200 }))
      .mockResolvedValueOnce(new Response("data: [DONE]\n\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await drain(adapters["openai-compatible"].stream(openAiSlot, cacheableRequest(), "key"));
    await drain(adapters["openai-compatible"].stream(openAiSlot, cacheableRequest(), "key"));

    const retry = JSON.parse(fetchMock.mock.calls[1]![1].body);
    const next = JSON.parse(fetchMock.mock.calls[2]![1].body);
    expect(retry.prompt_cache_key).toBeTruthy();
    expect(retry.stream_options).toBeUndefined();
    expect(next.prompt_cache_key).toBeTruthy();
    expect(next.stream_options).toBeUndefined();
  });

  it("removes rejected cache keys once but does not retry authentication errors", async () => {
    const cacheFetch = vi.fn()
      .mockResolvedValueOnce(new Response("unknown parameter prompt_cache_key", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "完成" } }],
        usage: { prompt_tokens: 5000, completion_tokens: 20 },
      }), { status: 200 }));
    vi.stubGlobal("fetch", cacheFetch);
    const result = await adapters["openai-compatible"].complete(openAiSlot, cacheableRequest(), "key");
    expect(cacheFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(cacheFetch.mock.calls[1]![1].body).prompt_cache_key).toBeUndefined();
    expect(result).toMatchObject({ text: "完成", cacheRequested: false, cacheFallback: true });

    clearCacheCapabilitiesForTests();
    const authFetch = vi.fn().mockResolvedValue(new Response("invalid api key", { status: 401 }));
    vi.stubGlobal("fetch", authFetch);
    await expect(adapters["openai-compatible"].complete(openAiSlot, cacheableRequest(), "bad"))
      .rejects.toThrow("HTTP 401");
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("passes AbortSignal upstream and never performs compatibility fallback after abort", async () => {
    const abort = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async () => {
      abort.abort();
      return new Response("unknown parameter prompt_cache_key", { status: 400 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(drain(adapters["openai-compatible"].stream(
      openAiSlot, cacheableRequest(), "key", { signal: abort.signal },
    ))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toEqual(expect.objectContaining({ signal: abort.signal }));
  });
});

describe("Anthropic prompt cache", () => {
  it("marks at most two stable system breakpoints and normalizes usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: "完成" }],
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 7000,
        cache_creation_input_tokens: 3000,
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await adapters.anthropic.complete(anthropicSlot, cacheableRequest(), "key");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.system).toHaveLength(2);
    expect(body.system.every((block: Record<string, unknown>) =>
      JSON.stringify(block.cache_control) === JSON.stringify({ type: "ephemeral" }))).toBe(true);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "继续" });
    expect(result.usage).toMatchObject({ inputTokens: 11000, cacheReadTokens: 7000, cacheWriteTokens: 3000 });
  });

  it("removes cache_control after an explicit compatibility rejection and remembers it", async () => {
    const success = JSON.stringify({ content: [{ type: "text", text: "完成" }], usage: {} });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("extra inputs are not permitted: cache_control", { status: 400 }))
      .mockResolvedValueOnce(new Response(success, { status: 200 }))
      .mockResolvedValueOnce(new Response(success, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await adapters.anthropic.complete(anthropicSlot, cacheableRequest(), "key");
    await adapters.anthropic.complete(anthropicSlot, cacheableRequest(), "key");
    expect(first.cacheFallback).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).system).toBeTypeOf("string");
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).system).toBeTypeOf("string");
  });
});

describe("Gemini implicit cache", () => {
  it("emits implicit cache usage without creating cachedContent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"candidates":[{"content":{"parts":[{"text":"完成"}]}}]}',
      'data: {"usageMetadata":{"promptTokenCount":9000,"candidatesTokenCount":500,"cachedContentTokenCount":6000}}',
      "",
    ].join("\n\n"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const chunks = await drain(adapters.gemini.stream(geminiSlot, cacheableRequest(), "key"));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.cachedContent).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("cacheScope");
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "usage",
      usage: { inputTokens: 9000, outputTokens: 500, cacheReadTokens: 6000, cacheWriteTokens: null },
      cacheRequested: true,
      cacheFallback: false,
    }));
  });
});
