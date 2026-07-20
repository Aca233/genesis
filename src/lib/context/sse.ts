import { stream as llmStream } from "@/lib/llm/gateway";
import type { ChatMessage } from "@/lib/llm/types";
import { splitMetaBlock, type NarratorMeta } from "@/lib/prompts/narrator";
import { findMetaStartCandidate, findMetaTailFrame } from "@/lib/prompts/meta-framing";
import type { GenerationCompletion } from "@/lib/chat/request";

const TAIL_WINDOW = 10;

export function narratorSSE(opts: {
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDone: (result: { prose: string; meta: NarratorMeta; signal: AbortSignal }) => Promise<{ messageId: string }>;
  onFailure?: (error: Error) => Promise<void>;
}): Response {
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  let closed = false;
  const abort = () => {
    if (closed) return;
    closed = true;
    upstream.abort();
    void opts.onFailure?.(new Error("叙事生成已取消"));
  };
  if (opts.signal?.aborted) abort();
  else opts.signal?.addEventListener("abort", abort, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        if (closed || upstream.signal.aborted) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
        catch { abort(); }
      };
      let full = "";
      let pending = "";
      let holdingCandidate = false;

      const flush = () => {
        if (holdingCandidate) {
          const complete = findMetaTailFrame(pending);
          if (complete) return;
          // Once a complete block has trailing non-whitespace it is prose.
          if (/META>>>[ \t]*(?:\r?\n)+\S/.test(pending)) {
            send({ type: "text", text: pending });
            pending = "";
            holdingCandidate = false;
          }
          return;
        }
        const marker = findMetaStartCandidate(pending);
        if (marker !== -1) {
          if (marker > 0) send({ type: "text", text: pending.slice(0, marker) });
          pending = pending.slice(marker);
          holdingCandidate = true;
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
          flush();
        }
        if (closed || upstream.signal.aborted) return;
        const parsed = splitMetaBlock(full);
        const framed = findMetaTailFrame(full);
        // A syntactically framed but invalid JSON block is prose. Stream exactly
        // what splitMetaBlock hands to persistence so the two views cannot diverge.
        const malformedFrame = framed && parsed.prose === full.trim();
        if ((!framed || malformedFrame) && pending) send({ type: "text", text: pending });
        const { messageId } = await opts.onDone({ ...parsed, signal: upstream.signal });
        if (!closed && !upstream.signal.aborted) send({ type: "done", messageId, meta: parsed.meta });
      } catch (error) {
        await opts.onFailure?.(error instanceof Error ? error : new Error(String(error)));
        if (!closed && !upstream.signal.aborted) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* cancelled */ }
        }
        opts.signal?.removeEventListener("abort", abort);
      }
    },
    cancel() { abort(); },
  });

  return new Response(body, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  } });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Replays a durable completion (or waits for its owner) using the normal SSE contract. */
export function narratorCompletionSSE(opts: {
  completion?: GenerationCompletion;
  waitForCompletion?: () => Promise<GenerationCompletion | null>;
  signal?: AbortSignal;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let completion = opts.completion;
        const deadline = Date.now() + (opts.maxWaitMs ?? 15_000);
        while (!completion && !opts.signal?.aborted && Date.now() < deadline) {
          completion = await opts.waitForCompletion?.() ?? undefined;
          if (!completion) await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalMs ?? 100));
        }
        if (completion && !opts.signal?.aborted) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "done",
            messageId: completion.messageId,
            meta: completion.meta,
          })}\n\n`));
        } else if (!opts.signal?.aborted) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error", message: "叙事生成仍在处理中，请重试",
          })}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
    cancel() { /* request signal controls the polling loop */ },
  });
  return new Response(body, { headers: SSE_HEADERS });
}
