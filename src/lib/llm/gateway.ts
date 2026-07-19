import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { adapters } from "./adapters";
import {
  ModelSlotSchema,
  type CompletionRequest,
  type ModelSlot,
  type SlotName,
  type StreamChunk,
} from "./types";

/**
 * LLM Gateway（docs/02 §3）：
 * - 槽位解析（幕后缺省回落叙事槽）
 * - Key 解密（仅在请求瞬间存在于内存）
 * - 统一重试：网络错误/429/5xx 指数退避 ×3
 * - llm_calls 日志
 */

const MAX_RETRIES = 3;

class SlotNotConfiguredError extends Error {
  constructor(slot: SlotName) {
    super(
      slot === "narrative"
        ? "叙事模型未配置：请先在设置（香炉）中完成模型槽位配置"
        : "幕后模型未配置",
    );
    this.name = "SlotNotConfiguredError";
  }
}

/** 解析槽位：backstage 未配置时回落 narrative */
export async function resolveSlot(
  name: SlotName,
): Promise<{ slot: ModelSlot; apiKey: string; slotName: SlotName }> {
  const settings = await prisma.settings.findUnique({ where: { userId: "local" } });
  const raw =
    name === "backstage"
      ? (settings?.backstageSlot ?? settings?.narrativeSlot)
      : settings?.narrativeSlot;
  const usedName: SlotName =
    name === "backstage" && !settings?.backstageSlot ? "narrative" : name;
  if (!raw) throw new SlotNotConfiguredError("narrative");

  const slot = ModelSlotSchema.parse(raw);
  if (!slot.apiKeyEncrypted) throw new SlotNotConfiguredError(usedName);
  return { slot, apiKey: decryptSecret(slot.apiKeyEncrypted), slotName: usedName };
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP (429|500|502|503|504|529)/.test(msg)) return true;
  // 中转站的 route_not_found / upstream 类 404 往往换个上游即通，值得重试
  if (/HTTP 404/.test(msg) && /route_not_found|upstream|数据面/.test(msg)) return true;
  // fetch 网络层错误
  return /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket/i.test(msg);
}

async function backoff(attempt: number) {
  const ms = 1000 * 2 ** attempt + Math.random() * 500;
  await new Promise((r) => setTimeout(r, ms));
}

async function logCall(
  task: string,
  slot: SlotName,
  startedAt: number,
  ok: boolean,
  error?: string,
) {
  try {
    await prisma.llmCall.create({
      data: {
        task,
        slot,
        durationMs: Date.now() - startedAt,
        ok,
        error: error?.slice(0, 1000),
      },
    });
  } catch {
    // 日志失败不阻塞主流程
  }
}

/** 以流式请求聚合出全文（多数中转站只稳定支持流式，故这是默认路径） */
async function collectStream(
  adapter: (typeof adapters)[keyof typeof adapters],
  slot: ModelSlot,
  req: CompletionRequest,
  apiKey: string,
): Promise<string> {
  let text = "";
  for await (const chunk of adapter.stream(slot, req, apiKey)) {
    if (chunk.type === "text") text += chunk.text;
  }
  if (!text.trim()) throw new Error("流式响应为空");
  return text;
}

/**
 * 非流式任务补全（世界生成/诸神回合/抽取/压缩/连接测试）。
 * 底层优先走流式聚合（中转站兼容性最好），流式彻底失败后回落一次非流式。
 */
export async function complete(
  slotName: SlotName,
  req: CompletionRequest,
): Promise<string> {
  const { slot, apiKey, slotName: used } = await resolveSlot(slotName);
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const text = await collectStream(adapter, slot, req, apiKey);
      await logCall(req.task, used, startedAt, true);
      return text;
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES - 1) break;
      await backoff(attempt);
    }
  }

  // 流式失败 → 回落非流式再试一次（个别网关只支持非流式）
  try {
    const text = await adapter.complete(slot, req, apiKey);
    await logCall(req.task, used, startedAt, true);
    return text;
  } catch (fallbackErr) {
    const message =
      lastError instanceof Error ? lastError.message : String(lastError ?? fallbackErr);
    await logCall(req.task, used, startedAt, false, message);
    throw lastError ?? fallbackErr;
  }
}

/** 流式补全（正文叙事）。流中途出错不重试（避免正文重复），直接抛出。 */
export async function* stream(
  slotName: SlotName,
  req: CompletionRequest,
): AsyncGenerator<StreamChunk> {
  const { slot, apiKey, slotName: used } = await resolveSlot(slotName);
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();

  try {
    yield* adapter.stream(slot, req, apiKey);
    await logCall(req.task, used, startedAt, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCall(req.task, used, startedAt, false, message);
    throw err;
  }
}

/** 「试炼一问」连接测试：直接用传入槽位（未落库前验证），流式聚合，不走重试 */
export async function testSlot(slot: ModelSlot, apiKey: string): Promise<string> {
  const adapter = adapters[slot.provider];
  const startedAt = Date.now();
  const req: CompletionRequest = {
    task: "test",
    maxTokens: 64,
    messages: [
      {
        role: "user",
        content: "请只回答四个字：试炼已过",
      },
    ],
  };
  try {
    let text: string;
    try {
      text = await collectStream(adapter, slot, req, apiKey);
    } catch {
      // 流式失败回落非流式（个别网关只支持其一）
      text = await adapter.complete(slot, req, apiKey);
    }
    await logCall("test", "narrative", startedAt, true);
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logCall("test", "narrative", startedAt, false, message);
    throw err;
  }
}
