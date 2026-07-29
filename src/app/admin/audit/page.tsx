import Link from "next/link";
import { AdminFilter, inputClass, PageNav } from "@/components/admin/AdminList";
import { AdminSection, EmptyState } from "@/components/admin/AdminShell";
import { listAdminAudit } from "@/lib/admin/data";
import { parseAdminPage } from "@/lib/admin/security";

const labelClass = "grid gap-1 text-xs text-ink-soft";

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const page = parseAdminPage(query);
  const targetId = query.get("targetId")?.trim() || "";
  const action = query.get("action")?.trim() || "all";
  const success = query.get("success") || "all";
  const hasFilters = Boolean(targetId || action !== "all" || success !== "all");
  const data = await listAdminAudit({ ...page, search: "", targetId, action, success });
  return <AdminSection title="管理审计" note="只记录元数据与状态变化，不保存用户正文或密钥">
    <AdminFilter>
      <label className={labelClass}><span>目标 ID</span><input name="targetId" defaultValue={targetId} placeholder="精确目标 ID" className={inputClass} /></label>
      <label className={labelClass}><span>操作</span><input name="action" defaultValue={action === "all" ? "" : action} placeholder="留空为全部" className={inputClass} /></label>
      <label className={labelClass}><span>执行结果</span><select name="success" defaultValue={success} className={inputClass}><option value="all">全部结果</option><option value="yes">成功</option><option value="no">失败</option></select></label>
    </AdminFilter>
    {data.items.length ? <div className="space-y-3">{data.items.map((log) => <article key={log.id} className="rounded-xl border border-gilt/20 bg-paper/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{log.action}</strong><span className={log.success ? "text-emerald-700" : "text-cinnabar"}>{log.success ? "成功" : "失败"}</span></div>
      <p className="mt-1 text-sm text-ink-soft">{log.actor ? `${log.actor.name}（${log.actor.email}）` : "已删除管理员"} → {log.targetType}：{log.targetLabel}</p>
      <p className="mt-2 text-sm">原因：{log.reason}</p>
      <p className="mt-2 break-all text-xs text-ink-faint">{log.targetId} · IP {log.requestIp ?? "—"} · {log.createdAt.toLocaleString("zh-CN")}</p>
    </article>)}</div> : <EmptyState>{hasFilters ? <>没有符合当前条件的记录。<Link href="/admin/audit" className="ml-2 underline">清除筛选</Link></> : "尚无管理操作记录"}</EmptyState>}
    <PageNav page={page.page} pageSize={page.pageSize} total={data.total} pathname="/admin/audit" params={{ targetId, action, success }} />
  </AdminSection>;
}
