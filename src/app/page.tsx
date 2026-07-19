"use client";

import { useTheme } from "@/components/theme/useTheme";

export default function Home() {
  const { candle, setMode } = useTheme();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 px-6">
      <header className="text-center">
        <h1
          className="text-6xl font-black tracking-widest text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          创世
        </h1>
        <p className="mt-4 text-ink-soft">
          说出你的第一句神谕——你是谁，这是怎样的世界。
        </p>
      </header>

      <section className="w-full max-w-xl">
        <textarea
          rows={3}
          placeholder="我是战锤40K与凡人修仙传融合世界中，飞升失败坠入亚空间的道尊……"
          className="w-full resize-none rounded-lg border border-line bg-paper-sunken p-4 text-ink outline-none transition focus:border-gilt/60 focus:shadow-[0_0_16px_var(--gilt-glow)]"
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setMode(candle ? "day" : "candle")}
            className="text-sm text-ink-faint transition hover:text-gilt"
          >
            {candle ? "☀ 展卷于日" : "🕯 燃烛夜读"}
          </button>
          <button
            className="rounded-md border border-gilt/50 px-6 py-2 text-gilt transition hover:bg-gilt/10 disabled:opacity-50"
            disabled
            title="世界生成尚未接入（M1.3）"
          >
            创世
          </button>
        </div>
      </section>

      <footer className="text-xs text-ink-faint">
        ——此界之史，由汝亲书——
      </footer>
    </main>
  );
}
