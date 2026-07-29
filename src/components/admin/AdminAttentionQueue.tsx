import Link from "next/link";
import type { AdminAttentionTask, AdminTaskKind } from "@/lib/admin/task-attention";
import { taskSelectionKey } from "@/lib/admin/task-attention";

type WorkbenchView = "attention" | "failed" | "stale" | "repeated";
type WorkbenchLocation = { view: WorkbenchView; q: string; task: string | null };
type WorkbenchChanges = { view?: WorkbenchView; q?: string; task?: string | null };

type WorkbenchCounts = {
  attention: number;
  failed: number;
  stale: number;
  repeated: number;
  recoveredToday: number;
};

const taskLabels: Record<AdminTaskKind, string> = {
  genesis: "创世任务",
  narrative: "叙事生成",
  rewrite: "现实改写",
};

const reasonLabels: Record<AdminAttentionTask["reason"], string> = {
  failed: "失败",
  stale: "租约过期",
  repeated_failure: "连续失败",
};

const filters: Array<{ view: WorkbenchView; label: string; count: keyof Pick<WorkbenchCounts, "attention" | "failed" | "stale" | "repeated"> }> = [
  { view: "attention", label: "需要处理", count: "attention" },
  { view: "failed", label: "失败", count: "failed" },
  { view: "stale", label: "租约过期", count: "stale" },
  { view: "repeated", label: "连续失败", count: "repeated" },
];

export function workbenchHref(current: WorkbenchLocation, changes: WorkbenchChanges) {
  const params = new URLSearchParams({ view: changes.view ?? current.view });
  const q = changes.q ?? current.q;
  const task = changes.task === undefined ? current.task : changes.task;
  if (q) params.set("q", q);
  if (task) params.set("task", task);
  return `/admin?${params.toString()}`;
}

function taskMatchesView(task: AdminAttentionTask, view: WorkbenchView) {
  if (view === "failed") return task.status === "failed";
  if (view === "stale") return task.reason === "stale";
  if (view === "repeated") return task.reason === "repeated_failure";
  return true;
}

function formatElapsed(value: Date, now: Date) {
  const minutes = Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
  return minutes < 1 ? "刚刚" : `${minutes} 分钟前`;
}

export function AdminAttentionQueue({
  counts,
  items,
  selected,
  filters: current,
  now,
}: {
  counts: WorkbenchCounts;
  items: AdminAttentionTask[];
  selected: AdminAttentionTask | null;
  filters: WorkbenchLocation;
  now: Date;
}) {
  return <section className="admin-workbench-queue admin-panel" aria-labelledby="admin-workbench-queue-title">
    <div className="admin-workbench-queue__head">
      <div>
        <p className="admin-workbench-eyebrow">ATTENTION QUEUE</p>
        <h2 id="admin-workbench-queue-title">待处置任务</h2>
        <p>仅展示任务、用户与世界元数据，不展示用户正文。</p>
      </div>
      <span className="admin-workbench-recovered">今日已恢复 <strong>{counts.recoveredToday}</strong></span>
    </div>

    <nav className="admin-workbench-filters" aria-label="任务状态筛选">
      {filters.map((filter) => {
        const retainedTask = selected && taskMatchesView(selected, filter.view) ? taskSelectionKey(selected) : null;
        return <Link
          key={filter.view}
          href={workbenchHref(current, { view: filter.view, task: retainedTask })}
          aria-current={current.view === filter.view ? "page" : undefined}
          className={current.view === filter.view ? "is-active" : undefined}
        >
          <span>{filter.label}</span><strong>{counts[filter.count]}</strong>
        </Link>;
      })}
    </nav>

    <form action="/admin" method="get" className="admin-workbench-search" role="search">
      <input type="hidden" name="view" value={current.view} />
      <label htmlFor="admin-task-search">搜索任务元数据</label>
      <div>
        <input id="admin-task-search" name="q" type="search" defaultValue={current.q} placeholder="任务、用户或世界（至少 2 字）" />
        <button type="submit">筛选</button>
        {current.q && <Link href={workbenchHref(current, { q: "", task: selected ? taskSelectionKey(selected) : null })}>清除</Link>}
      </div>
    </form>

    {items.length ? <div className="admin-workbench-list">
      {items.map((task) => {
        const key = taskSelectionKey(task);
        const isSelected = selected ? taskSelectionKey(selected) === key : false;
        return <Link
          href={workbenchHref(current, { task: key })}
          aria-current={isSelected ? "true" : undefined}
          className={`admin-workbench-row ${isSelected ? "is-selected" : ""}`}
          key={key}
        >
          <span className={`admin-severity is-${task.severity}`}>{task.severity === "high" ? "高优先级" : "需处理"}</span>
          <span className="admin-workbench-row__identity">
            <strong>{task.world?.name ?? "未落地世界"}</strong>
            <small>{task.user.name} · {taskLabels[task.kind]}</small>
            <code>任务 {task.id}</code>
          </span>
          <span className="admin-workbench-row__reason">
            <strong>{reasonLabels[task.reason]}</strong>
            <small>{task.stage ?? "阶段未知"}</small>
          </span>
          <time dateTime={task.updatedAt.toISOString()}>{formatElapsed(task.updatedAt, now)}</time>
          <span className="admin-workbench-row__affordance">查看详情 <span aria-hidden="true">→</span></span>
        </Link>;
      })}
    </div> : <p className="admin-workbench-empty">当前筛选条件下没有需要处理的任务。</p>}
  </section>;
}
