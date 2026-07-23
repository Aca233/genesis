import type { TaskProgressEvent } from "@/lib/tasks/progress-events";
import { encodeTaskEvent } from "@/lib/tasks/progress-events";

type NarrationTaskListener = (event: TaskProgressEvent) => void;
export type NarrationTaskRun = (
  emit: (event: TaskProgressEvent) => void,
) => Promise<void>;

const activeTasks = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<NarrationTaskListener>>();

function emitNarrationTask(taskId: string, event: TaskProgressEvent): void {
  for (const listener of listeners.get(taskId) ?? []) {
    try {
      listener(event);
    } catch {
      // A broken browser subscriber must never interrupt the durable owner.
    }
  }
}

export function publishNarrationTaskEvent(event: TaskProgressEvent): void {
  emitNarrationTask(event.taskId, event);
}

export function subscribeNarrationTask(
  taskId: string,
  listener: NarrationTaskListener,
): () => void {
  const taskListeners = listeners.get(taskId) ?? new Set<NarrationTaskListener>();
  taskListeners.add(listener);
  listeners.set(taskId, taskListeners);
  return () => {
    const current = listeners.get(taskId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(taskId);
  };
}

export function ensureNarrationTaskRunning(
  taskId: string,
  run: NarrationTaskRun,
): Promise<void> {
  const existing = activeTasks.get(taskId);
  if (existing) return existing;
  const task = Promise.resolve()
    .then(() => run((event) => emitNarrationTask(taskId, event)))
    .finally(() => {
      if (activeTasks.get(taskId) === task) activeTasks.delete(taskId);
    });
  activeTasks.set(taskId, task);
  return task;
}

export function narrationTaskRunning(taskId: string): boolean {
  return activeTasks.has(taskId);
}

type LegacyNarratorEvent =
  | { type: "text"; text: string }
  | {
      type: "done";
      messageId: string | null;
      meta: unknown;
      followUp: { kind: "none" } | { kind: "settlement"; segmentId: string }
        | { kind: "rewrite"; taskId: string };
    }
  | { type: "error"; message: string };

function parseSSEFrames(buffer: string): { frames: string[]; remainder: string } {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const parts = normalized.split("\n\n");
  return { frames: parts.slice(0, -1), remainder: parts.at(-1) ?? "" };
}

function legacyEventToTaskEvent(
  taskId: string,
  event: LegacyNarratorEvent,
): TaskProgressEvent {
  if (event.type === "text") {
    return { type: "text", taskId, content: event.text };
  }
  if (event.type === "done") {
    return { type: "done", taskId, followUp: event.followUp };
  }
  return {
    type: "failed",
    taskId,
    stage: "generating",
    message: event.message,
    retryable: true,
  };
}

async function consumeNarratorResponse(
  taskId: string,
  response: Response,
  emit: (event: TaskProgressEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("叙事流缺少响应体");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parsed = parseSSEFrames(buffer);
    buffer = parsed.remainder;
    for (const frame of parsed.frames) {
      const data = frame.split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      emit(legacyEventToTaskEvent(taskId, JSON.parse(data) as LegacyNarratorEvent));
    }
    if (done) break;
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    emit(legacyEventToTaskEvent(
      taskId,
      JSON.parse(tail.slice(5).trimStart()) as LegacyNarratorEvent,
    ));
  }
}

export function relayNarratorResponse(taskId: string, response: Response): Promise<void> {
  return ensureNarrationTaskRunning(taskId, (emit) =>
    consumeNarratorResponse(taskId, response, emit));
}

export function createNarrationTaskSSE(
  taskId: string,
  initialEvents: readonly TaskProgressEvent[] = [],
): Response {
  let unsubscribe: () => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of initialEvents) controller.enqueue(encodeTaskEvent(event));
      unsubscribe = subscribeNarrationTask(taskId, (event) => {
        try {
          controller.enqueue(encodeTaskEvent(event));
          if (event.type === "done" || event.type === "failed") controller.close();
        } catch {
          unsubscribe();
        }
      });
    },
    cancel() {
      unsubscribe();
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
