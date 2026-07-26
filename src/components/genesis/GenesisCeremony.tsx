"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import type { WorldDeck } from "@/lib/cards/schemas";
import { PlayBackground } from "@/components/play/PlayBackground";

/**
 * 创世开局演出（docs/05 §4.1）
 * 三幕：神谕逐字浮现 → 卡组名目拓印 → 世界时间与史册印记晕开。
 * 演出与 embark 请求并行；跳过仅结束动画，仍等待 embark 完成。
 */

type EmbarkState =
  | { phase: "pending" }
  | { phase: "done" }
  | { phase: "error"; message: string };

export function ceremonyTitle(deck: WorldDeck) {
  return {
    world: deck.worldName,
    era: deck.epochConflict.epochName,
    time: deck.epochConflict.yearLabel,
    seal: "自此有史" as const,
  };
}

/** 拓印条目：从卡组提炼的名目 */
export function buildCeremonyStamps(deck: WorldDeck): string[] {
  return [
    "宇宙论 · 已定",
    ...(deck.fusionAxiom ? ["融合公理 · 已缝合"] : []),
    ...(deck.mode === "pantheon" ? [`${deck.playerGod.name} · 汝之神格`] : []),
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
  onFinished,
}: {
  /** 原初神谕 */
  decree: string;
  deck: WorldDeck;
  embark: EmbarkState;
  /** embark 成功且动画结束（或被跳过）→ 跳转 */
  onFinished: () => void;
}) {
  // 减弱动效：跳过逐字与拓印两幕，直接呈现世界题名
  const reducedMotion = useReducedMotion();
  // 幕次：decree（逐字神谕）→ stamps（拓印）→ title（世界题名）→ hold（等待 opening）
  const [act, setAct] = useState<"decree" | "stamps" | "title" | "hold">(
    reducedMotion ? "title" : "decree",
  );
  const [charCount, setCharCount] = useState(0);
  const [stampCount, setStampCount] = useState(0);
  const [skipped, setSkipped] = useState(false);

  const chars = useMemo(() => Array.from(decree), [decree]);
  const stamps = useMemo(() => buildCeremonyStamps(deck), [deck]);
  const title = useMemo(() => ceremonyTitle(deck), [deck]);

  // 每字 ~80ms；超 ~150 字加速，压住总时长
  const charInterval = chars.length > 150 ? Math.max(30, 12000 / chars.length) : 80;
  // 拓印错落 ~400ms；条目多时略加速
  const stampInterval = stamps.length > 18 ? 280 : 400;

  // 逐字浮现只保留尾部窗口内的动画节点（窗口覆盖 0.5s 淡入时长），
  // 已完成淡入的前缀提交为纯字符串，避免每帧重渲染 O(N²) 个 motion span
  const tailStart = Math.max(0, charCount - Math.max(1, Math.ceil(600 / charInterval)));
  const committedText = useMemo(
    () => chars.slice(0, tailStart).join(""),
    [chars, tailStart],
  );

  // 鎏金渐亮：神谕逐字铺开时金晕缓缓涨起（reduced-motion 下第一幕整体跳过）
  const decreeProgress = chars.length > 0 ? Math.min(1, charCount / chars.length) : 1;
  const decreeGlow = `0 0 ${(6 + 12 * decreeProgress).toFixed(1)}px var(--gilt-glow)`;

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

  // 第三幕：世界题名晕开后进入等待段
  useEffect(() => {
    if (act !== "title") return;
    const t = setTimeout(() => setAct("hold"), 2600);
    return () => clearTimeout(t);
  }, [act]);

  const animationDone = skipped || act === "hold";

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
      className="play-shell ceremony-veil fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
    >
      <PlayBackground variant="ceremony" />
      {/* 演出主体（跳过后对称淡出，只留等待态） */}
      <AnimatePresence>
        {!skipped && (
          <motion.div
            key="ceremony-content"
            exit={{ opacity: 0, filter: "blur(3px)" }}
            transition={{ duration: 0.4 }}
            className="ceremony-content relative flex w-full max-w-2xl flex-col items-center px-8"
          >
            <AnimatePresence mode="wait">
              {/* 第一幕：原初神谕，金色文楷逐字浮现 */}
              {act === "decree" && (
                <motion.p
                  key="decree"
                  exit={{ opacity: 0, y: 40, filter: "blur(3px)" }}
                  transition={{ duration: 1.1, ease: "easeIn" }}
                  className="text-center text-xl leading-loose text-gilt md:text-2xl"
                  style={{ fontFamily: "var(--font-prose)", textShadow: decreeGlow }}
                >
                  {committedText}
                  {chars.slice(tailStart, charCount).map((ch, i) => (
                    <motion.span
                      key={tailStart + i}
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

              {/* 第三幕：世界时间与史册印记晕开 */}
              {(act === "title" || act === "hold") && (
                <motion.div
                  key="title"
                  initial={{ opacity: 0, filter: "blur(10px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{ duration: 2, ease: "easeOut" }}
                  className="text-center text-ink"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  <h1 className="text-4xl tracking-[0.2em] [text-shadow:0_0_26px_var(--gilt-glow)] md:text-5xl">{title.world}</h1>
                  <p className="mt-5 text-base tracking-widest text-ink-soft">
                    {title.era} · {title.time}
                  </p>
                  <p className="mt-4 text-sm tracking-[0.4em] text-gilt [text-shadow:0_0_14px_var(--gilt-glow)]">{title.seal}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

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
      <AnimatePresence>
        {!skipped && (
          <motion.button
            key="ceremony-skip"
            type="button"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            onClick={() => setSkipped(true)}
            className="absolute bottom-6 right-8 text-sm text-ink-faint transition hover:text-gilt"
          >
            跳过 »
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
