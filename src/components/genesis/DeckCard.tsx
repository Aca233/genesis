"use client";

import { motion } from "motion/react";
import type { DeckCardKey } from "@/lib/cards/schemas";
import { memo, useState } from "react";

/** 卡片墙：古籍笺卡片 + 组头（重掷控制） */

type DeckCardProps = {
  title: string;
  subtitle?: string;
  lines: string[];
  /** 该卡下被玩家锁定的字段数 */
  lockedCount: number;
  /** 是否有未破封的天机块 */
  sealed?: boolean;
  /** 所属组重掷中：覆盖墨迹旋转动效 */
  rerolling: boolean;
  /** onOpen 闭包捕获的列表下标，仅用于 memo 比较；组件体内不使用 */
  openIndex?: number;
  onOpen: () => void;
};

/** 单张古籍笺（卡名 + 关键摘要，点开进入全文编辑） */
function DeckCardBase({
  title,
  subtitle,
  lines,
  lockedCount,
  sealed,
  rerolling,
  onOpen,
}: DeckCardProps) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      onClick={onOpen}
      disabled={rerolling}
      className="relative flex min-h-32 flex-col gap-1.5 overflow-hidden rounded-lg border border-line bg-paper-raised p-4 text-left shadow-[0_1px_3px_rgba(46,36,24,0.08)] transition hover:border-gilt/50 hover:shadow-[0_0_14px_var(--gilt-glow)]"
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-base text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h3>
        <span className="flex shrink-0 items-center gap-1 text-xs">
          {sealed && (
            <span className="text-cinnabar/80" title="含未启封的天机">
              ❈ 封
            </span>
          )}
          {lockedCount > 0 && (
            <span
              className="text-gilt/80"
              title={`${lockedCount} 处手改字段，重掷时保留`}
            >
              🔒{lockedCount}
            </span>
          )}
        </span>
      </div>
      {subtitle && <p className="text-xs text-gilt/90">{subtitle}</p>}
      <div className="grid gap-0.5">
        {lines.map((line, i) => (
          <p key={i} className="text-xs leading-relaxed text-ink-soft">
            {line}
          </p>
        ))}
      </div>

      {/* 重掷中：墨迹旋转覆盖 */}
      {rerolling && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-paper/80 backdrop-blur-[1.5px]"
        >
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}
            className="h-9 w-9 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 10%, var(--ink) 70%, transparent 90%)",
              WebkitMask:
                "radial-gradient(circle, transparent 42%, black 46%)",
              mask: "radial-gradient(circle, transparent 42%, black 46%)",
            }}
          />
          <span className="text-xs text-ink-soft">墨迹重书…</span>
        </motion.div>
      )}
    </motion.button>
  );
}

/** memo 比较：onOpen 刻意排除——各调用点闭包只捕获常量 kind 与列表下标，下标由 openIndex 覆盖 */
function areDeckCardPropsEqual(prev: DeckCardProps, next: DeckCardProps): boolean {
  return (
    prev.title === next.title &&
    prev.subtitle === next.subtitle &&
    prev.lockedCount === next.lockedCount &&
    prev.sealed === next.sealed &&
    prev.rerolling === next.rerolling &&
    prev.openIndex === next.openIndex &&
    prev.lines.length === next.lines.length &&
    prev.lines.every((line, i) => line === next.lines[i])
  );
}

export const DeckCard = memo(DeckCardBase, areDeckCardPropsEqual);

/** 组头：组名 + 骰形重掷印章（可附一句重掷要求，整组粒度） */
export function GroupHeader({
  title,
  cardKey,
  count,
  warning,
  rerolling,
  disabled,
  onReroll,
}: {
  title: string;
  cardKey: DeckCardKey;
  count?: number;
  /** 整组重掷的明确提示，如「将重生成全部主神」 */
  warning?: string;
  rerolling: boolean;
  /** 其他组正在重掷时禁用 */
  disabled: boolean;
  onReroll: (cardKey: DeckCardKey, note?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div className="mb-3 mt-8 border-b border-line pb-2 first:mt-0">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          className="text-lg text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
          {typeof count === "number" && (
            <span className="ml-2 text-sm text-gilt">· {count}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={rerolling || disabled}
          title={warning ?? "重掷整组（手改字段保留）"}
          className="rounded-md border border-gilt/40 px-2.5 py-0.5 text-xs text-gilt transition hover:bg-gilt/10 disabled:opacity-40"
        >
          {rerolling ? "⚄ 重掷中…" : "⚄ 重掷"}
        </button>
        {warning && (
          <span className="text-xs text-ink-faint">{warning}</span>
        )}
      </div>

      {open && !rerolling && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="可留一句重掷要求（选填），如「更冷酷一些」"
            maxLength={500}
            className="w-full max-w-md rounded-md border border-line bg-paper-sunken px-3 py-1.5 text-xs text-ink outline-none focus:border-gilt/60"
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onReroll(cardKey, note.trim() || undefined);
              setNote("");
            }}
            className="rounded-md border border-gilt/50 bg-gilt/5 px-4 py-1.5 text-xs text-gilt transition hover:bg-gilt/15"
          >
            掷
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs text-ink-faint hover:text-ink"
          >
            罢了
          </button>
        </motion.div>
      )}
    </div>
  );
}
