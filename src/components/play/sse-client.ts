/**
 * 叙事 SSE 客户端解析器（/api/chat 与 /api/messages/[id]/variants 共用）。
 * 服务端契约（src/lib/context/sse.ts）：每事件一行 `data: {JSON}\n\n`，
 * 依次为多条 {type:"text",text} → {type:"done",messageId,meta}；
 * 或中途 {type:"error",message} 收尾。
 * 非 200 响应为 JSON {error}，在此抛出供调用方 catch。
 */

import type { MessageMeta } from "./types";
import type { ChatFollowUp } from "@/lib/chat/follow-up";

export type SSEEvent =
  | { type: "text"; text: string }
  | { type: "done"; messageId: string | null; meta: MessageMeta; followUp?: ChatFollowUp }
  | { type: "error"; message: string };

export type StreamHandlers = {
  onText: (text: string) => void;
  onDone: (messageId: string | null, meta: MessageMeta, followUp: ChatFollowUp) => void;
  onError: (message: string) => void;
};

/**
 * 发起 SSE POST 并逐事件回调。
 * - HTTP 非 2xx：解析 JSON {error} 后调用 onError（不抛出）
 * - 流意外中断（无 done/error 收尾）：视作错误
 */
export async function streamNarration(
  url: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    handlers.onError(err instanceof Error ? err.message : String(err));
    return;
  }

  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    handlers.onError(json?.error ?? `请求失败（${res.status}）`);
    return;
  }
  if (!res.body) {
    handlers.onError("响应无正文流");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = false; // 已收到 done/error 收尾

  const feed = (raw: string) => {
    // 单行事件：`data: {JSON}`
    if (!raw.startsWith("data:")) return;
    let event: SSEEvent;
    try {
      event = JSON.parse(raw.slice(5).trim()) as SSEEvent;
    } catch {
      return; // 半包/坏行容忍
    }
    if (event.type === "text") {
      if (event.text) handlers.onText(event.text);
    } else if (event.type === "done") {
      settled = true;
      handlers.onDone(
        event.messageId,
        event.meta ?? {},
        event.followUp ?? { kind: "none" },
      );
    } else if (event.type === "error") {
      settled = true;
      handlers.onError(event.message || "生成中断");
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 事件以空行分隔；逐个完整事件出队
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of chunk.split("\n")) feed(line.trim());
      }
    }
    // 收尾残留（服务端总以 \n\n 结束，此处仅防御）
    if (buffer.trim()) feed(buffer.trim());
  } catch (err) {
    if (signal?.aborted) return;
    if (!settled) {
      handlers.onError(err instanceof Error ? err.message : "连接中断");
      settled = true;
    }
    return;
  }

  if (!settled && !signal?.aborted) {
    handlers.onError("生成流意外结束");
  }
}
