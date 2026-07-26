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
    userId: "test-user",
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
  it("sends a hashed cache key, marks cache_control breakpoints and emits streamed usage", async () => {
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
    // 稳定前缀断点（lastGlobal / lastWorld）以 content-part 数组显式携带 cache_control；
    // 文本字节不变，仅包装形式变化。
    expect(payload.messages[0]).toEqual({
      role: "system",
      content: [{ type: "text", text: "G".repeat(4100), cache_control: { type: "ephemeral" } }],
    });
    expect(payload.messages[1]).toEqual({
      role: "system",
      content: [{ type: "text", text: "WORLD", cache_control: { type: "ephemeral" } }],
    });
    expect(payload.messages[2]).toEqual({ role: "user", content: "继续" });
    expect(JSON.stringify(payload)).not.toContain("cacheScope");
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "usage",
      usage: expect.objectContaining({ cacheReadTokens: 8000 }),
      cacheRequested: true,
      cacheFallback: false,
    }));
  });

  it("keeps every message a plain string when the request is not cacheable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "完成" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await adapters["openai-compatible"].complete(openAiSlot, {
      task: "narrative",
      userId: "test-user",
      messages: [{ role: "user", content: "继续", cacheScope: "dynamic" }],
    }, "key");
    const payload = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(payload.messages).toEqual([{ role: "user", content: "继续" }]);
    expect(payload.prompt_cache_key).toBeUndefined();
  });

  it("downgrades only cache_control on content-shape rejection and reverts to plain strings", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unknown parameter: cache_control", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "完成" } }],
        usage: { prompt_tokens: 5000, completion_tokens: 20 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "再来" } }],
        usage: { prompt_tokens: 5000, completion_tokens: 20 },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await adapters["openai-compatible"].complete(openAiSlot, cacheableRequest(), "key");
    await adapters["openai-compatible"].complete(openAiSlot, cacheableRequest(), "key");

    const retry = JSON.parse(fetchMock.mock.calls[1]![1].body);
    const next = JSON.parse(fetchMock.mock.calls[2]![1].body);
    for (const payload of [retry, next]) {
      expect(payload.messages.every(
        (message: { content: unknown }) => typeof message.content === "string",
      )).toBe(true);
      // prompt_cache_key 双发保留：只降级被拒的 cache_control 能力位
      expect(payload.prompt_cache_key).toMatch(/^genesis:[a-f0-9]{64}$/);
    }
    expect(first).toMatchObject({ text: "完成", cacheRequested: true, cacheFallback: true });
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
    // cache_control 断点未被拒,重试仍在请求缓存:cacheRequested 保持 true
    expect(result).toMatchObject({ text: "完成", cacheRequested: true, cacheFallback: true });

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

  it("续写接力断点以 cache_control 内容块透传且缓存键不变", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "后半" } }],
      usage: { prompt_tokens: 6000, completion_tokens: 10 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const base = cacheableRequest();
    const continuation: CompletionRequest = {
      ...base,
      messages: [
        ...base.messages.map((message, index) =>
          (index === base.messages.length - 1 ? { ...message, prefixStable: true } : message)),
        { role: "assistant", content: "已产出的前半部分", prefixStable: true },
        { role: "user", content: "从断点继续" },
      ],
    };
    await adapters["openai-compatible"].complete(openAiSlot, continuation, "key");
    const payload = JSON.parse(fetchMock.mock.calls[0]![1].body);
    // 稳定前缀未变,prompt_cache_key 与原请求一致
    expect(payload.prompt_cache_key).toMatch(/^genesis:[a-f0-9]{64}$/);
    const marked = payload.messages
      .map((message: { content: unknown }, index: number) =>
        (Array.isArray(message.content) ? index : -1))
      .filter((index: number) => index >= 0);
    // 系统块断点(0,1) + 续写断点(原请求末条 user=2、assistant partial=3)
    expect(marked).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(payload)).not.toContain("prefixStable");
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

  it("续写接力:在原请求末条 user 与回填 assistant partial 上放 messages 内断点", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: "后半" }],
      usage: {},
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const base = cacheableRequest();
    const continuation: CompletionRequest = {
      ...base,
      messages: [
        ...base.messages.map((message, index) =>
          (index === base.messages.length - 1 ? { ...message, prefixStable: true } : message)),
        { role: "assistant", content: "已产出的前半部分", prefixStable: true },
        { role: "user", content: "从断点继续" },
      ],
    };
    await adapters.anthropic.complete(anthropicSlot, continuation, "key");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const markedMessages = body.messages.filter(
      (message: { content: unknown }) => Array.isArray(message.content));
    expect(markedMessages.map((message: { role: string }) => message.role))
      .toEqual(["user", "assistant"]);
    for (const message of markedMessages) {
      expect(message.content).toHaveLength(1);
      expect(message.content[0].cache_control).toEqual({ type: "ephemeral" });
    }
    // 系统块断点 + messages 内断点合计不超过 Anthropic 上限 4
    const systemBreakpoints = body.system.filter(
      (block: { cache_control?: unknown }) => block.cache_control).length;
    expect(systemBreakpoints + markedMessages.length).toBeLessThanOrEqual(4);
    // 末条续写提示保持原始字符串形态;内部标记不外漏
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "从断点继续" });
    expect(JSON.stringify(body)).not.toContain("prefixStable");
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
