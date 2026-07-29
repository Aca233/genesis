import Link from "next/link";
import { PlayBackground } from "@/components/play/PlayBackground";
import { AdminNav } from "./AdminNav";
import { AdminRefreshButton } from "./AdminRefreshButton";

export function AdminShell({ adminName, attentionCount, children }: { adminName: string; attentionCount: number | null; children: React.ReactNode }) {
  return <main className="admin-shell relative min-h-screen overflow-x-hidden text-ink">
    <PlayBackground variant="supporting" />
    <div className="admin-shell__layout relative z-10">
      <aside className="admin-sidebar">
        <div>
          <Link href="/admin" className="admin-brand">
            <span className="admin-brand__sigil" aria-hidden="true">界</span>
            <span><small>GENESIS CONTROL</small><strong>创世中枢</strong></span>
          </Link>
          <p className="admin-sidebar__brief">运行态势、异常处置与管理审计。所有视图只读取元数据，不展示用户正文。</p>
          <AdminNav attentionCount={attentionCount} />
        </div>
        <div className="admin-identity">
          <span className="admin-identity__dot" />
          <div><small>当前值守</small><strong>{adminName}</strong></div>
          <Link href="/">返回游戏</Link>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div><p>管理中枢 / 任务处置</p><span>仅管理员可见 · 数据动态读取</span></div>
          <div className="admin-topbar__actions">
            <span className="admin-privacy-badge">正文边界已启用</span>
            <AdminRefreshButton />
          </div>
        </header>
        <div className="admin-mobile-nav"><AdminNav attentionCount={attentionCount} /></div>
        <div className="admin-content">{children}</div>
      </div>
    </div>
  </main>;
}

export function AdminSection({ title, note, action, className = "", children }: { title: string; note?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <section className={"admin-panel " + className}>
    <div className="admin-panel__head"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>
    {children}
  </section>;
}

export function MetricCard({ label, value, detail, tone = "normal" }: { label: string; value: string | number; detail?: string; tone?: "normal" | "good" | "warn" }) {
  return <div className={"admin-metric admin-metric--" + tone}><p>{label}</p><strong>{value}</strong>{detail && <span>{detail}</span>}</div>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="admin-empty">{children}</p>;
}
