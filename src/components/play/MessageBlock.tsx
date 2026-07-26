"use client";

import { memo, useEffect, useRef, useState } from "react";
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

/** 结算缘由 → 徽章中文措辞（continuous-meta SettlementReasonSchema 枚举
 *  + settlement-policy 判定性缘由，机器枚举不落书页） */
const SETTLEMENT_REASON_LABELS: Record<string, string> = {
  major_event: "重大事件",
  ability_change: "能力变迁",
  important_death: "重要陨落",
  faction_change: "势力更迭",
  rank_change: "位阶变动",
  identity_change: "身份之变",
  relation_restructure: "关系重构",
  era_change: "纪元更替",
  multi_entity_change: "众象俱变",
  six_reply_checkpoint: "章回既满",
  time_advance: "岁月推移",
};

/** 神谕结果 → 中文措辞（continuous-meta OutcomeSchema 枚举） */
const OUTCOME_LABELS: Record<string, string> = {
  fulfilled: "如愿",
  partial: "部分如愿",
  thwarted: "受挫",
  backfired: "反噬",
};

export const MessageBlock = memo(function MessageBlock({
  message,
  readonly,
  busy,
  streamingOverride,
  mode = "pantheon",
  onEdit,
  onCut,
  onReroll,
  onSwitchVariant,
}: {
  message: MessageRow;
  /** 已纳入历史检查点的只读展示 */
  readonly?: boolean;
  /** 全局生成中：禁用一切操作 */
  busy?: boolean;
  /** 另掷异文时流式替换本条内容 */
  streamingOverride?: string | null;
  /** 世界模式：决定玩家引文措辞（神谕 / 敕令） */
  mode?: "pantheon" | "creator";
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

  // 本轮变化折叠行：已落库的世界变化推到玩家眼前；hidden 项一律不渲染（防泄露幕后行动）
  const meta = message.meta;
  const temporalChange = meta?.temporalState ?? null;
  const visibleActions = (meta?.worldActions ?? []).filter(
    (a) => a.visibility !== "hidden",
  );
  const visibleEntries = (meta?.activityEntries ?? []).filter(
    (e) => e.visibility !== "hidden",
  );
  const abilityReveals = meta?.abilityReveals ?? [];
  const settlementReasons = meta?.settlementReasons ?? [];
  const outcome = meta?.outcome ?? null;
  const changeCount =
    (temporalChange ? 1 : 0) +
    (outcome ? 1 : 0) +
    visibleActions.length +
    visibleEntries.length +
    abilityReveals.length +
    settlementReasons.length;

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
        <div className="pointer-events-none absolute -top-3 right-0 z-10 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-sm:pointer-events-auto max-sm:opacity-70">
          {/* 黄铜小件排：鎏金细框 + 暖影，按钮悬停微焕 */}
          <div className="flex items-center gap-0.5 rounded-md border border-gilt/30 bg-paper-raised/95 px-1 py-0.5 text-xs shadow-[0_2px_10px_var(--shadow-warm)]">
            {!isPlayer && vCount > 1 && (
              <span className="flex items-center gap-0.5 text-ink-faint">
                <button
                  onClick={() => void switchVariant(-1)}
                  disabled={acting || vIndex <= 0}
                  className="rounded px-1.5 py-0.5 text-ink-soft transition hover:bg-gilt/10 hover:text-gilt disabled:opacity-30"
                  title="上一异文"
                >
                  ‹
                </button>
                异文 {vIndex + 1}/{vCount}
                <button
                  onClick={() => void switchVariant(1)}
                  disabled={acting || vIndex >= vCount - 1}
                  className="rounded px-1.5 py-0.5 text-ink-soft transition hover:bg-gilt/10 hover:text-gilt disabled:opacity-30"
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
                className="rounded px-1.5 py-0.5 text-ink-soft transition hover:bg-gilt/10 hover:text-gilt disabled:opacity-30"
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
                className="rounded px-1.5 py-0.5 text-ink-soft transition hover:bg-cinnabar/10 hover:text-cinnabar disabled:opacity-30"
                title="朱批修订"
              >
                朱批
              </button>
            )}
            {onCut && (
              <button
                onClick={() => setConfirmCut(true)}
                disabled={acting}
                className="rounded px-1.5 py-0.5 text-ink-soft transition hover:bg-cinnabar/10 hover:text-cinnabar disabled:opacity-30"
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
        /* 敕谕引文：墨书正文 + 鎏金左律（.decree），衬凹纸底如御笔原件 */
        <blockquote className="decree my-5 whitespace-pre-wrap rounded-r-lg bg-paper-sunken/50 py-2.5 pr-4 leading-loose text-ink!">
          <span
            className="select-none text-gilt"
            style={{
              fontFamily: "var(--font-display)",
              textShadow: "0 0 8px var(--gilt-glow)",
            }}
          >
            {mode === "creator" ? "你颁下敕令：" : "你降下神谕："}
          </span>
          {content}
        </blockquote>
      ) : (
        <div className="my-4">
          <Prose text={content} />
          {isStreaming && <span className="animate-pulse text-gilt">▍</span>}
          {!isStreaming && changeCount > 0 && (
            /* 结算账目行：上缘发丝线的静默账册条，展开得内衬纸色 */
            <details className="mt-3 text-xs text-ink-faint">
              <summary className="letterpress flex cursor-pointer select-none list-none items-center gap-1.5 border-t border-line/70 pt-2 transition hover:text-gilt! [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="text-gilt/65">◈</span>
                本轮变化 · {changeCount} 项
              </summary>
              <ul className="mt-2 space-y-1 rounded-md border border-line/60 bg-paper-sunken/55 px-3 py-2">
                {outcome && (
                  <li
                    className={
                      outcome.result === "thwarted" || outcome.result === "backfired"
                        ? "text-cinnabar"
                        : undefined
                    }
                  >
                    神谕{OUTCOME_LABELS[outcome.result] ?? outcome.result}——{outcome.note}
                  </li>
                )}
                {temporalChange && (
                  <li>
                    时间推至{" "}
                    {[temporalChange.era, temporalChange.time]
                      .filter(Boolean)
                      .join("·")}
                  </li>
                )}
                {visibleActions.map((a, i) => (
                  <li key={`action-${i}`}>
                    {a.action}——{a.consequence}
                  </li>
                ))}
                {visibleEntries.map((e, i) => (
                  <li key={`entry-${i}`}>{e.text}</li>
                ))}
                {abilityReveals.map((r, i) => (
                  <li key={`reveal-${i}`}>能力显露：{r.evidence}</li>
                ))}
                {settlementReasons.length > 0 && (
                  <li className="flex flex-wrap gap-1">
                    {settlementReasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-gilt/30 bg-paper-raised/80 px-2 py-0.5 text-ink-soft"
                      >
                        {SETTLEMENT_REASON_LABELS[reason] ?? reason}
                      </span>
                    ))}
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* 朱批印记 */}
      {!editing && message.meta?.edited && (
        <div className="-mt-2 mb-2 text-right text-xs text-cinnabar/60">朱批</div>
      )}
      {readonly && !editing && (
        /* 入史钤记：细朱框小印，微侧如手钤 */
        <div className="-mt-2 mb-2 flex justify-end">
          <span className="-rotate-2 select-none rounded-[0.2rem] border border-cinnabar/45 px-1.5 py-0.5 text-[10px] leading-none tracking-[0.25em] text-cinnabar/70">
            已入史册
          </span>
        </div>
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
});
