import Link from "next/link";
import { AdminActionButton } from "@/components/admin/AdminActionButton";
import { AdminFilter, inputClass, PageNav } from "@/components/admin/AdminList";
import { AdminSection, EmptyState } from "@/components/admin/AdminShell";
import { taskActionCopy } from "@/lib/admin/action-form";
import { allowedAdminTaskActions, deriveTaskAttention } from "@/lib/admin/task-attention";
import { listAdminTasks } from "@/lib/admin/data";
import { parseAdminPage } from "@/lib/admin/security";

const taskFlag = (query: URLSearchParams, name: string) => query.get(name) === "yes" ? "yes" : "no";
const labelClass = "grid gap-1 text-xs text-ink-soft";

export default async function AdminTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const page = parseAdminPage(query);
  const search = query.get("search")?.trim() ?? "";
  const kind = query.get("kind") ?? "all";
  const status = query.get("status") ?? "all";
  const attention = taskFlag(query, "attention");
  const stale = taskFlag(query, "stale");
  const repeated = taskFlag(query, "repeated");
  const hasFilters = Boolean(search || kind !== "all" || status !== "all" || attention === "yes" || stale === "yes" || repeated === "yes");
  const now = new Date();
  const data = await listAdminTasks({ ...page, search, kind, status, attention, stale, repeated });

  return <AdminSection title="任务仪轨" note="任务输入与原始输出不会进入后台">
    <AdminFilter>
      <label className={labelClass}><span>搜索任务</span><input name="search" defaultValue={search} placeholder="任务、用户或世界（至少 2 字符）" className={inputClass} /></label>
      <label className={labelClass}><span>任务类型</span><select name="kind" defaultValue={kind} className={inputClass}>
        <option value="all">全部任务</option><option value="genesis">创世任务</option><option value="narrative">叙事生成</option><option value="rewrite">现实改写</option>
      </select></label>
      <label className={labelClass}><span>任务状态</span><select name="status" defaultValue={status} className={inputClass}>
        <option value="all">全部状态</option><option value="queued">排队</option><option value="pending">执行中（叙事）</option><option value="running">执行中（创世）</option><option value="repairing">修复中</option><option value="planning">规划中</option><option value="applying">应用中</option><option value="narrating">叙述中</option><option value="failed">失败</option><option value="cancelled">已取消</option><option value="completed">已完成</option>
      </select></label>
      <label className={labelClass}><span>需要处理</span><select name="attention" defaultValue={attention} className={inputClass}><option value="no">不限</option><option value="yes">仅需要处理</option></select></label>
      <label className={labelClass}><span>疑似失租</span><select name="stale" defaultValue={stale} className={inputClass}><option value="no">不限</option><option value="yes">仅疑似失租</option></select></label>
      <label className={labelClass}><span>连续失败</span><select name="repeated" defaultValue={repeated} className={inputClass}><option value="no">不限</option><option value="yes">仅连续失败</option></select></label>
    </AdminFilter>
    {data.items.length ? <div className="space-y-3">{data.items.map((task) => {
      const isStale = deriveTaskAttention(task, now)?.reason === "stale";
      const allowedActions = allowedAdminTaskActions(task, now);
      const title = task.kind === "genesis" ? "创世任务" : task.kind === "narrative" ? "叙事生成" : "现实改写";
      const targetLabel = `${title} · ${task.world?.name ?? task.id}`;
      const currentState = `${task.status} · ${task.stage ?? "阶段未知"}`;
      return <article key={`${task.kind}:${task.id}`} className="rounded-xl border border-gilt/20 bg-paper/45 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <strong>{title}</strong>
              <span className="rounded-full border border-gilt/25 px-2 py-0.5 text-xs">{task.status}</span>
              {isStale && <span className="rounded-full border border-cinnabar/35 px-2 py-0.5 text-xs text-cinnabar">疑似失租</span>}
            </div>
            <p className="mt-1 text-sm text-ink-soft">{task.world?.name ?? "未落地世界"} · {task.user.name} · {task.user.email}</p>
            <p className="mt-1 break-all text-xs text-ink-faint">{task.id}</p>
            {task.error && <p className="mt-2 text-sm text-cinnabar">{task.error}</p>}
            <p className="mt-2 text-xs text-ink-faint">阶段 {task.stage} · 更新 {task.updatedAt.toLocaleString("zh-CN")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {allowedActions.map((action) => <AdminActionButton
              key={action}
              label={taskActionCopy[action].label}
              targetLabel={targetLabel}
              currentState={currentState}
              impact={taskActionCopy[action].impact}
              danger={action === "cancel"}
              payload={{ targetType: "task", kind: task.kind, taskId: task.id, action }}
            />)}
          </div>
        </div>
      </article>;
    })}</div> : <EmptyState>{hasFilters ? <>没有符合当前条件的记录。<Link href="/admin/tasks" className="ml-2 underline">清除筛选</Link></> : "当前没有任务记录"}</EmptyState>}
    <PageNav page={page.page} pageSize={page.pageSize} total={data.total} pathname="/admin/tasks" params={{ search, kind, status, attention, stale, repeated }} />
  </AdminSection>;
}
