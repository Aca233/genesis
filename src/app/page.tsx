"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/theme/useTheme";

/** 首屏：输入神谕 → 创世 → 跳转卡片编辑器（/genesis/[id]） */
export default function Home() {
  const { candle, setMode } = useTheme();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [decree, setDecree] = useState("");
  const [lorebook, setLorebook] = useState<{ name: string; data: unknown } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 携带典籍：读取 SillyTavern worldbook JSON */
  async function pickLorebook(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重选同一文件
    if (!file) return;
    setError(null);
    try {
      const data: unknown = JSON.parse(await file.text());
      setLorebook({ name: file.name, data });
    } catch {
      setLorebook(null);
      setError("典籍解析失败：请提供有效的 SillyTavern 世界书 JSON 文件。");
    }
  }

  /** 创世：POST /api/worlds → 跳转卡片编辑器 */
  async function create() {
    if (creating) return;
    const text = decree.trim();
    if (text.length < 2) {
      setError("神谕太短——至少说出两个字。");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decree: text,
          ...(lorebook ? { lorebook: lorebook.data } : {}),
        }),
      });
      const json: { worldId?: string; error?: string } = await res.json();
      if (!res.ok || !json.worldId) {
        setError(json.error ?? "创世失败，虚空未曾回应。请稍后再试。");
        setCreating(false);
        return;
      }
      // 成功：保持锁定态直到页面跳转
      router.push(`/genesis/${json.worldId}`);
    } catch {
      setError("创世失败：无法抵达彼岸（网络错误）。");
      setCreating(false);
    }
  }

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
          value={decree}
          onChange={(e) => setDecree(e.target.value)}
          disabled={creating}
          placeholder="我是战锤40K与凡人修仙传融合世界中，飞升失败坠入亚空间的道尊……"
          className="w-full resize-none rounded-lg border border-line bg-paper-sunken p-4 text-ink outline-none transition focus:border-gilt/60 focus:shadow-[0_0_16px_var(--gilt-glow)] disabled:opacity-60"
        />

        {/* 携带典籍（可选） */}
        <div className="mt-2 flex items-center gap-3 text-sm">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={pickLorebook}
            className="hidden"
          />
          {lorebook ? (
            <span className="flex items-center gap-2 text-gilt">
              📜 已携典籍：{lorebook.name}
              <button
                onClick={() => setLorebook(null)}
                disabled={creating}
                className="text-ink-faint transition hover:text-cinnabar"
                title="移除典籍"
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={creating}
              className="text-ink-faint transition hover:text-gilt disabled:opacity-50"
              title="上传 SillyTavern 世界书 JSON，作为创世的设定依据"
            >
              📜 携带典籍（可选：SillyTavern 世界书）
            </button>
          )}
        </div>

        {error && <p className="mt-2 text-sm text-cinnabar">{error}</p>}

        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setMode(candle ? "day" : "candle")}
            className="text-sm text-ink-faint transition hover:text-gilt"
          >
            {candle ? "☀ 展卷于日" : "🕯 燃烛夜读"}
          </button>
          <button
            onClick={create}
            disabled={creating || decree.trim().length < 2}
            className="rounded-md border border-gilt/50 px-6 py-2 text-gilt transition hover:bg-gilt/10 disabled:opacity-50"
          >
            {creating ? "凝聚世界中…" : "创世"}
          </button>
        </div>
      </section>

      <footer className="flex flex-col items-center gap-3 text-xs text-ink-faint">
        <nav className="flex gap-8">
          <Link href="/archives" className="transition hover:text-gilt">
            📜 往昔诸界
          </Link>
          <Link href="/settings" className="transition hover:text-gilt">
            ⚱ 香炉
          </Link>
        </nav>
        <p>——此界之史，由汝亲书——</p>
      </footer>
    </main>
  );
}
