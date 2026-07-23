import { describe, expect, it } from "vitest";
import { followWorldSettlement } from "./world-settlement-state";

function response(events: unknown[]) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("followWorldSettlement", () => {
  it("完成后恢复 idle", async () => {
    const result = await followWorldSettlement(
      "segment-1",
      async () => response([
        {
          type: "progress",
          taskId: "segment-1",
          taskKind: "settlement",
          stage: "extract",
          status: "running",
          occurredAt: "2026-07-23T00:00:00.000Z",
        },
        { type: "done", taskId: "segment-1", followUp: { kind: "none" } },
      ]),
    );
    expect(result).toEqual({ status: "idle" });
  });

  it("失败后保留可重试 segmentId", async () => {
    const result = await followWorldSettlement(
      "segment-1",
      async () => response([
        {
          type: "progress",
          taskId: "segment-1",
          taskKind: "settlement",
          stage: "chronicle",
          status: "running",
          occurredAt: "2026-07-23T00:00:00.000Z",
        },
        {
          type: "failed",
          taskId: "segment-1",
          stage: "chronicle",
          message: "编年史写入中断",
          retryable: true,
        },
      ]),
    );
    expect(result).toEqual({
      status: "failed",
      segmentId: "segment-1",
      stage: "chronicle",
      completedStages: ["checkpoint_read", "pantheon", "extract"],
      error: "编年史写入中断",
      retryable: true,
    });
  });

  it("网络中断时也返回可重试状态而不是抛出异常", async () => {
    const result = await followWorldSettlement(
      "segment-1",
      async () => {
        throw new Error("连接断开");
      },
    );
    expect(result).toEqual({
      status: "failed",
      segmentId: "segment-1",
      stage: "checkpoint_read",
      completedStages: [],
      error: "连接断开",
      retryable: true,
    });
  });
});
