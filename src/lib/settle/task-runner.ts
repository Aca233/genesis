import type { TaskProgressEvent } from "@/lib/tasks/progress-events";
import { encodeTaskEvent } from "@/lib/tasks/progress-events";

type Listener = (event: TaskProgressEvent) => void;
export type SettlementTaskRun = (
  emit: (event: TaskProgressEvent) => void,
) => Promise<void>;

const activeTasks = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<Listener>>();

function emitSettlement(taskId: string, event: TaskProgressEvent): void {
  for (const listener of listeners.get(taskId) ?? []) {
    try {
      listener(event);
    } catch {
      // Subscribers never own or cancel settlement work.
    }
  }
}

export function subscribeSettlement(taskId: string, listener: Listener): () => void {
  const current = listeners.get(taskId) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(taskId, current);
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(taskId);
  };
}

export function ensureSettlementRunning(
  taskId: string,
  run: SettlementTaskRun,
): Promise<void> {
  const existing = activeTasks.get(taskId);
  if (existing) return existing;
  const task = Promise.resolve()
    .then(() => run((event) => emitSettlement(taskId, event)))
    .finally(() => {
      if (activeTasks.get(taskId) === task) activeTasks.delete(taskId);
    });
  activeTasks.set(taskId, task);
  return task;
}

export function settlementTaskRunning(taskId: string): boolean {
  return activeTasks.has(taskId);
}

export function createSettlementTaskSSE(
  taskId: string,
  initialEvents: readonly TaskProgressEvent[] = [],
): Response {
  let unsubscribe: () => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of initialEvents) controller.enqueue(encodeTaskEvent(event));
      unsubscribe = subscribeSettlement(taskId, (event) => {
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
