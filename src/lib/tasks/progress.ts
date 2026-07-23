export type TaskKind = "chat" | "settlement" | "rewrite";
export type TaskStatus = "running" | "failed" | "completed";
export type TaskStepStatus = "pending" | "running" | "completed" | "failed";

export const taskStages = {
  chat: [
    { id: "reserved", label: "接收请求" },
    { id: "context_ready", label: "组装上下文" },
    { id: "generating", label: "生成正文" },
    { id: "output_stored", label: "校验模型输出" },
    { id: "applying", label: "写入正文与状态" },
    { id: "completed", label: "更新世界动态" },
  ],
  settlement: [
    { id: "checkpoint_read", label: "读取检查点" },
    { id: "pantheon", label: "推演诸神行动" },
    { id: "extract", label: "抽取持久变化" },
    { id: "chronicle", label: "更新编年史" },
    { id: "snapshot", label: "生成内部快照" },
    { id: "completed", label: "开放后续记录段" },
  ],
  rewrite: [
    { id: "intent_ready", label: "理解追溯意图" },
    { id: "planned", label: "建立改写计划" },
    { id: "branching", label: "克隆现实" },
    { id: "applying", label: "应用新历史" },
    { id: "narrating", label: "生成结果正文" },
    { id: "settling", label: "整理新现实" },
    { id: "completed", label: "切换活动现实" },
  ],
} as const satisfies Record<TaskKind, readonly { id: string; label: string }[]>;

export type ChatTaskStage = (typeof taskStages.chat)[number]["id"];
export type SettlementTaskStage = (typeof taskStages.settlement)[number]["id"];
export type RewriteTaskStage = (typeof taskStages.rewrite)[number]["id"];

export type DurableTaskProgress = {
  taskKind: TaskKind;
  taskId: string;
  stage: string;
  status: TaskStatus;
  retryable: boolean;
  safeError?: string;
  updatedAt: string;
};

export type TaskStepView = {
  id: string;
  label: string;
  status: TaskStepStatus;
};

export function taskStageIndex(kind: TaskKind, stage: string): number {
  return taskStages[kind].findIndex((item) => item.id === stage);
}

export function advanceTaskStage(kind: TaskKind, current: string, next: string): string {
  const currentIndex = taskStageIndex(kind, current);
  const nextIndex = taskStageIndex(kind, next);
  if (currentIndex < 0 || nextIndex < 0) throw new Error("未知任务阶段");
  if (nextIndex < currentIndex) throw new Error("任务阶段不可倒退");
  return next;
}

export function taskStepViews(progress: DurableTaskProgress): TaskStepView[] {
  const activeIndex = taskStageIndex(progress.taskKind, progress.stage);
  if (activeIndex < 0) throw new Error("未知任务阶段");
  return taskStages[progress.taskKind].map((step, index) => {
    let status: TaskStepStatus = "pending";
    if (index < activeIndex) status = "completed";
    if (index === activeIndex) {
      status = progress.status === "failed"
        ? "failed"
        : progress.status === "completed"
          ? "completed"
          : "running";
    }
    if (progress.status === "completed") status = "completed";
    return { ...step, status };
  });
}
