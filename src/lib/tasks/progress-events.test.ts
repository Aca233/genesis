import { describe, expect, it } from "vitest";
import {
  TaskProgressEventSchema,
  encodeTaskEvent,
  progressEvent,
} from "./progress-events";

describe("TaskProgressEvent", () => {
  it("统一事件使用 taskId/content/failed 而不是旧字段", () => {
    const event = TaskProgressEventSchema.parse({
      type: "progress",
      taskId: "gen-1",
      taskKind: "chat",
      stage: "generating",
      status: "running",
      occurredAt: new Date(0).toISOString(),
    });

    expect(new TextDecoder().decode(encodeTaskEvent(event)))
      .toContain("\"stage\":\"generating\"");
    expect(() => TaskProgressEventSchema.parse({ type: "text", text: "旧字段" }))
      .toThrow();
  });

  it("构造真实阶段事件并拒绝任意字段", () => {
    expect(progressEvent("gen-1", "chat", "reserved", "completed", "请求已保留"))
      .toMatchObject({
        type: "progress",
        taskId: "gen-1",
        taskKind: "chat",
        stage: "reserved",
        status: "completed",
        detail: "请求已保留",
      });
    expect(() => TaskProgressEventSchema.parse({
      type: "failed",
      taskId: "gen-1",
      stage: "generating",
      message: "中断",
      retryable: true,
      internalError: "secret",
    })).toThrow();
  });
});
