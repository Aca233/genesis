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
        { type: "progress", step: "extract" },
        { type: "done", nextSegmentId: "segment-2" },
      ]),
    );
    expect(result).toEqual({ status: "idle" });
  });

  it("失败后保留可重试 segmentId", async () => {
    const result = await followWorldSettlement(
      "segment-1",
      async () => response([
        { type: "progress", step: "extract" },
        { type: "error", message: "抽取中断" },
      ]),
    );
    expect(result).toEqual({
      status: "failed",
      segmentId: "segment-1",
      error: "抽取中断",
    });
  });
});

