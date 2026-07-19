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

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmTask =
  | "genesis"
  | "narrative"
  | "pantheon"
  | "extract"
  | "chronicle"
  | "test";

export type CompletionRequest = {
  messages: ChatMessage[];
  /** 覆盖槽位默认值 */
  temperature?: number;
  maxTokens?: number;
  /** 打日志用 */
  task: LlmTask;
};

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "done" };
