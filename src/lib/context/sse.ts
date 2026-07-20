import { stream as llmStream } from "@/lib/llm/gateway";
import type { ChatMessage } from "@/lib/llm/types";
import { META_START, splitMetaBlock, type NarratorMeta } from "@/lib/prompts/narrator";

const START_LINE = `\n${META_START}\n`;
const END_LINE = "\nMETA>>>";
const TAIL_WINDOW = START_LINE.length - 1;

export function narratorSSE(opts: {
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDone: (result: {
    prose: string;
    meta: NarratorMeta;
    signal: AbortSignal;
  }) => Promise<{ messageId: string }>;
}): Response {
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const abort = () => {
    closed = true;
    upstream.abort();
  };
  if (opts.signal?.aborted) abort();
  else opts.signal?.addEventListener("abort", abort, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      const send = (obj: unknown) => {
        if (closed || upstream.signal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          return true;
        } catch {
          abort();
          return false;
        }
      };

      let full = "";
      let pending = "";
      let candidate = false;

      const flushStreaming = () => {
        if (candidate) {
          const end = pending.indexOf(END_LINE);
          if (end !== -1) {
            const suffix = pending.slice(end + END_LINE.length);
            if (/\S/.test(suffix)) {
              send({ type: "text", text: pending });
              pending = "";
              candidate = false;
            }
          }
          return;
        }

        const marker = pending.lastIndexOf(START_LINE);
        if (marker !== -1) {
          if (marker > 0) send({ type: "text", text: pending.slice(0, marker) });
          pending = pending.slice(marker);
          candidate = true;
          return;
        }
        const safe = pending.length - TAIL_WINDOW;
        if (safe > 0) {
          send({ type: "text", text: pending.slice(0, safe) });
          pending = pending.slice(safe);
        }
      };

      try {
        for await (const chunk of llmStream(
          "narrative",
          { task: "narrative", messages: opts.messages },
          { signal: upstream.signal },
        )) {
          if (closed || upstream.signal.aborted) return;
          if (chunk.type !== "text" || !chunk.text) continue;
          full += chunk.text;
          pending += chunk.text;
          flushStreaming();
        }
        if (closed || upstream.signal.aborted) return;

        const parsed = splitMetaBlock(full);
        if (parsed.prose === full.trim()) {
          if (pending) send({ type: "text", text: pending });
        } else if (!candidate) {
          // A valid tail block may fit wholly inside the small pending window.
          const marker = pending.lastIndexOf(START_LINE);
          if (marker > 0) send({ type: "text", text: pending.slice(0, marker) });
        }
        if (closed || upstream.signal.aborted) return;
        const { messageId } = await opts.onDone({ ...parsed, signal: upstream.signal });
        if (closed || upstream.signal.aborted) return;
        send({ type: "done", messageId, meta: parsed.meta });
      } catch (err) {
        if (!closed && !upstream.signal.aborted) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already cancelled */ }
        }
        opts.signal?.removeEventListener("abort", abort);
      }
    },
    cancel() {
      abort();
      try { controllerRef?.close(); } catch { /* cancel already closes it */ }
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
