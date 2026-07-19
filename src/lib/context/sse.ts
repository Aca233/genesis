import { stream as llmStream } from "@/lib/llm/gateway";
import type { ChatMessage } from "@/lib/llm/types";
import { META_START, splitMetaBlock, type NarratorMeta } from "@/lib/prompts/narrator";

/**
 * Narrator SSE 流转发器（/api/chat 与 /api/messages/[id]/variants 共用）：
 * - 事件均为 `data: {JSON}\n\n` 行：text 增量 / done / error
 * - 回压缓冲：累计文本尾部保留 8 字符窗口不外发，一旦命中 "<<<META"
 *   即停止外发其后内容；流结束统一解析 META（缺失/损坏容忍）
 * - LLM 流中途抛错 → 发 error 事件（已外发的正文由客户端自行处理）
 */

const TAIL_WINDOW = 8; // ≥ META_START.length - 1，保证跨 chunk 的起始符不漏出

export function narratorSSE(opts: {
  messages: ChatMessage[];
  /** 流正常结束后落库，返回 done 事件所需的 messageId */
  onDone: (result: { prose: string; meta: NarratorMeta }) => Promise<{ messageId: string }>;
}): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let full = ""; // 全量累计（含 META 块，落库前剥离）
      let emitted = 0; // 已外发到的字符位置
      let metaSeen = false;

      try {
        for await (const chunk of llmStream("narrative", {
          task: "narrative",
          messages: opts.messages,
        })) {
          if (chunk.type !== "text" || !chunk.text) continue;
          full += chunk.text;
          if (metaSeen) continue;

          const idx = full.indexOf(META_START);
          if (idx !== -1) {
            // 命中 META 起始：补发其前未外发部分，之后全部截留
            metaSeen = true;
            if (idx > emitted) {
              send({ type: "text", text: full.slice(emitted, idx) });
              emitted = idx;
            }
            continue;
          }
          // 未命中：外发至「尾部窗口」之前
          const safe = full.length - TAIL_WINDOW;
          if (safe > emitted) {
            send({ type: "text", text: full.slice(emitted, safe) });
            emitted = safe;
          }
        }

        // 流结束仍未见 META：把截留的尾窗补发（META 缺失属容忍情形）
        if (!metaSeen && full.length > emitted) {
          send({ type: "text", text: full.slice(emitted) });
        }

        const { prose, meta } = splitMetaBlock(full);
        const { messageId } = await opts.onDone({ prose, meta });
        send({ type: "done", messageId, meta });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          controller.close();
        } catch {
          // 客户端提前断开时 close 可能重复，忽略
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
