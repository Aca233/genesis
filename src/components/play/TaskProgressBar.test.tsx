import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskProgressBar } from "./TaskProgressBar";
import type { TaskProgressView } from "./task-progress-state";

function failedProgress(retryable: boolean): TaskProgressView {
  return {
    taskKind: "chat",
    taskId: "gen-1",
    stage: "applying",
    status: "failed",
    retryable,
    safeError: "写入中断",
    updatedAt: "2026-07-23T00:00:00.000Z",
    steps: [
      { id: "reserved", label: "接收请求", status: "completed" },
      { id: "applying", label: "写入正文与状态", status: "failed" },
    ],
  };
}

describe("TaskProgressBar", () => {
  it("失败阶段显示准确恢复动作", () => {
    const retryable = renderToStaticMarkup(
      <TaskProgressBar progress={failedProgress(true)} onRetry={() => undefined} />,
    );
    const refreshOnly = renderToStaticMarkup(
      <TaskProgressBar progress={failedProgress(false)} onRefresh={() => undefined} />,
    );
    expect(retryable).toContain("从此处重试");
    expect(refreshOnly).toContain("刷新世界");
    expect(retryable).toContain("写入正文与状态");
  });
});
