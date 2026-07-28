import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { adapters } from "./adapters";
import { buildPromptCachePlan, normalizedEndpointKey } from "./cache";
import { cacheCapabilitySnapshot } from "./cache-capabilities";
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

/** Resolve a model slot for a user; backstage falls back to narrative. */
export async function resolveSlot(
  name: SlotName,
  userId: string,
): Promise<{ slot: ModelSlot; apiKey: string; slotName: SlotName }> {
  const settings = await prisma.settings.findUnique({ where: { userId } });
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
  if (message === "流式响应为空") return true;
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
  /** 归因:发起调用的用户(多租户 Phase A)。 */
  userId: string;
  /** normalizedEndpointKey(slot);落库时读取该端点的能力降级快照(F8 可观测)。 */
  endpoint?: string;
  /** buildPromptCachePlan().key:缓存前缀指纹;同 hash 短窗口内第 2+ 次调用「应命中」(F5 可观测)。 */
  stablePrefixHash?: string | null;
  /** 一条业务请求(含全部续写接力/断点续传/非流式回退轮)共享的运行 ID(F5 可观测)。 */
  agentRunId?: string;
  /** 运行内轮号:0 = 首轮请求,1+ = 后续轮,按落库顺序递增(F5 可观测)。 */
  agentCallIndex?: number;
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
        userId: log.userId,
        durationMs: Date.now() - log.startedAt,
        ok: log.ok,
        error: log.error?.slice(0, 1000),
        inputTokens: log.usage?.inputTokens ?? null,
        outputTokens: log.usage?.outputTokens ?? null,
        cacheReadTokens: log.usage?.cacheReadTokens ?? null,
        cacheWriteTokens: log.usage?.cacheWriteTokens ?? null,
        cacheRequested: log.cacheRequested ?? false,
        cacheFallback: log.cacheFallback ?? false,
        // 该次调用运行时端点的降级状态(含最近一次降级原因);全部完好为 null。
        cacheCapability: log.endpoint ? cacheCapabilitySnapshot(log.endpoint) : null,
        stablePrefixHash: log.stablePrefixHash ?? null,
        agentRunId: log.agentRunId ?? null,
        agentCallIndex: log.agentCallIndex ?? null,
      },
    });
  } catch {
    // Logging failure must not block model output.
  }
}

type RunLogBase = Omit<CallLog, "ok" | "error" | "usage" | "cacheRequested" | "cacheFallback" | "agentRunId" | "agentCallIndex">;
type RunLogEntry = Pick<CallLog, "ok" | "error" | "usage" | "cacheRequested" | "cacheFallback">;

/**
 * 一条业务请求(含全部续写接力/断点续传/非流式回退轮)共享同一 agentRunId;
 * agentCallIndex 按落库顺序从 0 递增,使「一次请求发了几轮、每轮读/写了多少缓存」可归因。
 */
function createRunLogger(base: RunLogBase): (entry: RunLogEntry) => Promise<void> {
  const agentRunId = randomUUID();
  let agentCallIndex = 0;
  return (entry) => logCall({ ...base, agentRunId, agentCallIndex: agentCallIndex++, ...entry });
}

type CollectedStream = {
  text: string;
  usage?: NormalizedUsage;
  cacheRequested: boolean;
  cacheFallback: boolean;
  truncated: boolean;
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
  let truncated = false;
  for await (const chunk of adapter.stream(slot, req, apiKey)) {
    if (chunk.type === "text") text += chunk.text;
    if (chunk.type === "usage") {
      usage = chunk.usage;
      cacheRequested = chunk.cacheRequested;
      cacheFallback = chunk.cacheFallback;
      truncated = chunk.truncated ?? false;
    }
  }
  if (!text.trim()) throw new Error("流式响应为空");
  return { text, usage, cacheRequested, cacheFallback, truncated };
}

// ───────────── 输出上限续写拼接:让 4096 上限的通道也能完成长文生成 ─────────────

/** 单次请求最多接力续写的轮数（12 轮 × ~4k ≈ 48k，覆盖含将临之事的完整创世卡组并留余量）。 */
const MAX_CONTINUATION_ROUNDS = 12;
/** 流式接力途中允许的瞬时网络错误断点续传次数（独立于接力轮数预算）。 */
const STREAM_NETWORK_RETRIES = 4;

const CONTINUE_NUDGE =
  "你的上一条输出因长度上限被截断。从被截断的确切位置继续输出剩余内容：不要重复任何已输出的字符，不要添加任何解释、前言、省略号或代码围栏，直接接着写。";

/**
 * 续写请求:把已产出文本作为 assistant 消息回填,请求从断点继续。
 * 原请求末条 user 消息与回填的 assistant partial 标记 prefixStable——它们是
 * 逐字节重发的稳定前缀末尾,适配器据此加缓存断点,使第 2+ 轮接力与流式断点
 * 续传(runResilient)近乎全前缀命中。标记为内部字段,适配器发送前会剥除。
 */
function continuationRequest(req: CompletionRequest, partial: string): CompletionRequest {
  const lastUser = req.messages.findLastIndex((message) => message.role === "user");
  return {
    ...req,
    messages: [
      ...req.messages.map((message, index) =>
        (index === lastUser ? { ...message, prefixStable: true } : message)),
      { role: "assistant", content: partial, prefixStable: true },
      { role: "user", content: CONTINUE_NUDGE },
    ],
  };
}

/** 接缝去重:续写开头若与已产出文本结尾重叠,裁掉重叠段（最多回看 400 字符）。 */
function trimOverlap(previous: string, next: string): string {
  const window = Math.min(400, previous.length, next.length);
  for (let k = window; k > 0; k -= 1) {
    if (previous.endsWith(next.slice(0, k))) return next.slice(k);
  }
  return next;
}

/** 字符串外的花括号/方括号失衡数（>0 即未闭合）。 */
function jsonImbalance(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { if (inString) escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return depth;
}

/**
 * 部分中转通道会截断输出却谎报正常结束（finish_reason=stop）。
 * 对"必须完整"的 JSON 输出做启发式判定:解析失败且括号未闭合 = 实为截断。
 */
function looksTruncatedJson(raw: string): boolean {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return jsonImbalance(text) > 0;
  }
}

/** 显式标志或启发式二者其一判定截断。 */
function needsContinuation(req: CompletionRequest, truncated: boolean | undefined, text: string): boolean {
  if (!req.failOnTruncation) return false;
  return (truncated ?? false) || looksTruncatedJson(text);
}

function truncationError(req: CompletionRequest): Error {
  const asked = req.maxTokens ? `请求 ${req.maxTokens} tokens 未被满足，` : "";
  return new Error(
    `输出被上游截断且续写接力 ${MAX_CONTINUATION_ROUNDS} 轮后仍未完成（${asked}该模型/中转通道存在单次输出上限）。请在香炉更换支持更长输出的模型或端点。`,
  );
}

/** Non-streaming business completion, using streamed transport first for relay compatibility. */
export async function complete(
  slotName: SlotName,
  req: CompletionRequest,
  options?: CompleteOptions,
): Promise<string> {
  const { slot, apiKey, slotName: used } = await resolveSlot(slotName, req.userId);
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();
  const plan = buildPromptCachePlan(slot, req);
  const logRound = createRunLogger({
    task: req.task,
    slot: used,
    provider: slot.provider,
    model: slot.model,
    userId: req.userId,
    endpoint: normalizedEndpointKey(slot),
    stablePrefixHash: plan.key,
    startedAt,
  });

  /** 需要完整输出时,对截断结果做续写接力;超过轮数上限才判失败。 */
  const stitchStreamed = async (): Promise<string> => {
    let result = await collectStream(adapter, slot, req, apiKey);
    await logRound({ ok: true, usage: result.usage,
      cacheRequested: result.cacheRequested, cacheFallback: result.cacheFallback });
    if (!req.failOnTruncation) return result.text;
    let text = result.text;
    for (let round = 0; needsContinuation(req, result.truncated, text); round += 1) {
      if (round >= MAX_CONTINUATION_ROUNDS) throw truncationError(req);
      result = await collectStream(adapter, slot, continuationRequest(req, text), apiKey);
      await logRound({ ok: true, usage: result.usage,
        cacheRequested: result.cacheRequested, cacheFallback: result.cacheFallback });
      text += trimOverlap(text, result.text);
    }
    return text;
  };

  const stitchCompleted = async (): Promise<string> => {
    let result = await adapter.complete(slot, req, apiKey);
    await logRound({ ok: true, usage: result.usage,
      cacheRequested: result.cacheRequested, cacheFallback: result.cacheFallback });
    if (!req.failOnTruncation) return result.text;
    let text = result.text;
    for (let round = 0; needsContinuation(req, result.truncated, text); round += 1) {
      if (round >= MAX_CONTINUATION_ROUNDS) throw truncationError(req);
      result = await adapter.complete(slot, continuationRequest(req, text), apiKey);
      await logRound({ ok: true, usage: result.usage,
        cacheRequested: result.cacheRequested, cacheFallback: result.cacheFallback });
      text += trimOverlap(text, result.text);
    }
    return text;
  };

  const maxAttempts = Math.max(1, options?.maxAttempts ?? MAX_RETRIES);
  const allowFallback = options?.allowFallback ?? true;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await stitchStreamed();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts - 1) break;
      await backoff(attempt);
    }
  }

  if (allowFallback) {
    try {
      return await stitchCompleted();
    } catch (fallbackError) {
      const finalError = lastError ?? fallbackError;
      const message = finalError instanceof Error ? finalError.message : String(finalError);
      // 失败轮也记录缓存意图:plan.enabled 即该请求本会携带缓存标记
      await logRound({ ok: false, error: message, cacheRequested: plan.enabled });
      throw describeError(finalError);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await logRound({ ok: false, error: message, cacheRequested: plan.enabled });
  throw describeError(lastError);
}

/** Narrative stream. Usage events are internal and never exposed to business consumers. */
export async function* stream(
  slotName: SlotName,
  req: CompletionRequest,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamChunk> {
  const { slot, apiKey, slotName: used } = await resolveSlot(slotName, req.userId);
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();
  const plan = buildPromptCachePlan(slot, req);
  const logRound = createRunLogger({
    task: req.task,
    slot: used,
    provider: slot.provider,
    model: slot.model,
    userId: req.userId,
    endpoint: normalizedEndpointKey(slot),
    stablePrefixHash: plan.key,
    startedAt,
  });

  try {
    let accumulated = "";
    let truncated = false;
    const runRound = async function* (roundReq: CompletionRequest, overlapBase: string) {
      let usage: NormalizedUsage | undefined;
      let cacheRequested = false;
      let cacheFallback = false;
      let receivedText = false;
      truncated = false;
      // 接缝缓冲:续写轮开头可能与已产出结尾重叠,先攒足 400 字符做去重
      let seamBuffer: string | null = overlapBase ? "" : null;
      for await (const chunk of adapter.stream(slot, roundReq, apiKey, options)) {
        if (chunk.type === "usage") {
          usage = chunk.usage;
          cacheRequested = chunk.cacheRequested;
          cacheFallback = chunk.cacheFallback;
          truncated = chunk.truncated ?? false;
        } else if (chunk.type === "text") {
          if (chunk.text) receivedText = true;
          if (seamBuffer !== null) {
            seamBuffer += chunk.text;
            if (seamBuffer.length >= 400) {
              const deduped = trimOverlap(overlapBase, seamBuffer);
              seamBuffer = null;
              if (deduped) {
                accumulated += deduped;
                yield { type: "text", text: deduped } as StreamChunk;
              }
            }
          } else {
            accumulated += chunk.text;
            yield chunk;
          }
        } else {
          yield chunk;
        }
      }
      if (!receivedText) throw new Error("流式响应为空");
      if (seamBuffer !== null && seamBuffer) {
        const deduped = trimOverlap(overlapBase, seamBuffer);
        if (deduped) {
          accumulated += deduped;
          yield { type: "text", text: deduped } as StreamChunk;
        }
      }
      await logRound({ ok: true, usage, cacheRequested, cacheFallback });
    };

    // 断点续传:接力途中的瞬时网络错误不废弃整条流,以已累积文本为基础改走续写。
    let networkRetries = 0;
    const runResilient = async function* (roundReq: CompletionRequest, overlapBase: string) {
      for (;;) {
        try {
          yield* runRound(roundReq, overlapBase);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const resumable = req.failOnTruncation
            && (isRetryable(error) || message === "流式响应为空")
            && networkRetries < STREAM_NETWORK_RETRIES
            && !options?.signal?.aborted;
          if (!resumable) throw error;
          networkRetries += 1;
          await backoff(networkRetries - 1);
          if (accumulated.length > 0) {
            roundReq = continuationRequest(req, accumulated);
            overlapBase = accumulated;
          }
        }
      }
    };

    yield* runResilient(req, "");
    if (req.failOnTruncation) {
      for (let round = 0;
        needsContinuation(req, truncated, accumulated) && !options?.signal?.aborted;
        round += 1) {
        if (round >= MAX_CONTINUATION_ROUNDS) throw truncationError(req);
        yield* runResilient(continuationRequest(req, accumulated), accumulated);
      }
    }
  } catch (error) {
    if (options?.signal?.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    // 失败轮也记录缓存意图:plan.enabled 即该请求本会携带缓存标记
    await logRound({ ok: false, error: message, cacheRequested: plan.enabled });
    throw error;
  }
}

/**
 * Connection test against an unsaved slot.
 * 不经 resolveSlot(收到的是未保存的 slot+key);userId 纯为 LlmCall 归因。
 */
export async function testSlot(slot: ModelSlot, apiKey: string, userId: string): Promise<string> {
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();
  const req: CompletionRequest = {
    task: "test",
    userId,
    maxTokens: 64,
    messages: [{ role: "user", content: "请只回答四个字：试炼已过" }],
  };
  const logRound = createRunLogger({
    task: "test",
    slot: "narrative" as const,
    provider: slot.provider,
    model: slot.model,
    userId,
    endpoint: normalizedEndpointKey(slot),
    stablePrefixHash: null,
    startedAt,
  });
  try {
    try {
      const result = await collectStream(adapter, slot, req, apiKey);
      await logRound({ ok: true, usage: result.usage });
      return result.text;
    } catch {
      const result = await adapter.complete(slot, req, apiKey);
      await logRound({ ok: true, usage: result.usage });
      return result.text;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logRound({ ok: false, error: message });
    throw error;
  }
}
