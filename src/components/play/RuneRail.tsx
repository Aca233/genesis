"use client";

import Link from "next/link";
import type { DrawerTab, WorldInfo } from "./types";
import { drawerTabsForMode } from "./reality-tree-state";

/**
 * 右缘符文列：五枚抽屉符文 + 香炉（Link → /settings）。
 * 桌面固定右缘垂直居中；窄屏落到底部横排。
 */

export function RuneRail({
  mode = "pantheon",
  active,
  unreadActivityCount = 0,
  onOpen,
}: {
  mode?: WorldInfo["mode"];
  active: DrawerTab | null;
  unreadActivityCount?: number;
  onOpen: (tab: DrawerTab) => void;
}) {
  const runes = drawerTabsForMode(mode);
  return (
    <nav
      // z-[60] 高于抽屉（z-50）：抽屉展开时符文列仍可点击、可直接换页签
      className="fixed right-0 top-1/2 z-[60] flex -translate-y-1/2 flex-col gap-1 rounded-l-lg border border-r-0 border-line bg-paper-raised/95 py-2 shadow-lg max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:translate-y-0 max-sm:flex-row max-sm:justify-around max-sm:rounded-none max-sm:border max-sm:py-1"
      aria-label="符文列"
    >
      {runes.map((r) => (
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
          {r.tab === "activity" && unreadActivityCount > 0 ? (
            <span
              className="absolute right-0 top-0 min-w-3 rounded-full bg-gilt px-0.5 text-center text-[8px] leading-3 text-paper"
              aria-label={`${unreadActivityCount} 条未读动态`}
            >
              {unreadActivityCount > 9 ? "9+" : unreadActivityCount}
            </span>
          ) : null}
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
