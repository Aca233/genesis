import {
  taskStageIndex,
  taskStepViews,
  type DurableTaskProgress,
  type TaskStepView,
} from "@/lib/tasks/progress";

export type TaskProgressView = DurableTaskProgress & {
  steps: TaskStepView[];
};

export function reduceTaskProgress(
  current: TaskProgressView | null,
  next: DurableTaskProgress,
): TaskProgressView {
  if (current?.taskId === next.taskId) {
    const currentTime = Date.parse(current.updatedAt);
    const nextTime = Date.parse(next.updatedAt);
    if (nextTime < currentTime) return current;
    const currentStage = taskStageIndex(current.taskKind, current.stage);
    const nextStage = taskStageIndex(next.taskKind, next.stage);
    if (next.taskKind === current.taskKind && nextStage < currentStage) return current;
  }
  return { ...next, steps: taskStepViews(next) };
}

export function buildNarrationPreviewState(
  text: string | null,
  progress: DurableTaskProgress | null,
): {
  visible: boolean;
  text: string;
  persisted: boolean;
  label?: "尚未写入世界";
} {
  if (!text) return { visible: false, text: "", persisted: false };
  const unpersisted = progress?.taskKind === "chat"
    && (progress.stage === "output_stored" || progress.stage === "applying")
    && progress.status !== "completed";
  return {
    visible: true,
    text,
    persisted: !unpersisted,
    ...(unpersisted ? { label: "尚未写入世界" as const } : {}),
  };
}
