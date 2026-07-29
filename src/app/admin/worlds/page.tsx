import { AdminActionButton } from "@/components/admin/AdminActionButton";
import { AdminFilter, inputClass, PageNav } from "@/components/admin/AdminList";
import { AdminSection, EmptyState } from "@/components/admin/AdminShell";
import { listAdminWorlds } from "@/lib/admin/data";
import { parseAdminPage } from "@/lib/admin/security";

const worldActionImpact = {
  archive: "归档世界并保留现有元数据；世界将不再作为活跃世界显示。",
  restore: "取消归档，使世界重新回到可用状态。",
  delete: "永久删除世界及其关联元数据，此操作不可撤销。",
} as const;

export default async function AdminWorldsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const page = parseAdminPage(query);
  const search = query.get("search") ?? "";
  const status = query.get("status") ?? "all";
  const archived = query.get("archived") ?? "all";
  const data = await listAdminWorlds({ ...page, search, status, archived });

  return <AdminSection title="世界总录" note="只显示世界元数据、状态与数量">
    <AdminFilter>
      <input name="search" defaultValue={search} placeholder="世界、ID 或所有者" className={inputClass} />
      <select name="status" defaultValue={status} className={inputClass}><option value="all">全部状态</option><option value="draft">草稿</option><option value="playing">游玩中</option><option value="concluded">已完结</option></select>
      <select name="archived" defaultValue={archived} className={inputClass}><option value="all">全部归档</option><option value="no">未归档</option><option value="yes">已归档</option></select>
    </AdminFilter>
    {data.items.length ? <div className="space-y-3">{data.items.map((world) => {
      const targetLabel = `${world.name} · ${world.id}`;
      return <article key={world.id} className="rounded-xl border border-gilt/20 bg-paper/45 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <strong className="text-lg">{world.name}</strong>
              <span className="rounded-full border border-gilt/25 px-2 py-0.5 text-xs">{world.status}</span>
              {world.archivedAt && <span className="rounded-full border border-cinnabar/25 px-2 py-0.5 text-xs">已归档</span>}
            </div>
            <p className="mt-1 text-sm text-ink-soft">{world.user.name} · {world.user.email}</p>
            <p className="mt-1 break-all text-xs text-ink-faint">{world.id}</p>
            <p className="mt-2 text-xs text-ink-soft">模式 {world.mode} · 时间线 {world._count.timelines} · 改写 {world._count.rewrites} · 更新 {world.updatedAt.toLocaleString("zh-CN")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {world.archivedAt
              ? <AdminActionButton label="恢复" targetLabel={targetLabel} impact={worldActionImpact.restore} payload={{ targetType: "world", worldId: world.id, action: "restore" }} />
              : <AdminActionButton label="归档" targetLabel={targetLabel} impact={worldActionImpact.archive} payload={{ targetType: "world", worldId: world.id, action: "archive" }} />}
            <AdminActionButton label="永久删除" targetLabel={targetLabel} impact={worldActionImpact.delete} danger confirmationLabel={world.name} payload={{ targetType: "world", worldId: world.id, action: "delete" }} />
          </div>
        </div>
      </article>;
    })}</div> : <EmptyState>没有符合条件的世界</EmptyState>}
    <PageNav page={page.page} pageSize={page.pageSize} total={data.total} pathname="/admin/worlds" params={{ search, status, archived }} />
  </AdminSection>;
}
