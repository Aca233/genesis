"use client";

import Link from "next/link";
import type { DrawerTab } from "./types";

/**
 * 右缘符文列：五枚抽屉符文 + 香炉（Link → /settings）。
 * 桌面固定右缘垂直居中；窄屏落到底部横排。
 */

const RUNES: { tab: DrawerTab; glyph: string; label: string }[] = [
  { tab: "starmap", glyph: "✦", label: "星图" },
  { tab: "chronicle", glyph: "📜", label: "年表" },
  { tab: "god", glyph: "◈", label: "神格" },
  { tab: "lore", glyph: "📖", label: "设定集" },
  { tab: "codex", glyph: "👥", label: "众生录" },
];

export function RuneRail({
  active,
  onOpen,
}: {
  active: DrawerTab | null;
  onOpen: (tab: DrawerTab) => void;
}) {
  return (
    <nav
      className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1 rounded-l-lg border border-r-0 border-line bg-paper-raised/90 py-2 shadow max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:translate-y-0 max-sm:flex-row max-sm:justify-around max-sm:rounded-none max-sm:border max-sm:py-1"
      aria-label="符文列"
    >
      {RUNES.map((r) => (
        <button
          key={r.tab}
          onClick={() => onOpen(r.tab)}
          className={`group relative flex h-10 w-10 items-center justify-center text-lg transition ${
            active === r.tab ? "text-gilt" : "text-ink-soft hover:text-gilt"
          }`}
          title={r.label}
          aria-label={r.label}
        >
          <span>{r.glyph}</span>
          <span className="pointer-events-none absolute right-full mr-1 hidden whitespace-nowrap rounded border border-line bg-paper-raised px-1.5 py-0.5 text-xs text-ink-soft shadow-sm group-hover:block max-sm:group-hover:hidden">
            {r.label}
          </span>
        </button>
      ))}
      <Link
        href="/settings"
        className="group relative flex h-10 w-10 items-center justify-center text-lg text-ink-soft transition hover:text-gilt"
        title="香炉 · 设置"
        aria-label="香炉 · 设置"
      >
        <span>⚱</span>
        <span className="pointer-events-none absolute right-full mr-1 hidden whitespace-nowrap rounded border border-line bg-paper-raised px-1.5 py-0.5 text-xs text-ink-soft shadow-sm group-hover:block max-sm:group-hover:hidden">
          香炉
        </span>
      </Link>
    </nav>
  );
}
