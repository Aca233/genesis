import type {
  AdapterCompletionResult,
  ChatMessage,
  CompletionRequest,
  ModelSlot,
  NormalizedUsage,
  PromptCacheScope,
  StreamChunk,
} from "./types";
import { buildPromptCachePlan, isCacheCompatibilityError, normalizedEndpointKey } from "./cache";
import { cacheCapabilities, downgradeCacheCapability } from "./cache-capabilities";
import {
  emptyUsage,
  normalizeAnthropicUsage,
  normalizeGeminiUsage,
  normalizeOpenAiUsage,
} from "./usage";

/** Lightweight protocol adapters for OpenAI-compatible, Anthropic and Gemini endpoints. */
export interface ProviderAdapter {
  complete(
    slot: ModelSlot,
    req: CompletionRequest,
    apiKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<AdapterCompletionResult>;
  stream(
    slot: ModelSlot,
    req: CompletionRequest,
    apiKey: string,
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<StreamChunk>;
  listModels(baseUrl: string, apiKey: string): Promise<string[]>;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

const DEFAULT_MAX_TOKENS = 8192;

async function errorBody(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).slice(0, 500);
}

function httpError(status: number, body: string): Error {
  return new Error(`HTTP ${status}: ${body}`);
}

/** 能力降级原因(F8 可观测):随降级记录进内存并由网关落库。 */
function downgradeReason(status: number, body: string): string {
  return `HTTP ${status}: ${body.slice(0, 160)}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

/** Parse SSE data payloads. Comments and malformed non-data lines are ignored. */
async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      if (data) yield data;
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data && data !== "[DONE]") yield data;
  }
}

// ───────────────────────── OpenAI compatible ─────────────────────────

const baseUrlFix = new Map<string, string>();

async function openaiFetch(
  slot: ModelSlot,
  apiKey: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const base = (baseUrlFix.get(slot.baseUrl) ?? slot.baseUrl).replace(/\/+$/, "");
  const doFetch = (targetBase: string) => fetch(`${targetBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  let response = await doFetch(base);
  if (response.status === 404 && !/\/v1$/.test(base)) {
    throwIfAborted(signal);
    const fixed = `${base}/v1`;
    const retry = await doFetch(fixed);
    if (retry.ok) {
      baseUrlFix.set(slot.baseUrl, fixed);
      return retry;
    }
    response = retry.status !== 404 ? retry : response;
  }
  return response;
}

type OpenAiAttempt = {
  response: Response;
  cacheRequested: boolean;
  cacheFallback: boolean;
};

type OpenAiTextPart = {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
};

/**
 * Strip internal cache scopes; wrap the messages at explicit cache breakpoints
 * into content-part arrays carrying anthropic-style cache_control markers.
 * Byte-identical text — only the envelope shape changes for marked messages.
 */
function openAiMessages(messages: ChatMessage[], breakpoints: ReadonlySet<number>) {
  return messages.map(
    ({ role, content }, index): { role: ChatMessage["role"]; content: string | OpenAiTextPart[] } =>
      breakpoints.has(index)
        ? {
          role,
          content: [{ type: "text", text: content, cache_control: { type: "ephemeral" } }],
        }
        : { role, content },
  );
}

function openAiPayload(
  slot: ModelSlot,
  req: CompletionRequest,
  stream: boolean,
  useCacheKey: boolean,
  useStreamUsage: boolean,
  useCacheControl: boolean,
) {
  const plan = buildPromptCachePlan(slot, req);
  // 系统块断点 + 续写接力断点(原请求末条 user + 回填 assistant partial)。
  // plan 已按 4 断点预算裁剪,二者合计不超限。
  const marked = new Set(plan.enabled && useCacheControl
    ? [...plan.breakpoints, ...plan.messageBreakpoints]
    : []);
  const cacheKeyRequested = plan.enabled && useCacheKey && plan.key !== null;
  const cacheControlRequested = marked.size > 0;
  return {
    payload: {
      model: slot.model,
      messages: openAiMessages(req.messages, marked),
      temperature: req.temperature ?? slot.temperature,
      max_tokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
      ...(cacheKeyRequested ? { prompt_cache_key: plan.key } : {}),
      ...(stream && plan.enabled && useStreamUsage
        ? { stream_options: { include_usage: true } }
        : {}),
    },
    cacheKeyRequested,
    cacheControlRequested,
    cacheRequested: cacheKeyRequested || cacheControlRequested,
    hasUsageHint: stream && plan.enabled && useStreamUsage,
  };
}

async function openAiAttempt(
  slot: ModelSlot,
  req: CompletionRequest,
  apiKey: string,
  stream: boolean,
  signal?: AbortSignal,
): Promise<OpenAiAttempt> {
  const endpoint = normalizedEndpointKey(slot);
  const capabilities = cacheCapabilities(endpoint);
  let useCacheKey = capabilities.cacheKey;
  let useStreamUsage = capabilities.usageStream;
  let useCacheControl = capabilities.cacheControl;
  let built = openAiPayload(slot, req, stream, useCacheKey, useStreamUsage, useCacheControl);
  let response = await openaiFetch(slot, apiKey, built.payload, signal);
  if (response.ok) {
    return { response, cacheRequested: built.cacheRequested, cacheFallback: false };
  }

  const body = await errorBody(response);
  throwIfAborted(signal);
  if (!isCacheCompatibilityError(response.status, body)
    || (!built.cacheRequested && !built.hasUsageHint)) {
    throw httpError(response.status, body);
  }

  const reason = downgradeReason(response.status, body);
  if (/stream_options/i.test(body) && built.hasUsageHint) {
    downgradeCacheCapability(endpoint, "usageStream", reason);
    useStreamUsage = false;
  } else if (/prompt_cache_key/i.test(body) && built.cacheKeyRequested) {
    downgradeCacheCapability(endpoint, "cacheKey", reason);
    useCacheKey = false;
  } else if (/cache_control|\bcontent\b/i.test(body) && built.cacheControlRequested) {
    downgradeCacheCapability(endpoint, "cacheControl", reason);
    useCacheControl = false;
  } else {
    if (built.hasUsageHint) downgradeCacheCapability(endpoint, "usageStream", reason);
    if (built.cacheKeyRequested) downgradeCacheCapability(endpoint, "cacheKey", reason);
    if (built.cacheControlRequested) downgradeCacheCapability(endpoint, "cacheControl", reason);
    useStreamUsage = false;
    useCacheKey = false;
    useCacheControl = false;
  }

  built = openAiPayload(slot, req, stream, useCacheKey, useStreamUsage, useCacheControl);
  response = await openaiFetch(slot, apiKey, built.payload, signal);
  if (!response.ok) throw httpError(response.status, await errorBody(response));
  return { response, cacheRequested: built.cacheRequested, cacheFallback: true };
}

const openaiAdapter: ProviderAdapter = {
  async complete(slot, req, apiKey, options) {
    const attempt = await openAiAttempt(slot, req, apiKey, false, options?.signal);
    const json = await attempt.response.json();
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("响应缺少 choices[0].message.content");
    return {
      truncated: json.choices?.[0]?.finish_reason === "length",
      text,
      usage: normalizeOpenAiUsage(json.usage),
      cacheRequested: attempt.cacheRequested,
      cacheFallback: attempt.cacheFallback,
    };
  },

  async *stream(slot, req, apiKey, options) {
    const attempt = await openAiAttempt(slot, req, apiKey, true, options?.signal);
    let usage: NormalizedUsage | null = null;
    let finishReason: string | null = null;
    for await (const data of sseData(attempt.response)) {
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield { type: "text", text: delta };
        const reason = json.choices?.[0]?.finish_reason;
        if (typeof reason === "string" && reason) finishReason = reason;
        if (json.usage !== undefined) usage = normalizeOpenAiUsage(json.usage);
      } catch {
        // Some compatible relays occasionally inject non-JSON lines.
      }
    }
    yield {
      type: "usage",
      usage: usage ?? emptyUsage(),
      cacheRequested: attempt.cacheRequested,
      cacheFallback: attempt.cacheFallback,
      truncated: finishReason === "length",
    };
    yield { type: "done" };
  },

  async listModels(baseUrl, apiKey) {
    const base = baseUrl.replace(/\/+$/, "");
    const candidates = [`${base}/models`];
    if (/\/v1$/.test(base)) candidates.push(`${base.replace(/\/v1$/, "")}/models`);
    else candidates.push(`${base}/v1/models`);

    let lastError = "";
    for (const url of candidates) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }).catch((error) => {
        lastError = error instanceof Error ? error.message : String(error);
        return null;
      });
      if (!response) continue;
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${await errorBody(response)}`;
        continue;
      }
      const json = await response.json().catch(() => null);
      const list = Array.isArray(json?.data) ? json.data : [];
      const ids = list
        .map((model: { id?: string }) => model.id)
        .filter((id: unknown): id is string => typeof id === "string");
      if (ids.length) return ids;
      lastError = "端点返回了空模型列表";
    }
    throw new Error(`${lastError || "取名录失败"}（该端点可能不提供模型列表接口——可直接手动输入模型名）`);
  },
};

// ───────────────────────── Anthropic ─────────────────────────

type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

function groupedSystemMessages(messages: ChatMessage[]) {
  const groups: Array<{ scope: PromptCacheScope; text: string }> = [];
  for (const message of messages.filter((item) => item.role === "system")) {
    const scope = message.cacheScope ?? "dynamic";
    const previous = groups.at(-1);
    if (previous?.scope === scope) previous.text += `\n\n${message.content}`;
    else groups.push({ scope, text: message.content });
  }
  return groups;
}

function anthropicBody(
  slot: ModelSlot,
  req: CompletionRequest,
  stream: boolean,
  cacheControl: boolean,
) {
  const plan = buildPromptCachePlan(slot, req);
  const groups = groupedSystemMessages(req.messages);
  let system: string | AnthropicSystemBlock[] | undefined;
  if (cacheControl && plan.enabled) {
    const lastGlobal = groups.findLastIndex((group) => group.scope === "global");
    const lastWorld = groups.findLastIndex((group) => group.scope === "world");
    const marked = new Set([lastGlobal, lastWorld].filter((index) => index >= 0));
    system = groups.map((group, index) => ({
      type: "text" as const,
      text: group.text,
      ...(marked.has(index) ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
  } else {
    system = groups.map((group) => group.text).join("\n\n") || undefined;
  }
  // 续写接力断点(F2):原请求末条 user 消息与回填的 assistant partial 是逐字节
  // 重发的稳定前缀末尾,以内容块形式携带 cache_control,使第 2+ 轮接力与网络
  // 断点续传近乎全前缀命中。文本字节不变,仅包装形式变化;plan 已按 Anthropic
  // 4 断点上限预算裁剪(系统块 + 消息块合计)。
  const messageMarks = cacheControl && plan.enabled
    ? new Set(plan.messageBreakpoints)
    : new Set<number>();
  return {
    body: {
      model: slot.model,
      system,
      messages: req.messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message.role !== "system")
        .map(({ message, index }) => (messageMarks.has(index)
          ? {
            role: message.role,
            content: [{
              type: "text" as const,
              text: message.content,
              cache_control: { type: "ephemeral" as const },
            }],
          }
          : { role: message.role, content: message.content })),
      temperature: req.temperature ?? slot.temperature,
      max_tokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
    },
    cacheRequested: plan.enabled && cacheControl,
  };
}

async function anthropicFetch(
  slot: ModelSlot,
  req: CompletionRequest,
  apiKey: string,
  stream: boolean,
  signal?: AbortSignal,
): Promise<OpenAiAttempt> {
  const endpoint = normalizedEndpointKey(slot);
  let cacheControl = cacheCapabilities(endpoint).cacheControl;
  let built = anthropicBody(slot, req, stream, cacheControl);
  const send = (body: unknown) => fetch(joinUrl(slot.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  let response = await send(built.body);
  if (response.ok) return { response, cacheRequested: built.cacheRequested, cacheFallback: false };

  const body = await errorBody(response);
  throwIfAborted(signal);
  if (!built.cacheRequested || !isCacheCompatibilityError(response.status, body)) {
    throw httpError(response.status, body);
  }
  downgradeCacheCapability(endpoint, "cacheControl", downgradeReason(response.status, body));
  cacheControl = false;
  built = anthropicBody(slot, req, stream, cacheControl);
  response = await send(built.body);
  if (!response.ok) throw httpError(response.status, await errorBody(response));
  return { response, cacheRequested: false, cacheFallback: true };
}

const anthropicAdapter: ProviderAdapter = {
  async complete(slot, req, apiKey, options) {
    const attempt = await anthropicFetch(slot, req, apiKey, false, options?.signal);
    const json = await attempt.response.json();
    const text = json.content
      ?.filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("");
    if (typeof text !== "string" || !text) throw new Error("响应缺少 content text 块");
    return {
      truncated: json.stop_reason === "max_tokens",
      text,
      usage: normalizeAnthropicUsage(json.usage),
      cacheRequested: attempt.cacheRequested,
      cacheFallback: attempt.cacheFallback,
    };
  },

  async *stream(slot, req, apiKey, options) {
    const attempt = await anthropicFetch(slot, req, apiKey, true, options?.signal);
    let usageRaw: Record<string, unknown> = {};
    let stopReason: string | null = null;
    for await (const data of sseData(attempt.response)) {
      try {
        const json = JSON.parse(data);
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          yield { type: "text", text: json.delta.text };
        }
        if (json.type === "message_start" && json.message?.usage) {
          usageRaw = { ...usageRaw, ...json.message.usage };
        }
        if (json.type === "message_delta") {
          if (json.usage) usageRaw = { ...usageRaw, ...json.usage };
          if (typeof json.delta?.stop_reason === "string") stopReason = json.delta.stop_reason;
        }
      } catch {
        // Ignore malformed relay events.
      }
    }
    yield {
      type: "usage",
      usage: normalizeAnthropicUsage(usageRaw),
      cacheRequested: attempt.cacheRequested,
      cacheFallback: attempt.cacheFallback,
      truncated: stopReason === "max_tokens",
    };
    yield { type: "done" };
  },

  async listModels(baseUrl, apiKey) {
    const response = await fetch(joinUrl(baseUrl, "/v1/models?limit=100"), {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!response.ok) throw httpError(response.status, await errorBody(response));
    const json = await response.json();
    const list = Array.isArray(json.data) ? json.data : [];
    return list
      .map((model: { id?: string }) => model.id)
      .filter((id: unknown): id is string => typeof id === "string");
  },
};

// ───────────────────────── Gemini ─────────────────────────

function geminiBody(slot: ModelSlot, req: CompletionRequest) {
  const system = req.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: req.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
    generationConfig: {
      temperature: req.temperature ?? slot.temperature,
      maxOutputTokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  };
}

const geminiAdapter: ProviderAdapter = {
  async complete(slot, req, apiKey, options) {
    const response = await fetch(joinUrl(slot.baseUrl, `/v1beta/models/${slot.model}:generateContent`), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(geminiBody(slot, req)),
      signal: options?.signal,
    });
    if (!response.ok) throw httpError(response.status, await errorBody(response));
    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("");
    if (typeof text !== "string" || !text) throw new Error("响应缺少 candidates[0].content.parts");
    return {
      text,
      usage: normalizeGeminiUsage(json.usageMetadata),
      cacheRequested: buildPromptCachePlan(slot, req).enabled,
      cacheFallback: false,
      truncated: json.candidates?.[0]?.finishReason === "MAX_TOKENS",
    };
  },

  async *stream(slot, req, apiKey, options) {
    const response = await fetch(
      joinUrl(slot.baseUrl, `/v1beta/models/${slot.model}:streamGenerateContent?alt=sse`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(geminiBody(slot, req)),
        signal: options?.signal,
      },
    );
    if (!response.ok) throw httpError(response.status, await errorBody(response));
    let usage: NormalizedUsage | null = null;
    let finishReason: string | null = null;
    for await (const data of sseData(response)) {
      try {
        const json = JSON.parse(data);
        const text = json.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text ?? "")
          .join("");
        if (text) yield { type: "text", text };
        const reason = json.candidates?.[0]?.finishReason;
        if (typeof reason === "string" && reason) finishReason = reason;
        if (json.usageMetadata !== undefined) usage = normalizeGeminiUsage(json.usageMetadata);
      } catch {
        // Ignore malformed relay events.
      }
    }
    yield {
      type: "usage",
      usage: usage ?? emptyUsage(),
      cacheRequested: buildPromptCachePlan(slot, req).enabled,
      cacheFallback: false,
      truncated: finishReason === "MAX_TOKENS",
    };
    yield { type: "done" };
  },

  async listModels(baseUrl, apiKey) {
    const response = await fetch(joinUrl(baseUrl, "/v1beta/models?pageSize=200"), {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!response.ok) throw httpError(response.status, await errorBody(response));
    const json = await response.json();
    const list = Array.isArray(json.models) ? json.models : [];
    return list
      .map((model: { name?: string }) =>
        typeof model.name === "string" ? model.name.replace(/^models\//, "") : null)
      .filter((id: unknown): id is string => typeof id === "string");
  },
};

export const adapters: Record<ModelSlot["provider"], ProviderAdapter> = {
  "openai-compatible": openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};
