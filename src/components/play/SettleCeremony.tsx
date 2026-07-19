"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

/**
 * 岁月流转：章末结算的仪式化演出（docs/05 §4.2）。
 * SSE 进度驱动低语碎片；完成后新章标题晕开；失败可断点续跑。
 */

type Progress = {
  step: string;
  detail?: string;
  index?: number;
  total?: number;
};

/** 固定低语池（不剧透，只渲染氛围） */
const WHISPERS = [
  "北境有神低语……",
  "星辰悄然移位……",
  "有誓约在暗中缔结……",
  "远方的祭火明灭不定……",
  "史官蘸墨，烛影摇红……",
  "岁月在卷轴上流淌……",
];

function stepWhisper(p: Progress): string {
  switch (p.step) {
    case "pantheon":
      return p.total
        ? `诸神在你看不见的地方行动着（${p.index}/${p.total}）`
        : "诸神在你看不见的地方行动着……";
    case "extract":
      return "史官清点众生……";
    case "chronicle":
      return "落笔成史……";
    case "decay":
      return "岁月抚平微尘……";
    case "snapshot":
      return "此章封卷……";
    default:
      return WHISPERS[Math.floor(Math.random() * WHISPERS.length)];
  }
}

export function SettleCeremony({
  chapterId,
  onFinished,
  onClose,
}: {
  chapterId: string;
  /** 结算完成（含新章 id）后回调 */
  onFinished: (nextChapterId: string | null) => void;
  /** 玩家在错误状态下放弃 */
  onClose: () => void;
}) {
  const [whisper, setWhisper] = useState("岁月开始流转……");
  const [phase, setPhase] = useState<"running" | "title" | "error">("running");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [skipFx, setSkipFx] = useState(false);
  const nextIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  // 闲时低语轮换
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => {
      setWhisper((w) =>
        Math.random() > 0.6
          ? WHISPERS[Math.floor(Math.random() * WHISPERS.length)]
          : w,
      );
    }, 3200);
    return () => clearInterval(t);
  }, [phase]);

  // 发起（或续跑）结算
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setPhase("running");
    setError(null);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/settle`, {
        method: "POST",
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? `结算失败（${res.status}）`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of chunk.split("\n")) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            try {
              const evt = JSON.parse(t.slice(5));
              if (evt.type === "progress") {
                setWhisper(stepWhisper(evt as Progress));
              } else if (evt.type === "done") {
                nextIdRef.current = evt.nextChapterId ?? null;
                setTitle(evt.title ?? null);
                setPhase("title");
                setTimeout(() => onFinished(nextIdRef.current), 2200);
                return;
              } else if (evt.type === "error") {
                throw new Error(evt.message ?? "结算中断");
              }
            } catch (err) {
              if (err instanceof Error && err.message !== t) throw err;
            }
          }
        }
      }
      throw new Error("结算流意外结束");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="settle-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex flex-col items-center justify-center"
        style={{
          background:
            "radial-gradient(ellipse at center, var(--paper) 30%, color-mix(in srgb, var(--paper) 70%, black) 100%)",
        }}
      >
        {phase === "running" && (
          <>
            {/* 翻动的书页 */}
            {!skipFx && (
              <div className="relative mb-10 h-28 w-44">
                <div className="absolute inset-0 rounded border border-line bg-paper-raised shadow-lg" />
                <motion.div
                  className="absolute inset-0 origin-left rounded border border-line bg-paper-raised shadow"
                  animate={{ rotateY: [0, -160, -160, 0] }}
                  transition={{
                    duration: 3.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    times: [0, 0.45, 0.55, 1],
                  }}
                  style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
                />
              </div>
            )}
            <motion.p
              key={whisper}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 0.75, y: 0 }}
              className="fog-text px-8 text-center text-sm"
            >
              {whisper}
            </motion.p>
            <button
              onClick={() => setSkipFx(true)}
              className="absolute bottom-6 right-8 text-xs text-ink-faint transition hover:text-gilt"
            >
              简化演出 »
            </button>
          </>
        )}

        {phase === "title" && (
          <motion.h2
            initial={{ opacity: 0, filter: "blur(12px)", scale: 1.05 }}
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
            className="px-8 text-center text-3xl text-ink"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title ? `${title}` : "新章将启"}
          </motion.h2>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-4 px-8">
            <p className="text-sm text-cinnabar">✗ 岁月凝滞：{error}</p>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  startedRef.current = false;
                  setPhase("running");
                  startedRef.current = true;
                  void run();
                }}
                className="rounded-md border border-gilt/50 px-5 py-1.5 text-sm text-gilt transition hover:bg-gilt/10"
              >
                续结此章
              </button>
              <button
                onClick={onClose}
                className="text-sm text-ink-faint transition hover:text-ink"
              >
                稍后再说
              </button>
            </div>
            <p className="text-xs text-ink-faint">
              结算支持断点续跑——已完成的部分不会重复。
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
