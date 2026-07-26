"use client";

import { useEffect } from "react";
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
  // Esc 关闭
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, onClose]);

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
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink/25"
            aria-hidden
          />
          {/* 抽屉体（右缘留出符文列宽度，不遮挡换页签） */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed right-0 top-0 z-50 flex h-full flex-col border-l border-line bg-paper pr-12 shadow-2xl max-sm:pb-14 max-sm:pr-0"
            style={{ width: "min(43rem, 92vw)" }}
            role="dialog"
            aria-label={tabTitle(world.mode, tab)}
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2
                className="text-lg text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {tabTitle(world.mode, tab)}
              </h2>
              <button
                onClick={onClose}
                className="text-ink-faint transition hover:text-ink"
                aria-label="合卷"
              >
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
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
                <RealityTreePanel
                  worldId={world.id}
                  activeTimelineId={timeline.id}
                  busy={busyKinds}
                  onTimelineChanged={onTimelineChanged ?? (async () => undefined)}
                />
              ) : (
                <StarmapPanel gods={gods} theme={world.themeCard} />
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
