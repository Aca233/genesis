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
};

export type LlmTask =
  | "genesis"
  | "settlement"
  | "narrative"
  | "pantheon"
  | "extract"
  | "chronicle"
  | "reroll"
  | "test";

export type CompletionRequest = {
  messages: ChatMessage[];
  /** 覆盖槽位默认值 */
  temperature?: number;
  maxTokens?: number;
  /** 打日志用 */
  task: LlmTask;
  /** Enables provider prompt-cache hints when the stable prefix is large enough. */
  cache?: PromptCacheRequest;
};

export type StreamChunk =
  | { type: "text"; text: string }
  | {
      type: "usage";
      usage: NormalizedUsage;
      cacheRequested: boolean;
      cacheFallback: boolean;
    }
  | { type: "done" };
