export type AdminTaskKind = "genesis" | "narrative" | "rewrite";
export type AdminTaskAction = "retry" | "recover" | "cancel";
export type AdminTaskSnapshot = {
  kind: AdminTaskKind;
  id: string;
  status: string;
  stage: string | null;
  attempt: number | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
  user: { id: string; name: string; email: string };
  world: { id: string; name: string } | null;
};
export type AdminAttentionTask = AdminTaskSnapshot & {
  reason: "failed" | "stale" | "repeated_failure";
  severity: "high" | "medium";
  recommendation: "rerun" | "recover" | "cancel" | "inspect";
  explanation: string;
  impactSummary: string;
};

const ACTIVE = {
  genesis: ["queued", "running", "repairing"],
  narrative: ["pending"],
  rewrite: ["planning", "applying", "narrating"],
} as const;

export function allowedAdminTaskActions(task: AdminTaskSnapshot, now: Date): AdminTaskAction[] {
  const stale = task.leaseExpiresAt !== null && task.leaseExpiresAt < now && (ACTIVE[task.kind] as readonly string[]).includes(task.status);
  if (task.kind === "narrative") return task.status === "pending" ? ["cancel"] : [];
  if (task.status === "failed") return ["retry"];
  if (stale) return ["recover", "cancel"];
  return (ACTIVE[task.kind] as readonly string[]).includes(task.status) ? ["cancel"] : [];
}

export function taskSelectionKey(task: Pick<AdminTaskSnapshot, "kind" | "id">) {
  return `${task.kind}:${task.id}`;
}

export function buildTaskExplanation(task: AdminTaskSnapshot) {
  const label = task.kind === "genesis" ? "创世任务" : task.kind === "narrative" ? "叙事生成" : "现实改写";
  const stage = task.stage ? `在“${task.stage}”阶段` : "在当前阶段";
  return task.error ? `${label}${stage}中断：${task.error}` : `${label}${stage}停止，未记录可展示的错误摘要。`;
}

export function deriveTaskAttention(task: AdminTaskSnapshot, now: Date): AdminAttentionTask | null {
  const active = (ACTIVE[task.kind] as readonly string[]).includes(task.status);
  const stale = active && task.leaseExpiresAt !== null && task.leaseExpiresAt < now;
  if (task.status !== "failed" && !stale) return null;
  const repeated = task.kind !== "rewrite" && task.status === "failed" && (task.attempt ?? 0) >= 3;
  const staleForMs = stale && task.leaseExpiresAt ? now.getTime() - task.leaseExpiresAt.getTime() : 0;
  const reason = repeated ? "repeated_failure" : stale ? "stale" : "failed";
  const recommendation = task.kind === "narrative" ? (stale ? "cancel" : "inspect") : stale ? "recover" : "rerun";
  return {
    ...task,
    reason,
    recommendation,
    severity: repeated || staleForMs >= 600_000 ? "high" : "medium",
    explanation: buildTaskExplanation(task),
    impactSummary: task.world ? `${task.user.name} 的世界「${task.world.name}」受到影响` : `${task.user.name} 的任务尚未落地世界`,
  };
}