import { stream as llmStream } from "@/lib/llm/gateway";
import type { ChatMessage } from "@/lib/llm/types";
import { splitMetaBlock, type NarratorMeta } from "@/lib/prompts/narrator";
import { findMetaStartCandidate, findMetaTailFrame } from "@/lib/prompts/meta-framing";

const TAIL_WINDOW = 10;

export function narratorSSE(opts: {
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDone: (result: { prose: string; meta: NarratorMeta; signal: AbortSignal }) => Promise<{ messageId: string }>;
}): Response {
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  let closed = false;
  const abort = () => { closed = true; upstream.abort(); };
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
        const framed = findMetaTailFrame(full);
        if (!framed && pending) send({ type: "text", text: pending });
        const parsed = splitMetaBlock(full);
        const { messageId } = await opts.onDone({ ...parsed, signal: upstream.signal });
        if (!closed && !upstream.signal.aborted) send({ type: "done", messageId, meta: parsed.meta });
      } catch (error) {
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
