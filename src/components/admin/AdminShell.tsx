import Link from "next/link";
import { PlayBackground } from "@/components/play/PlayBackground";

const links = [
  ["/admin", "总览"], ["/admin/users", "用户"], ["/admin/worlds", "世界"],
  ["/admin/tasks", "任务"], ["/admin/llm", "模型"], ["/admin/audit", "审计"],
] as const;

export function AdminShell({ adminName, children }: { adminName: string; children: React.ReactNode }) {
  return <main className="relative min-h-screen overflow-x-hidden px-3 py-4 text-ink sm:px-6 lg:px-8">
    <PlayBackground variant="supporting" />
    <div className="relative z-10 mx-auto max-w-[96rem]">
      <header className="tome-plate tome-plate--corners mb-5 p-5 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="letterpress text-xs text-gilt">天文台总录</p><h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">创世管理面板</h1><p className="mt-2 text-sm text-ink-soft">管理员：{adminName} · 手动刷新 · 只读正文边界</p></div>
          <div className="flex flex-wrap gap-2"><Link href="/" className="seal-button px-4 py-2 text-sm">返回游戏</Link><Link href="/admin?refresh=1" className="seal-button seal-button--lit px-4 py-2 text-sm">刷新总览</Link></div>
        </div>
        <nav aria-label="管理面板" className="mt-5 flex gap-2 overflow-x-auto border-t border-gilt/20 pt-4">{links.map(([href,label]) => <Link key={href} href={href} className="shrink-0 rounded-full border border-gilt/25 bg-paper/55 px-4 py-2 text-sm text-ink-soft hover:border-gilt/60 hover:text-ink">{label}</Link>)}</nav>
      </header>
      {children}
    </div>
  </main>;
}

export function AdminSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="tome-plate mb-5 p-4 sm:p-6"><div className="mb-4"><h2 className="display-md">{title}</h2>{note && <p className="mt-1 text-xs text-ink-faint">{note}</p>}</div>{children}</section>;
}

export function MetricCard({ label, value, detail, tone = "normal" }: { label: string; value: string | number; detail?: string; tone?: "normal" | "good" | "warn" }) {
  return <div className={`rounded-xl border p-4 ${tone === "warn" ? "border-cinnabar/35 bg-cinnabar/5" : tone === "good" ? "border-emerald-700/30 bg-emerald-900/5" : "border-gilt/25 bg-paper/55"}`}><p className="letterpress text-[11px] text-ink-faint">{label}</p><p className="mt-2 font-display text-2xl font-bold">{value}</p>{detail && <p className="mt-1 text-xs text-ink-soft">{detail}</p>}</div>;
}

export function EmptyState({ children }: { children: React.ReactNode }) { return <p className="rounded-xl border border-dashed border-gilt/25 p-6 text-center text-sm text-ink-faint">{children}</p>; }
