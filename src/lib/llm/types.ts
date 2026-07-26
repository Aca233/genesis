import { z } from "zod";

/** BYOK 模型槽位（docs/02 §3.1） */
export const ModelSlotSchema = z.object({
  provider: z.enum(["openai-compatible", "anthropic", "gemini"]),
  baseUrl: z.string().min(1, "Base URL 不能为空"),
  /** 明文仅存在于请求瞬间；落库前必须加密为 apiKeyEncrypted */
  apiKey: z.string().optional(),
  apiKeyEncrypted: z.string().optional(),
  model: z.string().min(1, "模型名不能为空"),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export type ModelSlot = z.infer<typeof ModelSlotSchema>;

export type SlotName = "narrative" | "backstage";

export type PromptCacheScope = "global" | "world" | "dynamic";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Internal-only cache stability marker; adapters must strip it from provider payloads. */
  cacheScope?: PromptCacheScope;
  /**
   * Internal-only continuation breakpoint marker: this message ends a byte-stable
   * re-sent prefix (续写接力回填的 assistant partial / 原请求末条 user 消息)。
   * Adapters must strip it from provider payloads; the Anthropic adapter may place
   * a cache_control breakpoint on the marked message.
   */
  prefixStable?: boolean;
};

export type PromptCacheRequest = {
  /** Low-cardinality logical namespace. It is hashed before being sent upstream. */
  namespace: string;
};

export type NormalizedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

export type AdapterCompletionResult = {
  text: string;
  usage: NormalizedUsage;
  cacheRequested: boolean;
  cacheFallback: boolean;
  /** 上游因输出上限提前收笔（finish_reason=length 等）；由网关决定续写或报错 */
  truncated?: boolean;
};

export type LlmTask =
  | "genesis"
  | "settlement"
  | "narrative"
  | "pantheon"
  | "extract"
  | "chronicle"
  | "reroll"
  | "finale"
  | "test";

export type CompletionRequest = {
  messages: ChatMessage[];
  /** 覆盖槽位默认值 */
  temperature?: number;
  maxTokens?: number;
  /** 打日志用 */
  task: LlmTask;
  /**
   * 发起调用的用户（多租户 Phase A 归因；槽位解析亦按此用户读取 Settings）。
   * 适配器忽略该字段。Phase A 入口一律传 "local"，后续波换真实会话用户。
   */
  userId: string;
  /** Enables provider prompt-cache hints when the stable prefix is large enough. */
  cache?: PromptCacheRequest;
  /**
   * 上游因输出上限截断（finish_reason=length / stop_reason=max_tokens）时显式报错，
   * 而非静默交付被斩断的文本。结构化输出与创世等"必须完整"的调用应开启。
   */
  failOnTruncation?: boolean;
};

export type StreamChunk =
  | { type: "text"; text: string }
  | {
      type: "usage";
      usage: NormalizedUsage;
      cacheRequested: boolean;
      cacheFallback: boolean;
      /** 上游因输出上限提前收笔；由网关决定续写或报错 */
      truncated?: boolean;
    }
  | { type: "done" };
