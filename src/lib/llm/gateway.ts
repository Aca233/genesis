import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { adapters } from "./adapters";
import {
  ModelSlotSchema,
  type CompletionRequest,
  type ModelSlot,
  type NormalizedUsage,
  type SlotName,
  type StreamChunk,
} from "./types";

const MAX_RETRIES = 3;

export type CompleteOptions = {
  /** Total upstream streaming requests, including the first request. */
  maxAttempts?: number;
  /** Whether a failed streaming request may issue one additional non-streaming request. */
  allowFallback?: boolean;
};

class SlotNotConfiguredError extends Error {
  constructor(slot: SlotName) {
    super(slot === "narrative"
      ? "叙事模型未配置：请先在设置（香炉）中完成模型槽位配置"
      : "幕后模型未配置");
    this.name = "SlotNotConfiguredError";
  }
}

/** Resolve a model slot; backstage falls back to narrative. */
export async function resolveSlot(
  name: SlotName,
): Promise<{ slot: ModelSlot; apiKey: string; slotName: SlotName }> {
  const settings = await prisma.settings.findUnique({ where: { userId: "local" } });
  const raw = name === "backstage"
    ? (settings?.backstageSlot ?? settings?.narrativeSlot)
    : settings?.narrativeSlot;
  const usedName: SlotName = name === "backstage" && !settings?.backstageSlot
    ? "narrative"
    : name;
  if (!raw) throw new SlotNotConfiguredError("narrative");
  const slot = ModelSlotSchema.parse(raw);
  if (!slot.apiKeyEncrypted) throw new SlotNotConfiguredError(usedName);
  return { slot, apiKey: decryptSecret(slot.apiKeyEncrypted), slotName: usedName };
}

function isNetworkError(message: string): boolean {
  return /fetch failed|terminated|other side closed|aborted|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|socket|UND_ERR/i.test(message);
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP (429|500|502|503|504|529)/.test(message)) return true;
  if (/HTTP 404/.test(message) && /route_not_found|upstream|数据面/.test(message)) return true;
  return isNetworkError(message);
}

/** 供任务运行器判断：该错误是否属于值得整体重试的瞬时故障（网络断流/上游过载）。 */
export function isTransientLlmError(error: unknown): boolean {
  return isRetryable(error);
}

function describeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (isNetworkError(message) && !/^HTTP \d/.test(message)) {
    return new Error(`与模型端点的连接中断（${message}）——多为中转站在长响应中途掐断连接。已自动重试仍失败，可稍后再试或换用更稳的端点/模型。`);
  }
  return error instanceof Error ? error : new Error(message);
}

async function backoff(attempt: number) {
  const milliseconds = 1000 * 2 ** attempt + Math.random() * 500;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type CallLog = {
  task: string;
  slot: SlotName;
  provider: string;
  model: string;
  startedAt: number;
  ok: boolean;
  error?: string;
  usage?: NormalizedUsage;
  cacheRequested?: boolean;
  cacheFallback?: boolean;
};

async function logCall(log: CallLog) {
  try {
    await prisma.llmCall.create({
      data: {
        task: log.task,
        slot: log.slot,
        provider: log.provider,
        model: log.model,
        durationMs: Date.now() - log.startedAt,
        ok: log.ok,
        error: log.error?.slice(0, 1000),
        inputTokens: log.usage?.inputTokens ?? null,
        outputTokens: log.usage?.outputTokens ?? null,
        cacheReadTokens: log.usage?.cacheReadTokens ?? null,
        cacheWriteTokens: log.usage?.cacheWriteTokens ?? null,
        cacheRequested: log.cacheRequested ?? false,
        cacheFallback: log.cacheFallback ?? false,
      },
    });
  } catch {
    // Logging failure must not block model output.
  }
}

type CollectedStream = {
  text: string;
  usage?: NormalizedUsage;
  cacheRequested: boolean;
  cacheFallback: boolean;
};

async function collectStream(
  adapter: (typeof adapters)[keyof typeof adapters],
  slot: ModelSlot,
  req: CompletionRequest,
  apiKey: string,
): Promise<CollectedStream> {
  let text = "";
  let usage: NormalizedUsage | undefined;
  let cacheRequested = false;
  let cacheFallback = false;
  for await (const chunk of adapter.stream(slot, req, apiKey)) {
    if (chunk.type === "text") text += chunk.text;
    if (chunk.type === "usage") {
      usage = chunk.usage;
      cacheRequested = chunk.cacheRequested;
      cacheFallback = chunk.cacheFallback;
    }
  }
  if (!text.trim()) throw new Error("流式响应为空");
  return { text, usage, cacheRequested, cacheFallback };
}

/** Non-streaming business completion, using streamed transport first for relay compatibility. */
export async function complete(
  slotName: SlotName,
  req: CompletionRequest,
  options?: CompleteOptions,
): Promise<string> {
  const { slot, apiKey, slotName: used } = await resolveSlot(slotName);
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();
  const baseLog = {
    task: req.task,
    slot: used,
    provider: slot.provider,
    model: slot.model,
    startedAt,
  };

  const maxAttempts = Math.max(1, options?.maxAttempts ?? MAX_RETRIES);
  const allowFallback = options?.allowFallback ?? true;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await collectStream(adapter, slot, req, apiKey);
      await logCall({ ...baseLog, ok: true, usage: result.usage,
        cacheRequested: result.cacheRequested, cacheFallback: result.cacheFallback });
      return result.text;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts - 1) break;
      await backoff(attempt);
    }
  }

  if (allowFallback) {
    try {
      const result = await adapter.complete(slot, req, apiKey);
      await logCall({ ...baseLog, ok: true, usage: result.usage,
        cacheRequested: result.cacheRequested, cacheFallback: result.cacheFallback });
      return result.text;
    } catch (fallbackError) {
      const finalError = lastError ?? fallbackError;
      const message = finalError instanceof Error ? finalError.message : String(finalError);
      await logCall({ ...baseLog, ok: false, error: message });
      throw describeError(finalError);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await logCall({ ...baseLog, ok: false, error: message });
  throw describeError(lastError);
}

/** Narrative stream. Usage events are internal and never exposed to business consumers. */
export async function* stream(
  slotName: SlotName,
  req: CompletionRequest,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamChunk> {
  const { slot, apiKey, slotName: used } = await resolveSlot(slotName);
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();
  const baseLog = {
    task: req.task,
    slot: used,
    provider: slot.provider,
    model: slot.model,
    startedAt,
  };

  try {
    let usage: NormalizedUsage | undefined;
    let cacheRequested = false;
    let cacheFallback = false;
    for await (const chunk of adapter.stream(slot, req, apiKey, options)) {
      if (chunk.type === "usage") {
        usage = chunk.usage;
        cacheRequested = chunk.cacheRequested;
        cacheFallback = chunk.cacheFallback;
      } else {
        yield chunk;
      }
    }
    if (options?.signal?.aborted) return;
    await logCall({ ...baseLog, ok: true, usage, cacheRequested, cacheFallback });
  } catch (error) {
    if (options?.signal?.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    await logCall({ ...baseLog, ok: false, error: message });
    throw error;
  }
}

/** Connection test against an unsaved slot. */
export async function testSlot(slot: ModelSlot, apiKey: string): Promise<string> {
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();
  const req: CompletionRequest = {
    task: "test",
    maxTokens: 64,
    messages: [{ role: "user", content: "请只回答四个字：试炼已过" }],
  };
  const baseLog = {
    task: "test",
    slot: "narrative" as const,
    provider: slot.provider,
    model: slot.model,
    startedAt,
  };
  try {
    try {
      const result = await collectStream(adapter, slot, req, apiKey);
      await logCall({ ...baseLog, ok: true, usage: result.usage });
      return result.text;
    } catch {
      const result = await adapter.complete(slot, req, apiKey);
      await logCall({ ...baseLog, ok: true, usage: result.usage });
      return result.text;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logCall({ ...baseLog, ok: false, error: message });
    throw error;
  }
}
