"use client";

import type { TaskProgressView } from "./task-progress-state";

const icon = {
  pending: "○",
  running: "●",
  completed: "✓",
  failed: "×",
} as const;

export function TaskProgressBar({
  progress,
  onRetry,
  onRefresh,
}: {
  progress: TaskProgressView | null;
  onRetry?: () => void;
  onRefresh?: () => void;
}) {
  if (!progress) return null;
  return (
    <section
      className="mb-2 rounded-md border border-line/70 bg-paper-raised/90 px-3 py-2 text-xs"
      aria-label="任务进度"
    >
      <ol className="grid gap-1 sm:grid-cols-2">
        {progress.steps.map((step) => (
          <li
            key={step.id}
            className={
              step.status === "failed"
                ? "text-cinnabar"
                : step.status === "running"
                  ? "text-gilt"
                  : step.status === "completed"
                    ? "text-ink-soft"
                    : "text-ink-faint"
            }
          >
            <span aria-hidden>{icon[step.status]} </span>
            {step.label}
          </li>
        ))}
      </ol>
      {progress.status === "failed" && (
        <div className="mt-2 flex items-center justify-between gap-3 text-cinnabar">
          <span>{progress.safeError ?? "任务中断"}</span>
          {progress.retryable && onRetry ? (
            <button type="button" onClick={onRetry} className="shrink-0 underline">
              从此处重试
            </button>
          ) : onRefresh ? (
            <button type="button" onClick={onRefresh} className="shrink-0 underline">
              刷新世界
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
