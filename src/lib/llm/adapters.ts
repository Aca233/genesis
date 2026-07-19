import type {
  ChatMessage,
  CompletionRequest,
  ModelSlot,
  StreamChunk,
} from "./types";

/**
 * 三协议适配层：openai-compatible / anthropic / gemini。
 * 只依赖各协议的最小公共 API 面（中转站兼容性优先），不引重型 SDK。
 */

export interface ProviderAdapter {
  /** 非流式：返回完整文本 */
  complete(slot: ModelSlot, req: CompletionRequest, apiKey: string): Promise<string>;
  /** 流式：产出文本增量 */
  stream(
    slot: ModelSlot,
    req: CompletionRequest,
    apiKey: string,
  ): AsyncGenerator<StreamChunk>;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** 部分网关（Bedrock 系中转）强制要求 max_tokens——未配置时给足额默认值 */
const DEFAULT_MAX_TOKENS = 8192;

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return `HTTP ${res.status}: ${body.slice(0, 500)}`;
}

/** 逐行解析 SSE，产出 data: 载荷（跳过注释与空行，遇 [DONE] 结束） */
async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      if (data) yield data;
    }
  }
}

// ───────────────────────── OpenAI 兼容 ─────────────────────────

const openaiAdapter: ProviderAdapter = {
  async complete(slot, req, apiKey) {
    const res = await fetch(joinUrl(slot.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: slot.model,
        messages: req.messages,
        temperature: req.temperature ?? slot.temperature,
        max_tokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("响应缺少 choices[0].message.content");
    return text;
  },

  async *stream(slot, req, apiKey) {
    const res = await fetch(joinUrl(slot.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: slot.model,
        messages: req.messages,
        temperature: req.temperature ?? slot.temperature,
        max_tokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    for await (const data of sseData(res)) {
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield { type: "text", text: delta };
      } catch {
        // 忽略中转站偶发的非 JSON 行
      }
    }
    yield { type: "done" };
  },
};

// ───────────────────────── Anthropic ─────────────────────────

function toAnthropicBody(slot: ModelSlot, req: CompletionRequest, stream: boolean) {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const messages = req.messages
    .filter((m): m is ChatMessage => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return {
    model: slot.model,
    system: system || undefined,
    messages,
    temperature: req.temperature ?? slot.temperature,
    max_tokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream,
  };
}

const anthropicAdapter: ProviderAdapter = {
  async complete(slot, req, apiKey) {
    const res = await fetch(joinUrl(slot.baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(toAnthropicBody(slot, req, false)),
    });
    if (!res.ok) throw new Error(await readError(res));
    const json = await res.json();
    const text = json.content
      ?.filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");
    if (typeof text !== "string" || !text) throw new Error("响应缺少 content text 块");
    return text;
  },

  async *stream(slot, req, apiKey) {
    const res = await fetch(joinUrl(slot.baseUrl, "/v1/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(toAnthropicBody(slot, req, true)),
    });
    if (!res.ok) throw new Error(await readError(res));
    for await (const data of sseData(res)) {
      try {
        const json = JSON.parse(data);
        if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
          yield { type: "text", text: json.delta.text };
        }
        if (json.type === "message_stop") break;
      } catch {
        // 忽略
      }
    }
    yield { type: "done" };
  },
};

// ───────────────────────── Gemini ─────────────────────────

function toGeminiBody(slot: ModelSlot, req: CompletionRequest) {
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents,
    generationConfig: {
      temperature: req.temperature ?? slot.temperature,
      maxOutputTokens: req.maxTokens ?? slot.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  };
}

const geminiAdapter: ProviderAdapter = {
  async complete(slot, req, apiKey) {
    const url = joinUrl(
      slot.baseUrl,
      `/v1beta/models/${slot.model}:generateContent`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(toGeminiBody(slot, req)),
    });
    if (!res.ok) throw new Error(await readError(res));
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    if (typeof text !== "string" || !text) {
      throw new Error("响应缺少 candidates[0].content.parts");
    }
    return text;
  },

  async *stream(slot, req, apiKey) {
    const url = joinUrl(
      slot.baseUrl,
      `/v1beta/models/${slot.model}:streamGenerateContent?alt=sse`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(toGeminiBody(slot, req)),
    });
    if (!res.ok) throw new Error(await readError(res));
    for await (const data of sseData(res)) {
      try {
        const json = JSON.parse(data);
        const text = json.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? "")
          .join("");
        if (text) yield { type: "text", text };
      } catch {
        // 忽略
      }
    }
    yield { type: "done" };
  },
};

export const adapters: Record<ModelSlot["provider"], ProviderAdapter> = {
  "openai-compatible": openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};
