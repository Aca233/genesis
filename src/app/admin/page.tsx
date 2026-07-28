import Link from "next/link";
import { AdminSection, EmptyState, MetricCard } from "@/components/admin/AdminShell";
import { loadAdminDashboard } from "@/lib/admin/dashboard";

const number = (value: number) => new Intl.NumberFormat("zh-CN", { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
const percent = (value: number) => (value * 100).toFixed(value >= 0.1 ? 0 : 1) + "%";
const dateTime = (value: Date) => value.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const taskNames: Record<string, string> = { genesis: "创世", narrative: "叙事", rewrite: "重写", settlement: "结算", reroll: "重掷", pantheon: "万神殿", extract: "提取", chronicle: "编年史", test: "测试" };
const worldModes: Record<string, string> = { pantheon: "万神殿", creator: "创世主" };

function TrendBars({ values }: { values: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...values.map((item) => item.count));
  return <div className="admin-trend" aria-label="最近七日趋势">{values.map((item) => <div key={item.date} title={item.date + "：" + item.count}><span style={{ height: Math.max(6, item.count / max * 100) + "%" }} /><small>{item.date.slice(8)}</small></div>)}</div>;
}

function ResourceBar({ label, value, detail, warn = false }: { label: string; value: number | null; detail: string; warn?: boolean }) {
  return <div className="admin-resource"><div><strong>{label}</strong><span>{detail}</span></div><div className="admin-resource__track"><span className={warn ? "is-warn" : ""} style={{ width: Math.min(100, Math.max(0, (value ?? 0) * 100)) + "%" }} /></div><b>{value === null ? "不可用" : percent(value)}</b></div>;
}

export default async function AdminOverviewPage() {
  const data = await loadAdminDashboard();
  const statusLabel = { healthy: "运行正常", warning: "需要关注", critical: "严重告警" }[data.status];
  const totalTokens = data.llm.inputTokens + data.llm.outputTokens + data.llm.cacheReadTokens + data.llm.cacheWriteTokens;
  const liveWorlds = Math.max(1, data.worlds.draft + data.worlds.playing + data.worlds.concluded);
  return <div className="admin-dashboard">
    <section className={"admin-command admin-command--" + data.status}>
      <div className="admin-command__status"><span className="admin-command__pulse" /><div><p>PLATFORM STATUS</p><h1>{statusLabel}</h1><span>{data.status === "healthy" ? "关键服务和任务流水线未发现阻塞" : data.issues.length + " 项待处理事项需要值守人员关注"}</span></div></div>
      <div className="admin-command__facts">
        <div><small>数据库</small><strong>{data.health.database ? "正常 · " + data.health.databaseLatencyMs + "ms" : "连接异常"}</strong></div>
        <div><small>服务运行</small><strong>{Math.floor(data.health.uptimeSeconds / 3600)}h {Math.floor(data.health.uptimeSeconds % 3600 / 60)}m</strong></div>
        <div><small>当前版本</small><strong>{data.health.release}</strong></div>
        <div><small>统计刷新</small><strong>{dateTime(data.generatedAt)}</strong></div>
      </div>
    </section>

    <div className="admin-kpi-grid">
      <MetricCard label="注册用户" value={number(data.users.total)} detail={"24h +" + data.users.new24h + " · 7日 +" + data.users.new7d} />
      <MetricCard label="活跃用户 / 会话" value={number(data.users.activeUsers) + " / " + number(data.users.activeSessions)} detail={"管理员 " + data.users.admins + " · 封禁 " + data.users.banned} tone={data.users.banned ? "warn" : "normal"} />
      <MetricCard label="世界总量" value={number(data.worlds.total)} detail={"游玩中 " + data.worlds.playing + " · 完结 " + data.worlds.concluded} />
      <MetricCard label="任务运行 / 排队" value={data.tasks.running + " / " + data.tasks.queued} detail={"失败 " + data.tasks.failed + " · 失租 " + data.tasks.stalled} tone={data.tasks.failed || data.tasks.stalled ? "warn" : "good"} />
      <MetricCard label="模型成功率 · 24h" value={percent(data.llm.successRate)} detail={number(data.llm.calls) + " 次 · P95 " + number(data.llm.percentile95Ms) + "ms"} tone={data.llm.successRate < 0.97 ? "warn" : "good"} />
      <MetricCard label="Token 流量 · 24h" value={number(totalTokens)} detail={"缓存读取 " + number(data.llm.cacheReadTokens) + " · 回退 " + data.llm.cacheFallbacks} />
    </div>

    <div className="admin-main-grid">
      <AdminSection title="值守待办" note="按影响程度自动生成，不需要从统计卡中自行寻找问题" action={<Link href="/admin/tasks" className="admin-text-link">进入任务台 →</Link>}>
        {data.issues.length ? <div className="admin-issue-list">{data.issues.map((issue, index) => <Link href={issue.href} key={issue.title + index} className={"admin-issue admin-issue--" + issue.severity}><span>{issue.severity === "critical" ? "严重" : "注意"}</span><div><strong>{issue.title}</strong><p>{issue.detail}</p></div><b>处理 →</b></Link>)}</div> : <div className="admin-all-clear"><span>✓</span><div><strong>暂无待处理告警</strong><p>数据库、任务租约、模型成功率和主机资源均在设定阈值内。</p></div></div>}
      </AdminSection>
      <AdminSection title="平台脉搏" note="最近七日新增，按 UTC 自然日归档">
        <div className="admin-dual-trend"><div><div><strong>用户增长</strong><b>7日 +{data.users.new7d}</b></div><TrendBars values={data.users.trend} /></div><div><div><strong>世界创建</strong><b>7日 +{data.worlds.new7d}</b></div><TrendBars values={data.worlds.trend} /></div></div>
      </AdminSection>
    </div>

    <AdminSection title="任务流水线" note="创世、叙事生成和现实重写分别统计；异常不会再被合并掩盖" action={<Link href="/admin/tasks" className="admin-text-link">查看全部任务 →</Link>}>
      <div className="admin-pipeline-grid">{data.tasks.pipelines.map((item) => {
        const dailyTotal = item.completed24h + item.failed24h;
        return <article key={item.key} className="admin-pipeline"><header><div><small>{item.key.toUpperCase()}</small><h3>{item.label}</h3></div><span className={item.stalled ? "is-critical" : item.failed ? "is-warning" : "is-good"}>{item.stalled ? "租约异常" : item.failed ? "存在失败" : "流转正常"}</span></header><div className="admin-pipeline__flow"><div><small>排队</small><strong>{item.queued}</strong></div><i>→</i><div><small>运行</small><strong>{item.running}</strong></div><i>→</i><div><small>累计完成</small><strong>{number(item.completed)}</strong></div></div><div className="admin-pipeline__foot"><span>24h 完成 <b>{item.completed24h}</b></span><span>24h 成功 <b>{dailyTotal ? percent(item.completed24h / dailyTotal) : "—"}</b></span><span>失败 <b>{item.failed}</b></span><span>失租 <b>{item.stalled}</b></span></div></article>;
      })}</div>
    </AdminSection>

    <div className="admin-split-grid">
      <AdminSection title="用户与世界态势" note="身份活跃、世界状态和创世模式分布">
        <div className="admin-state-grid"><div><span>活跃率</span><strong>{percent(data.users.activeUsers / Math.max(1, data.users.total))}</strong><small>{data.users.activeUsers} 位用户存在有效会话</small></div><div><span>草稿转化</span><strong>{percent((data.worlds.playing + data.worlds.concluded) / liveWorlds)}</strong><small>{data.worlds.draft} 个草稿尚未进入游玩</small></div><div><span>长期未更新</span><strong>{data.worlds.stale}</strong><small>30 天以上无活动</small></div><div><span>已归档世界</span><strong>{data.worlds.archived ?? "—"}</strong><small>{data.worlds.archived === null ? "当前数据库尚未启用归档字段" : "不计入当前状态分布"}</small></div></div>
        <div className="admin-distribution"><div className="admin-distribution__bar"><span className="is-draft" style={{ width: percent(data.worlds.draft / liveWorlds) }} /><span className="is-playing" style={{ width: percent(data.worlds.playing / liveWorlds) }} /><span className="is-concluded" style={{ width: percent(data.worlds.concluded / liveWorlds) }} /></div><div><span>草稿 {data.worlds.draft}</span><span>游玩 {data.worlds.playing}</span><span>完结 {data.worlds.concluded}</span></div></div>
        <div className="admin-mode-list">{data.worlds.modes.map((item) => <div key={item.mode}><span>{worldModes[item.mode] ?? item.mode}</span><b>{item.count}</b><i><span style={{ width: percent(item.count / Math.max(1, data.worlds.total)) }} /></i></div>)}</div>
      </AdminSection>
      <AdminSection title="平台内容规模" note="只统计结构数量，不读取任何用户正文">
        <div className="admin-content-metrics">{Object.entries({ "时间线": data.content.timelines, "章节": data.content.chapters, "消息": data.content.messages, "神祇": data.content.gods, "实体": data.content.entities, "能力": data.content.abilities, "编年史": data.content.chronicles, "材料卡": data.content.materials }).map(([label, value]) => <div key={label}><span>{label}</span><strong>{number(value)}</strong></div>)}</div>
      </AdminSection>
    </div>

    <AdminSection title="模型调用观测 · 24h" note="可靠性、延迟、Token 和缓存表现按业务与模型拆分" action={<Link href="/admin/llm" className="admin-text-link">查看调用明细 →</Link>}>
      <div className="admin-model-summary"><div><small>平均延迟</small><strong>{number(data.llm.averageDurationMs)}ms</strong></div><div><small>P95 延迟</small><strong>{number(data.llm.percentile95Ms)}ms</strong></div><div><small>最慢调用</small><strong>{number(data.llm.slowestDurationMs)}ms</strong></div><div><small>输入 / 输出</small><strong>{number(data.llm.inputTokens)} / {number(data.llm.outputTokens)}</strong></div><div><small>缓存写入</small><strong>{number(data.llm.cacheWriteTokens)}</strong></div><div><small>动态 / 工具</small><strong>{number(data.llm.dynamicTokens)} / {number(data.llm.toolResultTokens)}</strong></div></div>
      <div className="admin-table-grid"><div><h3>按业务任务</h3><div className="admin-data-table">{data.llm.tasks.slice(0, 8).map((item) => <div key={item.task}><strong>{taskNames[item.task] ?? item.task}</strong><span>{number(item.calls)} 次</span><span>{percent(item.successRate)}</span><span>{number(item.averageDurationMs)}ms</span><b>{number(item.tokens)} tk</b></div>)}</div></div><div><h3>按 Provider / Model</h3><div className="admin-data-table">{data.llm.models.slice(0, 8).map((item) => <div key={item.provider + item.model}><strong title={item.provider + " / " + item.model}>{item.provider} / {item.model}</strong><span>{number(item.calls)} 次</span><span>{percent(item.successRate)}</span><span>{number(item.averageDurationMs)}ms</span><b>{number(item.tokens)} tk</b></div>)}</div></div></div>
    </AdminSection>

    <div className="admin-split-grid admin-split-grid--health">
      <AdminSection title="系统资源水位" note="网页端只读，不提供进程重启或主机命令">
        <div className="admin-resource-list"><ResourceBar label="主机内存" value={data.health.memoryUsedRate} detail={number((data.health.totalMemoryBytes - data.health.freeMemoryBytes) / 1024 / 1024 / 1024) + " / " + number(data.health.totalMemoryBytes / 1024 / 1024 / 1024) + " GB"} warn={data.health.memoryUsedRate >= 0.85} /><ResourceBar label="磁盘空间" value={data.health.diskUsedRate} detail={data.health.disk ? number((data.health.disk.totalBytes - data.health.disk.freeBytes) / 1024 / 1024 / 1024) + " / " + number(data.health.disk.totalBytes / 1024 / 1024 / 1024) + " GB" : "无法读取"} warn={(data.health.diskUsedRate ?? 0) >= 0.85} /><ResourceBar label="Swap" value={data.health.swap ? (data.health.swap.totalBytes - data.health.swap.freeBytes) / Math.max(1, data.health.swap.totalBytes) : null} detail={data.health.swap ? number((data.health.swap.totalBytes - data.health.swap.freeBytes) / 1024 / 1024) + " / " + number(data.health.swap.totalBytes / 1024 / 1024) + " MB" : "当前平台不提供"} /></div>
        <div className="admin-health-foot"><span>Node RSS <b>{number(data.health.rssBytes / 1024 / 1024)} MB</b></span><span>系统负载 <b>{data.health.loadAverage.map((value) => value.toFixed(2)).join(" / ")}</b></span><span>数据库探测 <b>{data.health.databaseLatencyMs ?? "—"} ms</b></span></div>
      </AdminSection>
      <AdminSection title="最近注册用户" note="账号元数据与资源计数" action={<Link href="/admin/users" className="admin-text-link">全部用户 →</Link>}>
        <div className="admin-compact-list">{data.users.recent.map((user) => <article key={user.id}><span className="admin-avatar">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div><span>{user._count.worlds} 世界 · {user._count.sessions} 会话</span><time>{dateTime(user.createdAt)}</time></article>)}</div>
      </AdminSection>
    </div>

    <div className="admin-event-grid">
      <AdminSection title="最近失败任务" note="跨三类任务聚合，错误信息已经脱敏">{data.recentFailures.length ? <div className="admin-event-list">{data.recentFailures.map((item) => <article key={item.kind + item.id}><span className="admin-event-kind is-error">{taskNames[item.kind]}</span><div><strong>{item.world?.name ?? "未落地世界"}</strong><p>{item.error}</p><small>阶段 {item.stage} · {item.user.name}{item.attempt !== null ? " · 尝试 " + item.attempt : ""}</small></div><time>{dateTime(item.updatedAt)}</time></article>)}</div> : <EmptyState>暂无失败任务</EmptyState>}</AdminSection>
      <AdminSection title="最近活跃世界" note="按元数据更新时间排序" action={<Link href="/admin/worlds" className="admin-text-link">全部世界 →</Link>}>{data.worlds.recent.length ? <div className="admin-event-list">{data.worlds.recent.map((world) => <article key={world.id}><span className="admin-event-kind">{worldModes[world.mode] ?? world.mode}</span><div><strong>{world.name}</strong><p>{world.user.name} · {world._count.timelines} 时间线 · {world._count.rewrites} 次重写</p><small>{world.status}</small></div><time>{dateTime(world.updatedAt)}</time></article>)}</div> : <EmptyState>暂无世界</EmptyState>}</AdminSection>
      <AdminSection title="最近管理操作" note="高风险操作与失败记录均保留追踪" action={<Link href="/admin/audit" className="admin-text-link">完整审计 →</Link>}>{data.recentAudits.length ? <div className="admin-event-list">{data.recentAudits.map((audit) => <article key={audit.id}><span className={"admin-event-kind " + (audit.success ? "" : "is-error")}>{audit.action}</span><div><strong>{audit.targetLabel}</strong><p>{audit.reason}</p><small>{audit.actor?.name ?? "已删除管理员"} · {audit.requestIp ?? "无 IP"}</small></div><time>{dateTime(audit.createdAt)}</time></article>)}</div> : <EmptyState>暂无管理操作</EmptyState>}</AdminSection>
    </div>
  </div>;
}
