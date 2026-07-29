import Link from "next/link";
import { AdminActionButton } from "./AdminActionButton";
import { taskActionCopy } from "@/lib/admin/action-form";
import {
  allowedAdminTaskActions,
  deriveTaskAttention,
  type AdminAttentionTask,
  type AdminTaskAction,
  type AdminTaskSnapshot,
} from "@/lib/admin/task-attention";

const actionLabels: Record<AdminTaskAction, string> = {
  retry: "重新执行",
  recover: "恢复任务",
  cancel: "取消任务",
};

const recommendationCopy: Record<AdminAttentionTask["recommendation"], string> = {
  rerun: "建议重新执行。保留失败记录，并从允许恢复的位置重新开始。",
  recover: "建议恢复任务。先确认旧执行器已经停止，再清除过期租约并重新进入可执行状态。",
  cancel: "建议取消任务。停止后续执行，并保留当前故障证据供审计。",
  inspect: "建议先检查模型调用与任务审计记录，再由原始业务流程决定后续处理。",
};

function riskCopy(attention: AdminAttentionTask | null) {
  if (attention?.reason === "stale") return "租约已过期；恢复前应确认没有仍在运行的执行器，避免重复写入。";
  if (attention?.reason === "repeated_failure") return "任务已连续失败；再次处理前应先核对上游状态，现有失败记录将继续保留。";
  return "失败记录已保留；本页不展示用户正文，也不会自动修改任务数据。";
}

function formatMetadataTime(value: Date) {
  return value.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function AdminTaskDetail({ task, now }: { task: AdminTaskSnapshot | null; now: Date }) {
  if (!task) {
    return <aside className="admin-workbench-detail admin-panel" aria-labelledby="admin-task-detail-title">
      <div className="admin-workbench-detail__empty">
        <p className="admin-workbench-eyebrow">TASK CONTEXT</p>
        <h2 id="admin-task-detail-title">选择一项任务</h2>
        <p>从待处置队列中打开任务，查看故障元数据与建议操作。</p>
      </div>
    </aside>;
  }

  const attention = deriveTaskAttention(task, now);
  const allowedActions = allowedAdminTaskActions(task, now);
  const llmHref = `/admin/llm?userId=${encodeURIComponent(task.user.id)}${task.world ? `&worldId=${encodeURIComponent(task.world.id)}` : ""}&ok=no`;
  const auditHref = `/admin/audit?targetId=${encodeURIComponent(task.id)}`;
  const worldHref = task.world ? `/admin/worlds?search=${encodeURIComponent(task.world.id)}` : null;
  const narrativeFailure = task.kind === "narrative" && task.status === "failed";
  const taskTitle = task.kind === "genesis" ? "创世任务" : task.kind === "narrative" ? "叙事生成" : "现实改写";
  const targetLabel = `${taskTitle} · ${task.world?.name ?? task.id}`;
  const currentState = `${task.status} · ${task.stage ?? "阶段未知"}`;
  const explanation = attention?.explanation
    ?? `${taskTitle}当前状态为“${task.status}”，最近阶段为“${task.stage ?? "阶段未知"}”。`;
  const impactSummary = attention?.impactSummary
    ?? (task.world ? `${task.user.name} 的世界「${task.world.name}」任务元数据` : `${task.user.name} 的任务元数据`);

  return <aside className="admin-workbench-detail admin-panel" aria-labelledby="admin-task-detail-title">
    <div className="admin-workbench-detail__head">
      <div>
        <p className="admin-workbench-eyebrow">TASK CONTEXT</p>
        <h2 id="admin-task-detail-title">{task.world?.name ?? "未落地世界"}</h2>
        <code>{task.kind}:{task.id}</code>
      </div>
      {attention
        ? <span className={`admin-severity is-${attention.severity}`}>{attention.severity === "high" ? "高优先级" : "需处理"}</span>
        : <span className="admin-severity">已离开待处置队列</span>}
    </div>

    <dl className="admin-workbench-detail__facts">
      <div><dt>发生了什么</dt><dd>{explanation}</dd></div>
      <div><dt>影响对象</dt><dd>{impactSummary}</dd></div>
      <div><dt>当前阶段</dt><dd>{task.stage ?? "阶段未知"}</dd></div>
      <div><dt>尝试次数</dt><dd>{task.attempt === null ? "未提供" : `${task.attempt} 次`}</dd></div>
      <div><dt>数据风险</dt><dd>{riskCopy(attention)}</dd></div>
      <div className="admin-workbench-detail__recommendation">
        <dt>建议操作</dt>
        <dd>
          <strong>{narrativeFailure
            ? "管理员不能直接重新执行叙事任务；请检查模型调用或由原世界重新发起。"
            : attention ? recommendationCopy[attention.recommendation] : "任务已离开当前待处置集合；请核对最新状态与审计记录。"}</strong>
          <small>{allowedActions.length
            ? `当前规则允许：${allowedActions.map((action) => actionLabels[action]).join("、")}`
            : "当前规则不允许管理员直接执行任务操作。"}</small>
        </dd>
      </div>
    </dl>

    <section className="admin-workbench-timeline" aria-labelledby="admin-task-timeline-title">
      <h3 id="admin-task-timeline-title">任务元数据</h3>
      <dl>
        <div><dt>创建</dt><dd><time dateTime={task.createdAt.toISOString()}>{formatMetadataTime(task.createdAt)}</time></dd></div>
        <div><dt>更新</dt><dd><time dateTime={task.updatedAt.toISOString()}>{formatMetadataTime(task.updatedAt)}</time></dd></div>
        {task.leaseExpiresAt && <div><dt>租约到期</dt><dd><time dateTime={task.leaseExpiresAt.toISOString()}>{formatMetadataTime(task.leaseExpiresAt)}</time></dd></div>}
        <div><dt>用户</dt><dd><span>{task.user.name}</span><code>{task.user.id}</code></dd></div>
        <div><dt>状态</dt><dd><code>{task.status}</code></dd></div>
      </dl>
    </section>

    {allowedActions.length > 0 && <div className="admin-workbench-actions" aria-label="允许的管理操作">
      {allowedActions.map((action) => <AdminActionButton
        key={action}
        label={taskActionCopy[action].label}
        targetLabel={targetLabel}
        currentState={currentState}
        impact={taskActionCopy[action].impact}
        danger={action === "cancel"}
        payload={{ targetType: "task", kind: task.kind, taskId: task.id, action }}
      />)}
    </div>}

    <nav className="admin-workbench-context-links" aria-label="任务上下文链接">
      <Link href={llmHref}>查看失败模型调用</Link>
      <Link href={auditHref}>查看管理审计</Link>
      {worldHref && <Link href={worldHref}>查看世界元数据</Link>}
    </nav>
  </aside>;
}
