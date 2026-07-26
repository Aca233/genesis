"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type {
  CreatorAvatar,
  DrawerTab,
  GodRow,
  RecentRewrite,
  TimelineInfo,
  WorldInfo,
} from "./types";
import type { BusyKinds } from "./reality-tree-state";
import { GodPanel } from "./GodPanel";
import { LorePanel } from "./LorePanel";
import { CodexPanel } from "./CodexPanel";
import { ChroniclePanel } from "./ChroniclePanel";
import { StarmapPanel } from "./StarmapPanel";
import { CreatorViewPanel } from "./CreatorViewPanel";
import { PantheonPastPanel } from "./PantheonPastPanel";
import { RealityTreePanel } from "./RealityTreePanel";
import { WorldActivityPanel, type WorldActivityResponse } from "./WorldActivityPanel";
import { drawerTabsForMode } from "./reality-tree-state";

/**
 * 右抽屉：spring 滑出 + 半透遮罩，Esc/遮罩点击关闭。
 * 神格/设定集来自页面初始 state；众生录/年表按需请求；星图纯前端布局。
 */

function tabTitle(mode: WorldInfo["mode"], tab: DrawerTab): string {
  return drawerTabsForMode(mode).find((entry) => entry.tab === tab)?.title ?? "古卷";
}

export function PlayDrawer({
  tab,
  world,
  gods,
  timeline,
  avatars = [],
  recentRewrite = null,
  busyKinds = { chat: false, settlement: false, rewrite: false },
  initialEntityId,
  initialGodId,
  onOpenEntity,
  onOpenGod,
  onActivitiesLoaded,
  onStateChanged,
  onTimelineChanged,
  onClose,
}: {
  tab: DrawerTab | null;
  world: WorldInfo;
  gods: GodRow[];
  timeline: TimelineInfo;
  avatars?: CreatorAvatar[];
  recentRewrite?: RecentRewrite | null;
  busyKinds?: BusyKinds;
  onStateChanged?: () => Promise<void>;
  onTimelineChanged?: (timelineId: string) => Promise<void>;
  /** 正文实体链接点开时的定位实体 */
  initialEntityId?: string | null;
  initialGodId?: string | null;
  onOpenEntity?: (id: string) => void;
  onOpenGod?: (id: string) => void;
  onActivitiesLoaded?: (data: WorldActivityResponse) => void;
  onClose: () => void;
}) {
  // 焦点管理：开卷时聚焦关闭按钮，合卷时还焦到对应符文
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const prevTabRef = useRef<DrawerTab | null>(null);

  useEffect(() => {
    if (tab && prevTabRef.current === null) {
      closeButtonRef.current?.focus();
    }
    prevTabRef.current = tab;
  }, [tab]);

  const close = useCallback(() => {
    if (tab) {
      document.querySelector<HTMLElement>(`[data-rune-tab="${tab}"]`)?.focus();
    }
    onClose();
  }, [tab, onClose]);

  // Esc 关闭
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, close]);

  return (
    <AnimatePresence>
      {tab && (
        <>
          {/* 半透遮罩 */}
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={close}
            className="fixed inset-0 z-40 bg-scrim"
            aria-hidden
          />
          {/* 抽屉体：羊皮折页（右缘留出符文列宽度，不遮挡换页签） */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed right-0 top-0 z-50 flex h-full flex-col border-l border-gilt/40 bg-paper pr-12 shadow-[-1.25rem_0_3rem_var(--shadow-warm)] [background-image:var(--fiber-noise),linear-gradient(196deg,color-mix(in_srgb,var(--paper-raised)_92%,transparent),color-mix(in_srgb,var(--paper)_96%,transparent)_42%)] max-sm:pb-16 max-sm:pr-0"
            style={{ width: "min(43rem, 92vw)" }}
            role="dialog"
            aria-label={tabTitle(world.mode, tab)}
          >
            {/* 折页内衬：左缘鎏金发丝线 + 陈年晕渍
               （stain-vignette 自带 position:relative，隔一层包裹以免覆写 fixed/absolute 定位） */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1 z-10 w-px bg-gradient-to-b from-transparent via-gilt/55 to-transparent"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-2 left-2.5 z-10 w-px bg-gradient-to-b from-transparent via-line to-transparent"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
              <div className="stain-vignette h-full w-full" />
            </div>
            <header className="flex items-center gap-3 border-b border-gilt/25 px-6 py-4">
              <h2 className="illuminated-header min-w-0 flex-1 text-lg">
                <span className="illuminated-header__glyph" aria-hidden="true">
                  ✦
                </span>
                {tabTitle(world.mode, tab)}
              </h2>
              <button
                ref={closeButtonRef}
                onClick={close}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-transparent text-ink-faint transition hover:border-gilt/40 hover:bg-gilt/10 hover:text-gilt"
                aria-label="合卷"
              >
                ✕
              </button>
            </header>

            <div
              className="tome-scroll flex-1 overflow-y-auto px-6 py-5"
              tabIndex={0}
              role="region"
              aria-label={tabTitle(world.mode, tab)}
            >
              {/* 页签切换淡切：key={tab} 使内容重挂载并淡入 */}
              <motion.div
                key={tab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
              >
              {tab === "activity" ? (
                <WorldActivityPanel
                  worldId={world.id}
                  timelineId={timeline.id}
                  worldName={world.name}
                  onOpenEntity={onOpenEntity ?? (() => undefined)}
                  onOpenGod={onOpenGod}
                  onLoaded={onActivitiesLoaded}
                />
              ) : tab === "god" ? (
                <GodPanel
                  key={`${timeline.id}:${initialGodId ?? "all"}`}
                  gods={gods}
                  theme={world.themeCard}
                  mode={world.mode}
                  initialGodId={initialGodId}
                  worldId={world.id}
                  timelineId={timeline.id}
                />
              ) : tab === "lore" ? (
                <LorePanel world={world} />
              ) : tab === "codex" ? (
                <CodexPanel
                  timelineId={timeline.id}
                  theme={world.themeCard}
                  initialEntityId={initialEntityId}
                />
              ) : tab === "chronicle" ? (
                <ChroniclePanel timelineId={timeline.id} />
              ) : tab === "creator" ? (
                <CreatorViewPanel
                  worldId={world.id}
                  timeline={timeline}
                  gods={gods}
                  avatars={avatars}
                  recentRewrite={recentRewrite}
                  busy={busyKinds.chat || busyKinds.settlement || busyKinds.rewrite}
                  onChanged={onStateChanged ?? (async () => undefined)}
                />
              ) : tab === "realities" ? (
                world.mode === "pantheon" ? (
                  <PantheonPastPanel
                    worldId={world.id}
                    activeTimelineId={timeline.id}
                    busy={busyKinds}
                    onTimelineChanged={onTimelineChanged ?? (async () => undefined)}
                  />
                ) : (
                  <RealityTreePanel
                    worldId={world.id}
                    activeTimelineId={timeline.id}
                    busy={busyKinds}
                    onTimelineChanged={onTimelineChanged ?? (async () => undefined)}
                  />
                )
              ) : (
                <StarmapPanel gods={gods} theme={world.themeCard} />
              )}
              </motion.div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
