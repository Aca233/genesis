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
      className="task-progress-strip relative mb-1 px-1.5 py-1 text-[11px]"
      aria-label="任务进度"
    >
      {/* 页边批注弦：不承载面板，只轻轻界定任务状态 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-line/80 to-transparent"
      />
      <ol className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        {progress.steps.map((step) => (
          <li
            key={step.id}
            className={
              step.status === "failed"
                ? "text-cinnabar"
                : step.status === "running"
                  ? "text-gilt"
                  : step.status === "completed"
                     ? "text-ink-faint"
                     : "text-ink-faint/55"
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
        <div className="mt-1 flex items-center justify-center gap-3 text-cinnabar">
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
