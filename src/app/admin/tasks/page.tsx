import { AdminActionButton } from "@/components/admin/AdminActionButton";
import { AdminFilter, inputClass, PageNav } from "@/components/admin/AdminList";
import { AdminSection, EmptyState } from "@/components/admin/AdminShell";
import { listAdminTasks } from "@/lib/admin/data";
import { parseAdminPage } from "@/lib/admin/security";

export default async function AdminTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const page = parseAdminPage(query);
  const kind = query.get("kind") ?? "all";
  const status = query.get("status") ?? "all";
  const data = await listAdminTasks({ ...page, search: "", kind, status });
  return <AdminSection title="任务仪轨" note="任务输入与原始输出不会进入后台">
    <AdminFilter>
      <select name="kind" defaultValue={kind} className={inputClass}><option value="all">全部任务</option><option value="genesis">创世任务</option><option value="narrative">叙事生成</option><option value="rewrite">现实改写</option></select>
      <select name="status" defaultValue={status} className={inputClass}><option value="all">全部状态</option><option value="queued">排队</option><option value="pending">执行中（叙事）</option><option value="running">执行中（创世）</option><option value="failed">失败</option><option value="cancelled">已取消</option><option value="completed">已完成</option></select><span />
    </AdminFilter>
    {data.items.length ? <div className="space-y-3">{data.items.map((task) => {
      const stale = task.leaseExpiresAt !== null && task.leaseExpiresAt < new Date();
      const title = task.kind === "genesis" ? "创世任务" : task.kind === "narrative" ? "叙事生成" : "现实改写";
      return <article key={`${task.kind}:${task.id}`} className="rounded-xl border border-gilt/20 bg-paper/45 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
        <div><div className="flex flex-wrap gap-2"><strong>{title}</strong><span className="rounded-full border border-gilt/25 px-2 py-0.5 text-xs">{task.status}</span>{stale && <span className="rounded-full border border-cinnabar/35 px-2 py-0.5 text-xs text-cinnabar">疑似失租</span>}</div>
          <p className="mt-1 text-sm text-ink-soft">{task.world?.name ?? "未落地世界"} · {task.user.name} · {task.user.email}</p><p className="mt-1 break-all text-xs text-ink-faint">{task.id}</p>{task.error && <p className="mt-2 text-sm text-cinnabar">{task.error}</p>}<p className="mt-2 text-xs text-ink-faint">阶段 {task.stage} · 更新 {task.updatedAt.toLocaleString("zh-CN")}</p></div>
        <div className="flex flex-wrap gap-2">{task.kind !== "narrative" && task.status === "failed" && <AdminActionButton label="重试" payload={{ targetType: "task", kind: task.kind, taskId: task.id, action: "retry" }} />}{task.kind !== "narrative" && stale && <AdminActionButton label="恢复失租" payload={{ targetType: "task", kind: task.kind, taskId: task.id, action: "recover" }} />}{["queued", "pending", "running", "repairing", "planning", "applying", "narrating"].includes(task.status) && <AdminActionButton label="取消" danger payload={{ targetType: "task", kind: task.kind, taskId: task.id, action: "cancel" }} />}</div>
      </div></article>;
    })}</div> : <EmptyState>没有符合条件的任务</EmptyState>}
    <PageNav page={page.page} pageSize={page.pageSize} total={data.total} pathname="/admin/tasks" params={{ kind, status }} />
  </AdminSection>;
}
