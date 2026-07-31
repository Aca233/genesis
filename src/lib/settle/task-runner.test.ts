import { describe, expect, it, vi } from "vitest";
import {
  createSettlementTaskSSE,
  ensureSettlementRunning,
  settlementTaskRunning,
  subscribeSettlement,
} from "./task-runner";
import type { TaskProgressEvent } from "@/lib/tasks/progress-events";

describe("settlement task runner", () => {
  it("客户端退订不终止后台整理 owner", async () => {
    let finish!: () => void;
    const run = vi.fn(async (emit: (event: TaskProgressEvent) => void) => {
      emit({
        type: "progress",
        taskId: "segment-1",
        taskKind: "settlement",
        stage: "extract",
        status: "running",
        occurredAt: "2026-07-23T00:00:00.000Z",
      });
      await new Promise<void>((resolve) => { finish = resolve; });
    });
    const listener = vi.fn();
    const unsubscribe = subscribeSettlement("segment-1", listener);
    const first = ensureSettlementRunning("segment-1", run);
    const second = ensureSettlementRunning("segment-1", run);
    await Promise.resolve();

    expect(first).toBe(second);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(settlementTaskRunning("segment-1")).toBe(true);
    finish();
    await first;
    expect(settlementTaskRunning("segment-1")).toBe(false);
  });

  it("SSE 只订阅统一事件，取消读取不会取消 owner", async () => {
    const response = createSettlementTaskSSE("segment-2", [{
      type: "progress",
      taskId: "segment-2",
      taskKind: "settlement",
      stage: "checkpoint_read",
      status: "completed",
      occurredAt: "2026-07-23T00:00:00.000Z",
    }]);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("\"stage\":\"checkpoint_read\"");
    await reader.cancel();
  });

  it("重连订阅会回放刚刚错过的终态并关闭 SSE", async () => {
    await ensureSettlementRunning("segment-terminal", async (emit) => {
      emit({
        type: "failed",
        taskId: "segment-terminal",
        stage: "pantheon",
        message: "世界整理中断，请从当前步骤重试",
        retryable: true,
      });
    });

    const response = createSettlementTaskSSE("segment-terminal");
    const reader = response.body!.getReader();
    const first = await reader.read();
    const second = await reader.read();

    expect(new TextDecoder().decode(first.value)).toContain('"type":"failed"');
    expect(second.done).toBe(true);
  });
});
