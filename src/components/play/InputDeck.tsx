"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Scale } from "@/lib/cards/schemas";
import { ScaleDial, SCALE_STOPS } from "./ScaleDial";
import { useTheme } from "@/components/theme/useTheme";
import type { TaskProgressView } from "./task-progress-state";
import { TaskProgressBar } from "./TaskProgressBar";

/**
 * 输入区：时之仪（尺度表盘）+ AI 建议 + 多行输入 + 发送/续笔/停止 + 烛光切换。
 */

/** 结算阶段 → 主题化进度文案（顺序即 1-5 序号） */
const SETTLEMENT_STAGE_LABELS = [
  { id: "checkpoint_read", label: "史官清点卷宗" },
  { id: "pantheon", label: "诸神落子" },
  { id: "extract", label: "万象归档" },
  { id: "chronicle", label: "编年入册" },
  { id: "snapshot", label: "岁月归档" },
] as const;

/** AI 建议偏好（设置页写入侧使用同一键名） */
const SUGGESTIONS_PREF_KEY = "chuangshi:ai-suggestions";

export function InputDeck({
  scale,
  onScaleChange,
  suggestions,
  busyKind,
  canContinue,
  onSend,
  onContinue,
  onStop,
  settlementError,
  onRetrySettlement,
  settlementStage,
  taskProgress,
  onRetryTask,
  onRefreshWorld,
}: {
  mode: "pantheon" | "creator";
  scale: Scale;
  onScaleChange: (s: Scale) => void;
  suggestions: string[];
  busyKind: "idle" | "narrating" | "settling" | "rewriting";
  /** 消息流非空时才允许续笔 */
  canContinue: boolean;
  onSend: (content: string) => void;
  /** 续写；可携带幕后导演提示 */
  onContinue: (directive?: string) => void;
  /** 停止当前生成 */
  onStop: () => void;
  settlementError?: string | null;
  onRetrySettlement?: () => void;
  /** 结算进行中的当前阶段 id（用于演化提示行的阶段文案） */
  settlementStage?: string | null;
  taskProgress?: TaskProgressView | null;
  onRetryTask?: () => void;
  onRefreshWorld?: () => void;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { candle, setMode } = useTheme();
  const busy = busyKind !== "idle";

  // 幕后指示（续写导演提示）
  const [directiveOpen, setDirectiveOpen] = useState(false);
  const [directive, setDirective] = useState("");

  // AI 建议偏好（设置页开关的读取侧；异常时默认展示，跨标签页跟随 storage 变更）
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(SUGGESTIONS_PREF_KEY) !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SUGGESTIONS_PREF_KEY) return;
      setSuggestionsEnabled(event.newValue !== "off");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const current = SCALE_STOPS.find((s) => s.key === scale) ?? SCALE_STOPS[1];

  const stageIndex = settlementStage
    ? SETTLEMENT_STAGE_LABELS.findIndex((s) => s.id === settlementStage)
    : -1;
  const evolvingText = stageIndex >= 0
    ? `世界正在演化——${SETTLEMENT_STAGE_LABELS[stageIndex].label}（${stageIndex + 1}/5）`
    : "世界正在演化…";

  function continueWithDirective() {
    if (busy || !canContinue) return;
    const d = directive.trim();
    onContinue(d ? d : undefined);
    setDirective("");
    setDirectiveOpen(false);
  }

  // 输入框自适应高度（上限约 8 行）
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  function send() {
    const v = text.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
  }

  return (
    <div className="sticky bottom-0 z-30 mx-auto w-full max-w-3xl px-4 pb-3 xl:max-w-4xl">
      <AnimatePresence initial={false}>
        {taskProgress && (
          <motion.div
            key="task-progress"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <TaskProgressBar
              progress={taskProgress}
              onRetry={onRetryTask}
              onRefresh={onRefreshWorld}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* 演化提示行：任务条在场时由其六阶段列表独占进度反馈，此行仅作空隙兜底 */}
      {!taskProgress && (busyKind === "settling" || busyKind === "rewriting") && (
        <div className="mb-1 text-center text-xs text-gilt/70">
          {busyKind === "settling" ? evolvingText : "世界正在演化…"}
        </div>
      )}
      {settlementError && (
        <div className="mb-1 flex items-center justify-center gap-3 text-xs text-cinnabar">
          <span>世界整理中断：{settlementError}</span>
          {onRetrySettlement && (
            <button type="button" onClick={onRetrySettlement} className="underline">
              继续整理世界
            </button>
          )}
        </div>
      )}

      {/* AI 建议（淡金小字，生成中淡出；高度恒定不顶起输入区） */}
      {suggestionsEnabled && (
        <div
          className={`mb-1 flex min-h-7 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 text-sm transition-opacity duration-200 ${
            suggestions.length > 0 && !busy
              ? "opacity-100"
              : "pointer-events-none opacity-0"
          }`}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                setText(s);
                taRef.current?.focus();
              }}
              className="text-gilt-strong transition hover:text-gilt"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* 输入容器 */}
      <div className="rounded-lg border border-line bg-paper-raised p-3 shadow-lg">
        <div className="flex items-start gap-3">
          {/* 时之仪表盘 */}
          <div className="flex shrink-0 flex-col items-center pt-1">
            <ScaleDial scale={scale} disabled={busy} onChange={onScaleChange} />
            <span className="mt-0.5 text-[10px] text-ink-faint">时之仪</span>
          </div>

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            disabled={busy}
            aria-label="降下神谕"
            placeholder={busyKind === "narrating"
              ? "书写中…"
              : busyKind === "settling" || busyKind === "rewriting"
                ? "世界演化中，稍候…"
                : current.placeholder}
            rows={2}
            className="w-full resize-none bg-transparent leading-relaxed text-ink outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
          />
        </div>

        {/* 幕后指示：随续写递给史官的一句导演提示 */}
        {directiveOpen && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  continueWithDirective();
                }
              }}
              disabled={busy}
              maxLength={1000}
              aria-label="幕后指示"
              placeholder="幕后指示，如：让使者带来坏消息"
              className="w-full rounded-md border border-line bg-transparent px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
            />
          </div>
        )}

        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
            <button
              onClick={continueWithDirective}
              disabled={busy || !canContinue}
              className="shrink-0 text-ink-soft transition hover:text-gilt disabled:opacity-40"
              title="不输入新内容，让史官顺势接着写"
            >
              续写
            </button>
            <button
              onClick={() => setDirectiveOpen((v) => !v)}
              disabled={busy || !canContinue}
              aria-expanded={directiveOpen}
              aria-label="幕后指示（续写导演提示）"
              className={`shrink-0 text-xs transition hover:text-gilt disabled:opacity-40 ${
                directiveOpen || directive.trim() ? "text-gilt" : "text-ink-faint"
              }`}
              title="幕后指示：续写时递给史官的一句导演提示"
            >
              ✎
            </button>
            {/* 烛光切换（游戏内） */}
            <button
              onClick={() => setMode(candle ? "day" : "candle")}
              className="shrink-0 text-xs text-ink-faint transition hover:text-gilt"
              title={candle ? "切回日卷（亮色）" : "燃烛夜读（暗色）"}
            >
              {candle ? "☀ 日卷" : "🕯 烛光"}
            </button>
          </div>

          {busyKind === "narrating" ? (
            <button
              onClick={onStop}
              className="shrink-0 rounded-md border border-cinnabar/50 bg-cinnabar/5 px-6 py-1.5 text-sm text-cinnabar transition hover:bg-cinnabar/15"
              title="搁笔：停止本次生成（已写出的文字保留）"
            >
              ■ 搁笔
            </button>
          ) : busy ? (
            <button
              disabled
              className="shrink-0 rounded-md border border-line px-6 py-1.5 text-sm text-ink-faint opacity-60"
            >
              演化中…
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!text.trim()}
              className="shrink-0 rounded-md border border-gilt/50 bg-gilt/5 px-6 py-1.5 text-sm text-gilt transition hover:bg-gilt/15 disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
