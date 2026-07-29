import Link from "next/link";
import { AdminFilter, inputClass, PageNav } from "@/components/admin/AdminList";
import { AdminSection, EmptyState } from "@/components/admin/AdminShell";
import { listAdminLlmCalls } from "@/lib/admin/data";
import { parseAdminPage } from "@/lib/admin/security";

const number = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("zh-CN").format(value);
const labelClass = "grid gap-1 text-xs text-ink-soft";

export default async function AdminLlmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const page = parseAdminPage(query);
  const ok = query.get("ok") || "all";
  const task = query.get("task")?.trim() || "all";
  const userId = query.get("userId")?.trim() || "";
  const worldId = query.get("worldId")?.trim() || "";
  const hasFilters = ok !== "all" || task !== "all" || Boolean(userId || worldId);
  const data = await listAdminLlmCalls({ ...page, search: "", ok, task, userId, worldId });
  return <AdminSection title="模型观测" note="只读调用元数据；不展示 Prompt、Response 或密钥">
    <AdminFilter>
      <label className={labelClass}><span>调用结果</span><select name="ok" defaultValue={ok} className={inputClass}><option value="all">全部结果</option><option value="yes">成功</option><option value="no">失败</option></select></label>
      <label className={labelClass}><span>任务类型</span><input name="task" defaultValue={task === "all" ? "" : task} placeholder="留空为全部" className={inputClass} /></label>
      <label className={labelClass}><span>用户 ID</span><input name="userId" defaultValue={userId} placeholder="精确用户 ID" className={inputClass} /></label>
      <label className={labelClass}><span>世界 ID</span><input name="worldId" defaultValue={worldId} placeholder="精确世界 ID" className={inputClass} /></label>
    </AdminFilter>
    {data.items.length ? <div className="space-y-3">{data.items.map((call) => <article key={call.id} className="rounded-xl border border-gilt/20 bg-paper/45 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{call.provider ?? "未知提供商"} / {call.model ?? "未知模型"}</strong><span className={call.ok ? "text-emerald-700" : "text-cinnabar"}>{call.ok ? "成功" : "失败"}</span></div><p className="mt-1 text-xs text-ink-soft">{call.task} · {call.slot} · {call.durationMs}ms · {call.createdAt.toLocaleString("zh-CN")}</p><p className="mt-2 text-xs text-ink-soft">输入 {number(call.inputTokens)} · 输出 {number(call.outputTokens)} · 缓存读 {number(call.cacheReadTokens)} · 缓存写 {number(call.cacheWriteTokens)}</p>{call.error && <p className="mt-2 text-sm text-cinnabar">{call.error}</p>}<p className="mt-1 break-all text-[11px] text-ink-faint">用户 {call.userId ?? "—"} · 世界 {call.worldId ?? "—"}</p></article>)}</div> : <EmptyState>{hasFilters ? <>没有符合当前条件的记录。<Link href="/admin/llm" className="ml-2 underline">清除筛选</Link></> : "当前没有模型调用记录"}</EmptyState>}
    <PageNav page={page.page} pageSize={page.pageSize} total={data.total} pathname="/admin/llm" params={{ ok, task, userId, worldId }} />
  </AdminSection>;
}
