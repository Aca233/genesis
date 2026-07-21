"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { PantheonWorldDeck } from "@/lib/cards/schemas";

/**
 * 创世开局演出（docs/05 §4.1）
 * 三幕：神谕逐字浮现 → 卡组名目拓印 → 「第一章 · 创世」晕开。
 * 演出与 embark 请求并行；跳过仅结束动画，仍等待 embark 完成。
 */

type EmbarkState =
  | { phase: "pending" }
  | { phase: "done" }
  | { phase: "error"; message: string };

/** 拓印条目：从卡组提炼的名目 */
function buildStamps(deck: PantheonWorldDeck): string[] {
  return [
    "宇宙论 · 已定",
    ...(deck.fusionAxiom ? ["融合公理 · 已缝合"] : []),
    `${deck.playerGod.name} · 汝之神格`,
    ...deck.majorGods.map((g) => `${g.name} · 入谱`),
    ...(deck.minorGods.length ? [`次要神 · ${deck.minorGods.length} 位`] : []),
    `势力 · ${deck.factions.length} 方`,
    ...(deck.races.length ? [`种族 · ${deck.races.length} 支`] : []),
    ...(deck.places.length ? [`山河 · ${deck.places.length} 处`] : []),
    `${deck.epochConflict.epochName} · 纪元始`,
  ];
}

export function GenesisCeremony({
  decree,
  deck,
  embark,
  onError,
  onFinished,
}: {
  /** 原初神谕 */
  decree: string;
  deck: PantheonWorldDeck;
  embark: EmbarkState;
  /** embark 失败：退出演出交还编辑器（编辑器展示错误与重试） */
  onError: (message: string) => void;
  /** embark 成功且动画结束（或被跳过）→ 跳转 */
  onFinished: () => void;
}) {
  // 幕次：decree（逐字神谕）→ stamps（拓印）→ title（章题）→ hold（等待 embark）
  const [act, setAct] = useState<"decree" | "stamps" | "title" | "hold">(
    "decree",
  );
  const [charCount, setCharCount] = useState(0);
  const [stampCount, setStampCount] = useState(0);
  const [skipped, setSkipped] = useState(false);

  const chars = useMemo(() => Array.from(decree), [decree]);
  const stamps = useMemo(() => buildStamps(deck), [deck]);

  // 每字 ~80ms；超 ~150 字加速，压住总时长
  const charInterval = chars.length > 150 ? Math.max(30, 12000 / chars.length) : 80;
  // 拓印错落 ~400ms；条目多时略加速
  const stampInterval = stamps.length > 18 ? 280 : 400;

  // 第一幕：神谕逐字浮现
  useEffect(() => {
    if (act !== "decree") return;
    if (charCount >= chars.length) {
      const t = setTimeout(() => setAct("stamps"), 1400); // 沉入纸面的停顿
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCharCount((n) => n + 1), charInterval);
    return () => clearTimeout(t);
  }, [act, charCount, chars.length, charInterval]);

  // 第二幕：卡组名目拓印
  useEffect(() => {
    if (act !== "stamps") return;
    if (stampCount >= stamps.length) {
      const t = setTimeout(() => setAct("title"), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStampCount((n) => n + 1), stampInterval);
    return () => clearTimeout(t);
  }, [act, stampCount, stamps.length, stampInterval]);

  // 第三幕：章题晕开后进入等待段
  useEffect(() => {
    if (act !== "title") return;
    const t = setTimeout(() => setAct("hold"), 2600);
    return () => clearTimeout(t);
  }, [act]);

  const animationDone = skipped || act === "hold";

  // embark 失败：退出演出
  useEffect(() => {
    if (embark.phase === "error") onError(embark.message);
  }, [embark, onError]);

  // 成功 + 动画结束（或跳过）→ 跳转
  useEffect(() => {
    if (embark.phase === "done" && animationDone) onFinished();
  }, [embark.phase, animationDone, onFinished]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-paper"
    >
      {/* 演出主体（跳过后隐去，只留等待态） */}
      {!skipped && (
        <div className="flex w-full max-w-2xl flex-col items-center px-8">
          <AnimatePresence mode="wait">
            {/* 第一幕：原初神谕，金色文楷逐字浮现 */}
            {act === "decree" && (
              <motion.p
                key="decree"
                exit={{ opacity: 0, y: 40, filter: "blur(3px)" }}
                transition={{ duration: 1.1, ease: "easeIn" }}
                className="text-center text-xl leading-loose text-gilt md:text-2xl"
                style={{ fontFamily: "var(--font-prose)" }}
              >
                {chars.slice(0, charCount).map((ch, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </motion.p>
            )}

            {/* 第二幕：卡组名目逐张拓印 */}
            {act === "stamps" && (
              <motion.ul
                key="stamps"
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7 }}
                className="flex max-h-[70vh] flex-col items-center gap-2 overflow-hidden"
              >
                {stamps.slice(0, stampCount).map((s, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, scale: 1.12, filter: "blur(2px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    transition={{ duration: 0.45 }}
                    className="text-base tracking-widest text-ink-soft md:text-lg"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {s}
                  </motion.li>
                ))}
              </motion.ul>
            )}

            {/* 第三幕：第一章标题晕开 */}
            {(act === "title" || act === "hold") && (
              <motion.h1
                key="title"
                initial={{ opacity: 0, filter: "blur(10px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{ duration: 2, ease: "easeOut" }}
                className="text-4xl tracking-[0.3em] text-ink md:text-5xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                第一章 · 创世
              </motion.h1>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 动画已毕但 embark 尚在途 */}
      {animationDone && embark.phase === "pending" && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="absolute bottom-16 text-sm text-ink-faint"
        >
          世界正在落笔成形…
        </motion.p>
      )}

      {/* 跳过：仅结束动画，仍等待 embark */}
      {!skipped && (
        <button
          type="button"
          onClick={() => setSkipped(true)}
          className="absolute bottom-6 right-8 text-sm text-ink-faint transition hover:text-gilt"
        >
          跳过 »
        </button>
      )}
    </motion.div>
  );
}
