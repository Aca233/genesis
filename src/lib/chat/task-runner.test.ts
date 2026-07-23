import { describe, expect, it, vi } from "vitest";
import {
  createNarrationTaskSSE,
  ensureNarrationTaskRunning,
  narrationTaskRunning,
  relayNarratorResponse,
  subscribeNarrationTask,
} from "./task-runner";
import type { TaskProgressEvent } from "@/lib/tasks/progress-events";

describe("narration task runner", () => {
  it("同一 taskId 只启动一个 owner 并向订阅者广播", async () => {
    let finish!: () => void;
    const run = vi.fn(async (emit: (event: TaskProgressEvent) => void) => {
      emit({
        type: "progress",
        taskId: "gen-1",
        taskKind: "chat",
        stage: "generating",
        status: "running",
        occurredAt: new Date(0).toISOString(),
      });
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    const received: TaskProgressEvent[] = [];
    const unsubscribe = subscribeNarrationTask("gen-1", (event) => received.push(event));

    const first = ensureNarrationTaskRunning("gen-1", run);
    const second = ensureNarrationTaskRunning("gen-1", run);
    await Promise.resolve();

    expect(first).toBe(second);
    expect(run).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(narrationTaskRunning("gen-1")).toBe(true);

    unsubscribe();
    finish();
    await first;
    expect(narrationTaskRunning("gen-1")).toBe(false);
  });

  it("取消最后一个订阅者不会中止后台任务", async () => {
    let finish!: () => void;
    const run = vi.fn(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    const listener = vi.fn();
    const unsubscribe = subscribeNarrationTask("gen-2", listener);
    const task = ensureNarrationTaskRunning("gen-2", run);

    unsubscribe();
    await Promise.resolve();
    expect(narrationTaskRunning("gen-2")).toBe(true);
    finish();
    await task;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("把内部 narrator 流转为统一事件并在浏览器取消后继续消费", async () => {
    let release!: () => void;
    const internal = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "text", text: "第一段" })}\n\n`,
        ));
        void new Promise<void>((resolve) => { release = resolve; }).then(() => {
          controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: "done",
              messageId: "message-1",
              meta: {},
              followUp: { kind: "none" },
            })}\n\n`,
          ));
          controller.close();
        });
      },
    }));
    const browser = createNarrationTaskSSE("gen-3");
    const browserReader = browser.body!.getReader();
    const relay = relayNarratorResponse("gen-3", internal);

    const first = new TextDecoder().decode((await browserReader.read()).value);
    expect(first).toContain("\"type\":\"text\"");
    expect(first).toContain("\"content\":\"第一段\"");
    await browserReader.cancel();

    release();
    await relay;
    expect(narrationTaskRunning("gen-3")).toBe(false);
  });
});
