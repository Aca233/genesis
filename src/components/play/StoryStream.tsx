"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageRow } from "./types";
import { MessageBlock } from "./MessageBlock";
import { Prose } from "./Prose";

/**
 * 书页正文流：前章残页 → 章头饰线 → 消息序列 → 生成中块 / 错误行。
 * 自动滚底：距底 <100px 视为「在底部」，用户上滚即暂停，回底恢复。
 */

/** 中文数字章号（常见范围够用，超出回退阿拉伯数字） */
function cnNum(n: number): string {
  const d = "零一二三四五六七八九";
  if (n <= 0 || n > 99) return String(n);
  if (n < 10) return d[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? d[tens] : ""}十${ones ? d[ones] : ""}`;
}

export function StoryStream({
  chapterIndex,
  chapterTitle,
  prevTail,
  messages,
  streamingText,
  rerollingId,
  rerollingText,
  busy,
  error,
  onRetry,
  onEdit,
  onCut,
  onReroll,
  onSwitchVariant,
}: {
  chapterIndex: number;
  chapterTitle: string | null;
  prevTail: MessageRow[];
  messages: MessageRow[];
  /** 新消息（say/continue/opening）流式中的正文；null = 未在流式 */
  streamingText: string | null;
  /** 另掷异文：目标消息 id 与其流式内容 */
  rerollingId: string | null;
  rerollingText: string;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onEdit: (id: string, content: string) => Promise<void>;
  onCut: (id: string) => Promise<void>;
  onReroll: (id: string) => void;
  onSwitchVariant: (id: string, index: number) => Promise<void>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [stickBottom, setStickBottom] = useState(true);
  const stickRef = useRef(true);

  // 监听窗口滚动：距底 <100px 恢复吸底，上滚暂停
  useEffect(() => {
    const onScroll = () => {
      const gap =
        document.documentElement.scrollHeight -
        window.innerHeight -
        window.scrollY;
      const stick = gap < 100;
      stickRef.current = stick;
      setStickBottom(stick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, []);

  // 内容增长时若吸底则跟随
  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages, streamingText, rerollingText, scrollToBottom]);

  return (
    <div className="pb-4 pt-2">
      {/* 前章残页（淡墨） */}
      {prevTail.length > 0 && (
        <section className="mb-6">
          <p className="mb-2 text-center text-xs tracking-widest text-ink-faint/70">
            ── 前章残页 ──
          </p>
          {prevTail.map((m) => (
            <MessageBlock key={m.id} message={m} readonly />
          ))}
        </section>
      )}

      {/* 章头 */}
      <header className="mb-6 text-center">
        <h2
          className="text-2xl text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          第{cnNum(chapterIndex)}章{chapterTitle ? ` · ${chapterTitle}` : ""}
        </h2>
        <p className="mt-2 select-none text-sm tracking-[0.4em] text-gilt/60">
          ──── ◆ ────
        </p>
      </header>

      {/* 正文消息流 */}
      {messages.map((m) => (
        <MessageBlock
          key={m.id}
          message={m}
          busy={busy}
          streamingOverride={rerollingId === m.id ? rerollingText : null}
          onEdit={onEdit}
          onCut={onCut}
          onReroll={onReroll}
          onSwitchVariant={onSwitchVariant}
        />
      ))}

      {/* 新段生成中 */}
      {streamingText !== null && (
        <div className="my-4">
          <Prose text={streamingText} />
          <span className="animate-pulse text-gilt">▍</span>
        </div>
      )}

      {/* 错误行 + 重试 */}
      {error && (
        <div className="my-6 flex items-center gap-3 text-sm text-cinnabar">
          <span>✗ 笔锋中断：{error}</span>
          <button
            onClick={onRetry}
            className="shrink-0 rounded border border-cinnabar/50 px-3 py-0.5 transition hover:bg-cinnabar/10"
          >
            重试
          </button>
        </div>
      )}

      {/* 回到卷尾（脱离吸底时浮现） */}
      {!stickBottom && (
        <button
          onClick={() => {
            stickRef.current = true;
            setStickBottom(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          }}
          className="fixed bottom-40 left-1/2 z-20 -translate-x-1/2 rounded-full border border-line bg-paper-raised px-4 py-1 text-xs text-ink-faint shadow transition hover:text-gilt"
        >
          ↓ 回到卷尾
        </button>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
