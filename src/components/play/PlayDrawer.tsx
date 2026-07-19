"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { DrawerTab, GodRow, WorldInfo } from "./types";
import { GodPanel } from "./GodPanel";
import { LorePanel } from "./LorePanel";
import { CodexPanel } from "./CodexPanel";
import { ChroniclePanel } from "./ChroniclePanel";
import { StarmapPanel } from "./StarmapPanel";

/**
 * 右抽屉：spring 滑出 + 半透遮罩，Esc/遮罩点击关闭。
 * 神格/设定集来自页面初始 state；众生录/年表按需请求；星图纯前端布局。
 */

const TAB_TITLES: Record<DrawerTab, string> = {
  starmap: "✦ 星图",
  chronicle: "📜 编年史",
  god: "◈ 本尊神格",
  lore: "📖 世界设定集",
  codex: "👥 众生录",
};

export function PlayDrawer({
  tab,
  world,
  gods,
  timelineId,
  initialEntityId,
  onClose,
}: {
  tab: DrawerTab | null;
  world: WorldInfo;
  gods: GodRow[];
  timelineId: string;
  /** 正文实体链接点开时的定位实体 */
  initialEntityId?: string | null;
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
            aria-label={TAB_TITLES[tab]}
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2
                className="text-lg text-ink"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {TAB_TITLES[tab]}
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
              {tab === "god" ? (
                <GodPanel gods={gods} theme={world.themeCard} />
              ) : tab === "lore" ? (
                <LorePanel world={world} />
              ) : tab === "codex" ? (
                <CodexPanel
                  timelineId={timelineId}
                  theme={world.themeCard}
                  initialEntityId={initialEntityId}
                />
              ) : tab === "chronicle" ? (
                <ChroniclePanel timelineId={timelineId} />
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
