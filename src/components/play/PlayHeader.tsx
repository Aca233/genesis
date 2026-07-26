import Link from "next/link";
import { IconThemeControl, type IconThemeSummary } from "@/components/icons/IconThemeControl";

export function PlayHeader({
  worldName,
  era,
  time,
  worldId,
  iconTheme,
  iconThemeRevision,
  onThemeChanged,
}: {
  worldName: string;
  era: string;
  time: string;
  worldId?: string;
  iconTheme?: IconThemeSummary;
  iconThemeRevision?: number;
  onThemeChanged?: () => void | Promise<void>;
}) {
  return (
    <header className="pointer-events-none sticky top-0 z-20 grid grid-cols-[auto_1fr_auto] items-center bg-gradient-to-b from-[var(--paper)] via-[var(--paper)]/80 to-transparent px-3 pb-2 pt-2 sm:px-6">
      <Link
        href="/"
        aria-label="返回主菜单"
        className="pointer-events-auto rounded border border-line bg-paper-raised/80 px-2.5 py-1 text-xs text-ink-soft shadow-sm transition hover:border-gilt/50 hover:text-gilt"
      >
        ← 主菜单
      </Link>
      <span
        className="pointer-events-auto min-w-0 truncate px-3 text-center text-sm tracking-widest text-ink-faint"
        style={{ fontFamily: "var(--font-display)" }}
        title={`${worldName} · ${era} · ${time}`}
      >
        {worldName} · {era} · {time}
      </span>
      {worldId && iconTheme ? (
        <div className="pointer-events-auto hidden min-w-[22rem] sm:block">
          <IconThemeControl worldId={worldId} initialTheme={iconTheme} initialRevision={iconThemeRevision ?? 0} playing compact onChanged={onThemeChanged} />
        </div>
      ) : <span aria-hidden="true" className="w-[72px]" />}
    </header>
  );
}
