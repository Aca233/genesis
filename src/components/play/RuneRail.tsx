"use client";

import { Fragment } from "react";
import Link from "next/link";
import type { DrawerTab, WorldInfo } from "./types";
import { drawerTabsForMode } from "./reality-tree-state";
import { OperationIcon } from "@/components/icons/OperationIcon";
import { WorldIcon, type SvgIconData } from "@/components/icons/WorldIcon";

const FALLBACK_NAV_ICON: SvgIconData = {
  body: "<circle cx=\"12\" cy=\"12\" r=\"7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"M12 5v14M5 12h14\" stroke=\"currentColor\" stroke-width=\"1.5\"/>",
  width: 24,
  height: 24,
};

/**
 * 语义符文簇：镌刻分组的依据。
 * 记事（编年史/众生录/设定集）· 神明（神格/动态/星图）· 现实（诸相/天外视界）；
 * 香炉（设置）单列为末簇。不在任何簇中的新符文兜底进「其他」，保证全部可达。
 */
const RUNE_CLUSTERS: readonly { name: string; tabs: readonly DrawerTab[] }[] = [
  { name: "记事", tabs: ["chronicle", "codex", "lore"] },
  { name: "神明", tabs: ["god", "activity", "starmap"] },
  { name: "现实", tabs: ["realities", "creator"] },
];

/** 簇间发丝弦：桌面横向鎏金细弦，移动端立式短弦。 */
function ClusterDivider() {
  return (
    <span
      aria-hidden
      className="mx-auto my-0.5 h-px w-6 shrink-0 bg-gradient-to-r from-transparent via-gilt/45 to-transparent max-sm:mx-1 max-sm:my-0 max-sm:h-6 max-sm:w-px max-sm:self-center max-sm:bg-gradient-to-b"
    />
  );
}

/**
 * 右缘符文列：抽屉符文按语义簇镌刻分组 + 香炉（Link → /settings）。
 * 桌面固定右缘垂直居中，外缘垂一缕鎏金细丝；窄屏落到底部横排，
 * 溢出时横向滚动而不压缩符文（44px 起的触达面积）。
 */

export function RuneRail({
  mode = "pantheon",
  active,
  unreadActivityCount = 0,
  icons = {},
  onOpen,
}: {
  mode?: WorldInfo["mode"];
  active: DrawerTab | null;
  unreadActivityCount?: number;
  icons?: Partial<Record<DrawerTab, SvgIconData>>;
  onOpen: (tab: DrawerTab) => void;
}) {
  const runes = drawerTabsForMode(mode);
  const byTab = new Map(runes.map((r) => [r.tab, r]));
  const clusteredTabs = new Set<DrawerTab>(RUNE_CLUSTERS.flatMap((c) => [...c.tabs]));
  const orphans = runes.filter((r) => !clusteredTabs.has(r.tab));
  const clusters = [
    ...RUNE_CLUSTERS.map((cluster) => ({
      name: cluster.name,
      runes: cluster.tabs.flatMap((tab) => byTab.get(tab) ?? []),
    })),
    { name: "其他", runes: orphans },
  ].filter((cluster) => cluster.runes.length > 0);

  return (
    <nav
      // z-[60] 高于抽屉（z-50）：抽屉展开时符文列仍可点击、可直接换页签
      className="fixed right-0 top-1/2 z-[60] -translate-y-1/2 rounded-l-xl border border-r-0 border-gilt/35 bg-paper-raised/95 px-1 py-2 shadow-[-0.5rem_0_1.5rem_var(--shadow-warm),inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_85%,transparent)] [background-image:var(--fiber-noise),linear-gradient(180deg,color-mix(in_srgb,var(--paper-raised)_96%,transparent),color-mix(in_srgb,var(--paper)_88%,transparent))] max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:translate-y-0 max-sm:rounded-none max-sm:border max-sm:px-0 max-sm:py-1"
      aria-label="符文列"
    >
      {/* 折缘内衬发丝线：书签绦带的双重描边 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-1 rounded-l-lg border border-gilt/15 border-r-transparent max-sm:rounded-none max-sm:border-r-gilt/15"
      />
      {/* 外缘鎏金细丝：桌面书口镀金的一缕垂弦 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-2 right-0.5 w-px bg-gradient-to-b from-transparent via-gilt/45 to-transparent max-sm:hidden"
      />
      {/* 窄屏横向滚动壳：溢出时可滑动而不压缩符文；未溢出时内容居中 */}
      <div className="tome-scroll max-sm:overflow-x-auto">
        <div className="flex flex-col gap-1 max-sm:mx-auto max-sm:w-max max-sm:flex-row max-sm:items-center max-sm:gap-0.5 max-sm:px-1">
          {clusters.map((cluster, index) => (
            <Fragment key={cluster.name}>
              {index > 0 ? <ClusterDivider /> : null}
              <div
                role="group"
                aria-label={cluster.name}
                className="flex flex-col gap-1 max-sm:flex-row max-sm:items-center max-sm:gap-0.5"
              >
                {cluster.runes.map((r) => (
                  <button
                    key={r.tab}
                    data-rune-tab={r.tab}
                    onClick={() => onOpen(r.tab)}
                    className={`group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg transition max-sm:h-11 max-sm:w-11 ${
                      active === r.tab
                        ? "bg-gilt/10 text-gilt shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--gilt)_45%,transparent),inset_0_1px_3px_var(--shadow-warm),inset_0_-1px_0_color-mix(in_srgb,var(--paper-raised)_85%,transparent)] drop-shadow-[0_0_6px_var(--seal-glow)]"
                        : "text-ink-soft hover:bg-gilt/5 hover:text-gilt hover:drop-shadow-[0_0_5px_var(--gilt-glow)]"
                    }`}
                    title={r.label}
                    aria-label={r.label}
                    aria-current={active === r.tab ? "page" : undefined}
                  >
                    <WorldIcon icon={icons[r.tab] ?? FALLBACK_NAV_ICON} />
                    {active === r.tab ? (
                      /* 当前卷的封蜡点：桌面缀于内缘，移动端缀于符文下缘 */
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-cinnabar shadow-[0_1px_2px_var(--shadow-warm),inset_0_1px_0_rgba(255,255,255,0.3)] ring-1 ring-paper/70 max-sm:bottom-0.5 max-sm:left-1/2 max-sm:top-auto max-sm:-translate-x-1/2 max-sm:translate-y-0"
                      />
                    ) : null}
                    {r.tab === "activity" && unreadActivityCount > 0 ? (
                      <span
                        className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-cinnabar px-0.5 text-center text-[9px] leading-none text-seal-ink shadow-[0_1px_3px_var(--shadow-warm),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_2px_rgba(0,0,0,0.28)] ring-1 ring-paper/80"
                        aria-label={`${unreadActivityCount} 条未读动态`}
                      >
                        {unreadActivityCount > 9 ? "9+" : unreadActivityCount}
                      </span>
                    ) : null}
                    <span className="pointer-events-none absolute right-full mr-1 hidden whitespace-nowrap rounded border border-gilt/30 bg-paper-raised px-1.5 py-0.5 text-xs text-ink-soft shadow-[0_2px_8px_var(--shadow-warm)] group-hover:block group-focus-visible:block max-sm:group-hover:hidden">
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
            </Fragment>
          ))}
          {/* 镌刻分隔：叙事符文与香炉之间的鎏金细弦 */}
          <ClusterDivider />
          <Link
            href="/settings"
            className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-ink-soft transition hover:text-gilt hover:drop-shadow-[0_0_5px_var(--gilt-glow)] max-sm:h-11 max-sm:w-11"
            title="设置"
            aria-label="打开设置"
          >
            <OperationIcon name="settings" size={20} />
            <span className="pointer-events-none absolute right-full mr-1 hidden whitespace-nowrap rounded border border-gilt/30 bg-paper-raised px-1.5 py-0.5 text-xs text-ink-soft shadow-[0_2px_8px_var(--shadow-warm)] group-hover:block group-focus-visible:block max-sm:group-hover:hidden">
              设置
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
