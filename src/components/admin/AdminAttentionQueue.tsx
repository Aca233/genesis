import Link from "next/link";
import type { AdminAttentionTask, AdminTaskKind, AdminTaskSnapshot } from "@/lib/admin/task-attention";
import { taskSelectionKey } from "@/lib/admin/task-attention";

type WorkbenchView = "attention" | "failed" | "stale" | "repeated";
type WorkbenchLocation = { view: WorkbenchView; q: string; task: string | null };
type WorkbenchChanges = { view?: WorkbenchView; q?: string; task?: string | null };

type WorkbenchCounts = {
  attention: number;
  failed: number;
  stale: number;
  repeated: number;
  recoveredToday: { state: "ready"; value: number } | { state: "unavailable" };
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

function formatElapsed(value: Date, now: Date) {
  const minutes = Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
  return minutes < 1 ? "刚刚" : `${minutes} 分钟前`;
}

export function AdminAttentionQueue({
  counts,
  items,
  total,
  hasMore,
  selected,
  filters: current,
  now,
}: {
  counts: WorkbenchCounts;
  items: AdminAttentionTask[];
  total: number;
  hasMore: boolean;
  selected: Pick<AdminTaskSnapshot, "kind" | "id"> | null;
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
      <span className="admin-workbench-recovered">今日已恢复 {counts.recoveredToday.state === "ready"
        ? <strong>{counts.recoveredToday.value}</strong>
        : <strong>数据暂不可用</strong>}</span>
    </div>

    <nav className="admin-workbench-filters" aria-label="任务状态筛选">
      {filters.map((filter) => <Link
          key={filter.view}
          href={workbenchHref(current, { view: filter.view, task: null })}
          aria-current={current.view === filter.view ? "page" : undefined}
          className={current.view === filter.view ? "is-active" : undefined}
        >
          <span>{filter.label}</span><strong>{counts[filter.count]}</strong>
        </Link>)}
    </nav>

    <form action="/admin" method="get" className="admin-workbench-search" role="search">
      <input type="hidden" name="view" value={current.view} />
      {selected && <input type="hidden" name="task" value={taskSelectionKey(selected)} />}
      <label htmlFor="admin-task-search">搜索任务元数据</label>
      <div>
        <input id="admin-task-search" name="q" type="search" defaultValue={current.q} placeholder="任务、用户或世界（至少 2 字）" />
        <button type="submit">筛选</button>
        {current.q && <Link href={workbenchHref(current, { q: "", task: selected ? taskSelectionKey(selected) : null })}>清除</Link>}
      </div>
    </form>

    <div className="admin-workbench-queue__coverage">
      <span>{hasMore ? `当前展示前 ${items.length} 条 / 共 ${total} 条` : `当前展示 ${items.length} 条 / 共 ${total} 条`}</span>
      {hasMore && <Link href="/admin/tasks?attention=yes">查看完整集合</Link>}
    </div>

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
    </div> : current.view === "attention" && !current.q
      ? <p className="admin-workbench-empty">当前没有需要处理的任务</p>
      : <p className="admin-workbench-empty">没有符合当前条件的任务。<Link href="/admin">清除筛选</Link></p>}
  </section>;
}
