"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Scale } from "@/lib/cards/schemas";

/**
 * 输入区：书签丝带尺度切换器 + AI 建议 + 多行输入 + 发送/续笔。
 * 丝带：当前档更长且烫金，切换轻动效（motion layout）。
 */

const SCALES: { key: Scale; label: string; placeholder: string }[] = [
  { key: "scene", label: "场景", placeholder: "此刻，你将……" },
  { key: "era", label: "年代", placeholder: "此后数十载……" },
  { key: "epoch", label: "纪元", placeholder: "此后百年……" },
];

export function InputDeck({
  scale,
  onScaleChange,
  suggestions,
  chapterBreakHint,
  busy,
  canContinue,
  onSend,
  onContinue,
}: {
  scale: Scale;
  onScaleChange: (s: Scale) => void;
  suggestions: string[];
  chapterBreakHint: boolean;
  busy: boolean;
  /** 消息流非空时才允许续笔 */
  canContinue: boolean;
  onSend: (content: string) => void;
  onContinue: (directive?: string) => void;
}) {
  const [text, setText] = useState("");
  const [directiveOpen, setDirectiveOpen] = useState(false);
  const [directive, setDirective] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const current = SCALES.find((s) => s.key === scale) ?? SCALES[0];

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

  function sendContinue() {
    if (busy) return;
    const d = directive.trim();
    onContinue(d || undefined);
    setDirective("");
    setDirectiveOpen(false);
  }

  return (
    <div className="sticky bottom-0 z-30 mx-auto w-full max-w-3xl px-4 pb-3 xl:max-w-4xl">
      {/* 翻章提示（淡金细线，仅样式） */}
      {chapterBreakHint && !busy && (
        <div className="mb-1 border-t border-gilt/40 pt-1 text-center text-xs text-gilt/70">
          本章似已抵达段落。翻章结算将于 M2 实装。
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

      {/* 书签丝带（输入框上缘，垂下造型） */}
      <div className="flex items-end gap-2 pl-6">
        {SCALES.map((s) => {
          const active = s.key === scale;
          return (
            <motion.button
              key={s.key}
              onClick={() => onScaleChange(s.key)}
              disabled={busy}
              animate={{ height: active ? 34 : 22 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={`relative flex w-16 items-start justify-center rounded-t-sm pt-0.5 text-xs transition-colors disabled:opacity-50 ${
                active
                  ? "bg-gilt/90 font-bold text-paper"
                  : "bg-paper-sunken text-ink-faint hover:text-ink-soft"
              }`}
              style={{
                // 丝带下缘燕尾
                clipPath:
                  "polygon(0 0, 100% 0, 100% calc(100% - 5px), 50% 100%, 0 calc(100% - 5px))",
              }}
              title={`切换至${s.label}尺度`}
            >
              {s.label}
            </motion.button>
          );
        })}
      </div>

      {/* 输入容器 */}
      <div className="rounded-lg rounded-tl-none border border-line bg-paper-raised p-3 shadow-lg">
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

        <div className="mt-1 flex items-center justify-between gap-3">
          {/* 续笔（无输入直接续；点开小输入行可附导演提示） */}
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <button
              onClick={sendContinue}
              disabled={busy || !canContinue}
              className="shrink-0 text-ink-soft transition hover:text-gilt disabled:opacity-40"
              title="让史官接着写"
            >
              续笔
            </button>
            <button
              onClick={() => setDirectiveOpen((v) => !v)}
              disabled={busy || !canContinue}
              className={`shrink-0 text-xs transition disabled:opacity-40 ${
                directiveOpen ? "text-gilt" : "text-ink-faint hover:text-gilt"
              }`}
              title="附一句幕后导演提示"
            >
              {directiveOpen ? "▾ 帷幕" : "▸ 帷幕"}
            </button>
            {directiveOpen && (
              <input
                value={directive}
                onChange={(e) => setDirective(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendContinue();
                  }
                }}
                disabled={busy}
                placeholder="幕后低语：接下来让……（回车续笔）"
                className="min-w-0 flex-1 rounded border border-line bg-paper-sunken px-2 py-1 text-xs text-ink outline-none focus:border-gilt/50"
              />
            )}
          </div>

          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="shrink-0 rounded-md border border-gilt/50 bg-gilt/5 px-6 py-1.5 text-sm text-gilt transition hover:bg-gilt/15 disabled:opacity-40"
          >
            {busy ? "书写中…" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
