import { PageNav } from "@/components/admin/AdminList";
import { AdminSection, EmptyState } from "@/components/admin/AdminShell";
import { listAdminAudit } from "@/lib/admin/data";
import { parseAdminPage } from "@/lib/admin/security";

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const page = parseAdminPage(query);
  const data = await listAdminAudit({ ...page, search: "" });
  return <AdminSection title="管理审计" note="只记录元数据与状态变化，不保存用户正文或密钥">
    {data.items.length ? <div className="space-y-3">{data.items.map((log) => <article key={log.id} className="rounded-xl border border-gilt/20 bg-paper/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{log.action}</strong><span className={log.success ? "text-emerald-700" : "text-cinnabar"}>{log.success ? "成功" : "失败"}</span></div>
      <p className="mt-1 text-sm text-ink-soft">{log.actor ? `${log.actor.name}（${log.actor.email}）` : "已删除管理员"} → {log.targetType}：{log.targetLabel}</p>
      <p className="mt-2 text-sm">原因：{log.reason}</p>
      <p className="mt-2 break-all text-xs text-ink-faint">{log.targetId} · IP {log.requestIp ?? "—"} · {log.createdAt.toLocaleString("zh-CN")}</p>
    </article>)}</div> : <EmptyState>尚无管理操作记录</EmptyState>}
    <PageNav page={page.page} pageSize={page.pageSize} total={data.total} pathname="/admin/audit" params={{}} />
  </AdminSection>;
}
