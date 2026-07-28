import { describe, expect, it } from "vitest";
import type { DurableTaskProgress } from "@/lib/tasks/progress";
import {
  buildNarrationPreviewState,
  reduceTaskProgress,
} from "./task-progress-state";

const now = "2026-07-23T00:00:01.000Z";

describe("task progress view state", () => {
  it("忽略服务端下发的未知阶段而不让对局页面崩溃", () => {
    expect(reduceTaskProgress(null, {
      taskKind: "settlement",
      taskId: "settle-legacy",
      stage: "done",
      status: "running",
      retryable: true,
      updatedAt: now,
    })).toBeNull();
  });

  it("刷新后的 durable 阶段补全此前步骤且不会被旧事件倒退", () => {
    const applying: DurableTaskProgress = {
      taskKind: "chat",
      taskId: "gen-1",
      stage: "applying",
      status: "running",
      retryable: true,
      updatedAt: now,
    };
    const state = reduceTaskProgress(null, applying);
    const stale = reduceTaskProgress(state, {
      ...applying,
      stage: "generating",
      updatedAt: "2026-07-23T00:00:00.000Z",
    });

    expect(stale).toEqual(state);
    expect(state?.steps.filter((step) => step.status === "completed").map((step) => step.id))
      .toContain("output_stored");
  });

  it("应用失败时正文预览仍可读但标记尚未写入世界", () => {
    expect(buildNarrationPreviewState("已有完整正文", {
      taskKind: "chat",
      taskId: "gen-1",
      stage: "applying",
      status: "failed",
      retryable: true,
      safeError: "数据库暂时不可用",
      updatedAt: now,
    })).toEqual({
      visible: true,
      text: "已有完整正文",
      persisted: false,
      label: "尚未写入世界",
    });
  });
});
