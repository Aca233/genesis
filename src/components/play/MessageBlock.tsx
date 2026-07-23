"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageRow, Variant } from "./types";
import { Prose } from "./Prose";

/**
 * 单条消息块：narrator 正文 / player 神谕引文，
 * 悬停浮现操作排（异文/另掷/朱批/裁去，古卷措辞）。
 * 已成史（非当前章）与生成中一律只读。
 */

function chosenIndex(variants: Variant[] | null): number {
  if (!variants) return -1;
  const i = variants.findIndex((v) => v.chosen);
  return i === -1 ? variants.length - 1 : i;
}

export function MessageBlock({
  message,
  readonly,
  busy,
  streamingOverride,
  onEdit,
  onCut,
  onReroll,
  onSwitchVariant,
}: {
  message: MessageRow;
  /** 前章残页等只读展示 */
  readonly?: boolean;
  /** 全局生成中：禁用一切操作 */
  busy?: boolean;
  /** 另掷异文时流式替换本条内容 */
  streamingOverride?: string | null;
  onEdit?: (id: string, content: string) => Promise<void>;
  onCut?: (id: string) => Promise<void>;
  onReroll?: (id: string) => void;
  onSwitchVariant?: (id: string, index: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmCut, setConfirmCut] = useState(false);
  const [acting, setActing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const isPlayer = message.role === "player";
  const variants = message.variants;
  const vCount = variants?.length ?? 0;
  const vIndex = chosenIndex(variants);
  const isStreaming = streamingOverride != null;
  const content = isStreaming ? streamingOverride : message.content;
  const isRewriteResult = message.meta?.kind === "reality_rewrite_result";
  const canAct = !readonly && !busy && !editing && !isStreaming;

  // 编辑态 textarea 自适应高度
  useEffect(() => {
    if (!editing) return;
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [editing, draft]);

  async function confirmEdit() {
    if (!onEdit || !draft.trim()) return;
    setActing(true);
    try {
      await onEdit(message.id, draft.trim());
      setEditing(false);
    } finally {
      setActing(false);
    }
  }

  async function doCut() {
    if (!onCut) return;
    setActing(true);
    try {
      await onCut(message.id);
    } finally {
      setActing(false);
      setConfirmCut(false);
    }
  }

  async function switchVariant(delta: number) {
    if (!onSwitchVariant || vCount < 2) return;
    const next = vIndex + delta;
    if (next < 0 || next >= vCount) return;
    setActing(true);
    try {
      await onSwitchVariant(message.id, next);
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="group relative">
      {/* 悬停操作排（右上浮现） */}
      {canAct && (onEdit || onCut || onReroll) && (
        <div className="pointer-events-none absolute -top-3 right-0 z-10 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
          <div className="flex items-center gap-1 rounded border border-line bg-paper-raised px-1.5 py-0.5 text-xs shadow-sm">
            {!isPlayer && vCount > 1 && (
              <span className="flex items-center gap-0.5 text-ink-faint">
                <button
                  onClick={() => void switchVariant(-1)}
                  disabled={acting || vIndex <= 0}
                  className="px-1 text-ink-soft transition hover:text-gilt disabled:opacity-30"
                  title="上一异文"
                >
                  ‹
                </button>
                异文 {vIndex + 1}/{vCount}
                <button
                  onClick={() => void switchVariant(1)}
                  disabled={acting || vIndex >= vCount - 1}
                  className="px-1 text-ink-soft transition hover:text-gilt disabled:opacity-30"
                  title="下一异文"
                >
                  ›
                </button>
                <span className="mx-1 text-line">│</span>
              </span>
            )}
            {!isPlayer && onReroll && (
              <button
                onClick={() => onReroll(message.id)}
                disabled={acting}
                className="px-1 text-ink-soft transition hover:text-gilt disabled:opacity-30"
                title="另掷一段异文"
              >
                另掷
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
                disabled={acting}
                className="px-1 text-ink-soft transition hover:text-cinnabar disabled:opacity-30"
                title="朱批修订"
              >
                朱批
              </button>
            )}
            {onCut && (
              <button
                onClick={() => setConfirmCut(true)}
                disabled={acting}
                className="px-1 text-ink-soft transition hover:text-cinnabar disabled:opacity-30"
                title="裁去此条及其后诸行"
              >
                裁去
              </button>
            )}
          </div>
        </div>
      )}

      {/* 正文 / 编辑态 */}
      {editing ? (
        <div className="my-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-none rounded-md border border-cinnabar/60 bg-paper-sunken p-3 leading-relaxed text-ink outline-none focus:border-cinnabar"
            rows={3}
          />
          <div className="mt-1 flex items-center justify-end gap-3 text-sm">
            <button
              onClick={() => setEditing(false)}
              disabled={acting}
              className="text-ink-faint transition hover:text-ink"
            >
              罢笔
            </button>
            <button
              onClick={() => void confirmEdit()}
              disabled={acting || !draft.trim()}
              className="text-cinnabar transition hover:underline disabled:opacity-40"
            >
              {acting ? "批注中…" : "落批"}
            </button>
          </div>
        </div>
      ) : isRewriteResult ? (
        <article className="my-4">
          <Prose text={content} />
          <button
            type="button"
            disabled={busy}
            className="mt-2 text-xs text-gilt/75 hover:text-gilt disabled:opacity-40"
            onClick={() => window.dispatchEvent(new CustomEvent("creator:open-realities"))}
          >
            ⌘ 现实已分叉
          </button>
        </article>
      ) : isPlayer ? (
        <blockquote className="decree my-4 whitespace-pre-wrap leading-loose">
          <span className="text-gilt/70">你降下神谕：</span>
          {content}
        </blockquote>
      ) : (
        <div className="my-4">
          <Prose text={content} />
          {isStreaming && <span className="animate-pulse text-gilt">▍</span>}
        </div>
      )}

      {/* 朱批印记 */}
      {!editing && message.meta?.edited && (
        <div className="-mt-2 mb-2 text-right text-xs text-cinnabar/60">朱批</div>
      )}
      {readonly && !editing && (
        <div className="-mt-2 mb-2 text-right text-xs text-ink-faint/60">已成史</div>
      )}

      {/* 裁去二次确认 */}
      {confirmCut && (
        <div className="mb-3 flex items-center justify-end gap-2 text-sm text-cinnabar">
          裁去此后诸行？不可复得。
          <button
            onClick={() => void doCut()}
            disabled={acting}
            className="font-bold underline disabled:opacity-40"
          >
            {acting ? "裁去中…" : "落刀"}
          </button>
          <button
            onClick={() => setConfirmCut(false)}
            disabled={acting}
            className="text-ink-faint transition hover:text-ink"
          >
            且慢
          </button>
        </div>
      )}
    </div>
  );
}
