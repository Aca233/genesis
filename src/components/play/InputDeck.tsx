"use client";

import { useEffect, useRef, useState } from "react";
import type { Scale } from "@/lib/cards/schemas";
import { ScaleDial, SCALE_STOPS } from "./ScaleDial";
import { useTheme } from "@/components/theme/useTheme";

/**
 * 输入区：时之仪（尺度表盘）+ AI 建议 + 多行输入 + 发送/续笔/停止 + 烛光切换。
 */

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
}: {
  mode: "pantheon" | "creator";
  scale: Scale;
  onScaleChange: (s: Scale) => void;
  suggestions: string[];
  busyKind: "idle" | "narrating" | "settling" | "rewriting";
  /** 消息流非空时才允许续笔 */
  canContinue: boolean;
  onSend: (content: string) => void;
  onContinue: () => void;
  /** 停止当前生成 */
  onStop: () => void;
  settlementError?: string | null;
  onRetrySettlement?: () => void;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { candle, setMode } = useTheme();
  const busy = busyKind !== "idle";

  const current = SCALE_STOPS.find((s) => s.key === scale) ?? SCALE_STOPS[1];

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
      {(busyKind === "settling" || busyKind === "rewriting") && (
        <div className="mb-1 text-center text-xs text-gilt/70">
          世界正在演化…
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

      {/* AI 建议（淡金小字，生成中隐藏） */}
      {suggestions.length > 0 && !busy && (
        <div className="mb-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 text-sm">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                setText(s);
                taRef.current?.focus();
              }}
              className="text-gilt/60 transition hover:text-gilt"
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
            placeholder={busy ? "书写中…" : current.placeholder}
            rows={2}
            className="w-full resize-none bg-transparent leading-relaxed text-ink outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
          />
        </div>

        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
            <button
              onClick={() => !busy && onContinue()}
              disabled={busy || !canContinue}
              className="shrink-0 text-ink-soft transition hover:text-gilt disabled:opacity-40"
              title="不输入新内容，让史官顺势接着写"
            >
              续写
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
          ) : busy ? null : (
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
