"use client";

import type { TaskProgressView } from "./task-progress-state";

/** 阶段圆钮：待办空环 / 进行鎏金焕 / 已成淡金实点（docs/06 §3）/ 中断朱点 */
const dotClass = {
  pending: "border border-ink-faint/50",
  running: "animate-pulse bg-gilt shadow-[0_0_6px_var(--seal-glow)]",
  completed: "bg-gilt/60",
  failed: "bg-cinnabar",
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
      className="relative mb-2 rounded-lg border border-gilt/30 bg-paper-raised/95 px-3.5 py-2 text-xs shadow-[0_2px_12px_var(--shadow-warm)]"
      aria-label="任务进度"
    >
      {/* 上缘鎏金发丝线（两端淡出） */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-gilt/50 to-transparent"
      />
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
            <span
              aria-hidden="true"
              className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${dotClass[step.status]}`}
            />
            {step.label}
          </li>
        ))}
      </ol>
      {progress.status === "failed" && (
        <div className="mt-2 flex items-center justify-between gap-3 text-cinnabar">
          <span>{progress.safeError ?? "任务中断"}</span>
          {progress.retryable && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded-md border border-cinnabar/50 px-2.5 py-0.5 transition hover:bg-cinnabar/10"
            >
              从此处重试
            </button>
          ) : onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="shrink-0 rounded-md border border-cinnabar/50 px-2.5 py-0.5 transition hover:bg-cinnabar/10"
            >
              刷新世界
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
