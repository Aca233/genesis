import { z } from "zod";
import { complete } from "./gateway";
import type { LlmTask, SlotName } from "./types";

/**
 * 结构化输出：要求模型输出 JSON，Zod 校验失败则携错误重问（×2）。
 * LLM 输出不可信 —— 这是所有结构化任务的唯一入口。
 */

const STRUCTURED_RETRIES = 2;

/** 从模型输出中提取 JSON（容忍 ```json 围栏、前后废话） */
export function extractJson(text: string): unknown {
  // 1. 直接解析
  try {
    return JSON.parse(text);
  } catch {
    /* fallthrough */
  }
  // 2. ```json 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fallthrough */
    }
  }
  // 3. 首个 { 到最后一个 }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("输出中未找到可解析的 JSON");
}

export async function completeStructured<T>(
  slotName: SlotName,
  opts: {
    task: LlmTask;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<T> {
  let lastError = "";
  let lastOutput = "";

  for (let attempt = 0; attempt <= STRUCTURED_RETRIES; attempt++) {
    const retryNote =
      attempt === 0
        ? ""
        : `\n\nYour previous output failed validation. Error:\n${lastError}\n\nPrevious output (truncated):\n${lastOutput.slice(0, 2000)}\n\nOutput ONLY the corrected JSON. No commentary.`;

    const text = await complete(slotName, {
      task: opts.task,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user + retryNote },
      ],
    });

    try {
      const json = extractJson(text);
      const parsed = opts.schema.safeParse(json);
      if (parsed.success) return parsed.data;
      lastError = JSON.stringify(parsed.error.issues.slice(0, 10), null, 2);
      lastOutput = text;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      lastOutput = text;
    }
  }

  throw new Error(`结构化输出在 ${STRUCTURED_RETRIES + 1} 次尝试后仍未通过校验：${lastError.slice(0, 500)}`);
}
