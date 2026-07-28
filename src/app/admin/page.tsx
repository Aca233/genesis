import { AdminSection, EmptyState, MetricCard } from "@/components/admin/AdminShell";
import { loadAdminOverview } from "@/lib/admin/data";

function number(value: number) { return new Intl.NumberFormat("zh-CN").format(value); }
export default async function AdminOverviewPage() {
  const data = await loadAdminOverview();
  return <>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AdminSection title="用户"><div className="grid grid-cols-2 gap-3"><MetricCard label="总用户" value={number(data.users.total)} detail={`24h +${data.users.new24h}`} /><MetricCard label="有效会话" value={number(data.users.activeSessions)} detail={`封禁 ${data.users.banned}`} /></div></AdminSection>
      <AdminSection title="世界"><div className="grid grid-cols-2 gap-3"><MetricCard label="世界总数" value={number(data.worlds.total)} detail={`24h +${data.worlds.new24h}`} /><MetricCard label="游玩中" value={data.worlds.playing} detail={`草稿 ${data.worlds.draft} · 归档 ${data.worlds.archived}`} /></div></AdminSection>
      <AdminSection title="任务"><div className="grid grid-cols-2 gap-3"><MetricCard label="执行中" value={data.tasks.running} detail={`排队 ${data.tasks.queued}`} /><MetricCard label="异常" value={data.tasks.failed + data.tasks.stalled} detail={`失败 ${data.tasks.failed} · 失租 ${data.tasks.stalled}`} tone={data.tasks.failed + data.tasks.stalled ? "warn" : "good"} /></div></AdminSection>
      <AdminSection title="模型调用 · 24h"><div className="grid grid-cols-2 gap-3"><MetricCard label="调用 / 成功率" value={number(data.llm.calls)} detail={`${(data.llm.successRate * 100).toFixed(1)}% · ${data.llm.averageDurationMs}ms`} /><MetricCard label="缓存读取" value={number(data.llm.cacheReadTokens)} detail={`输入 ${number(data.llm.inputTokens)} · 输出 ${number(data.llm.outputTokens)}`} /></div></AdminSection>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <AdminSection title="最近失败任务" note="不展示任务输入、模型输出或世界正文">{data.recentFailures.length ? <div className="space-y-3">{data.recentFailures.map((item) => <article key={item.id} className="rounded-xl border border-cinnabar/20 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{item.world?.name ?? "未落地世界"}</strong><time className="text-xs text-ink-faint">{item.updatedAt.toLocaleString("zh-CN")}</time></div><p className="mt-2 text-sm text-cinnabar">{item.error}</p><p className="mt-1 text-xs text-ink-faint">阶段 {item.stage} · {item.user.name}</p></article>)}</div> : <EmptyState>近期待处理列表为空</EmptyState>}</AdminSection>
      <AdminSection title="系统健康" note="只读，不提供网页重启"><div className="grid grid-cols-2 gap-3"><MetricCard label="数据库" value={data.health.database ? "正常" : "异常"} tone={data.health.database ? "good" : "warn"} /><MetricCard label="进程运行" value={`${Math.floor(data.health.uptimeSeconds / 3600)}h`} detail={data.health.release} /><MetricCard label="Node RSS" value={`${Math.round(data.health.rssBytes / 1024 / 1024)} MB`} /><MetricCard label="主机内存" value={`${Math.round((data.health.totalMemoryBytes - data.health.freeMemoryBytes) / 1024 / 1024 / 1024 * 10) / 10} GB`} detail={`总计 ${Math.round(data.health.totalMemoryBytes / 1024 / 1024 / 1024 * 10) / 10} GB`} /><MetricCard label="磁盘可用" value={data.health.disk ? `${Math.round(data.health.disk.freeBytes / 1024 / 1024 / 1024 * 10) / 10} GB` : "不可用"} detail={data.health.disk ? `总计 ${Math.round(data.health.disk.totalBytes / 1024 / 1024 / 1024)} GB` : undefined} /><MetricCard label="Swap 可用" value={data.health.swap ? `${Math.round(data.health.swap.freeBytes / 1024 / 1024)} MB` : "不可用"} detail={data.health.swap ? `总计 ${Math.round(data.health.swap.totalBytes / 1024 / 1024)} MB` : undefined} /></div></AdminSection>
    </div>
  </>;
}
