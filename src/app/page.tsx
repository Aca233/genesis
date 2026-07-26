"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { useTheme } from "@/components/theme/useTheme";
import { MaterialPicker } from "@/components/materials/MaterialPicker";
import { PlayBackground } from "@/components/play/PlayBackground";
import { GenesisModeBackground } from "@/components/genesis/GenesisModeBackground";
import type { MaterialSelectionItem } from "@/lib/materials/types";
import { buildGenesisTaskPayload, defaultGenesisMode } from "@/lib/genesis/create-request";
import { WORLD_MODES, WORLD_MODE_PRESENTATION, type WorldMode } from "@/lib/world-mode";

/** 续玩入口所需的世界摘要（GET /api/worlds 已按 updatedAt desc 排序） */
type LastWorld = { id: string; name: string; status: string; updatedAt: string };

/** 相对时间：续玩入口的「上回书」时间标注 */
function relativeTime(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const minutes = Math.floor((Date.now() - t) / 60000);
  if (minutes < 1) return "方才";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 首屏：输入神谕 → 创世 → 跳转卡片编辑器（/genesis/[id]） */
export default function Home() {
  const { candle, setMode } = useTheme();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [worldMode, setWorldMode] = useState<WorldMode>(defaultGenesisMode);
  const [decree, setDecree] = useState("");
  const [lorebook, setLorebook] = useState<{ name: string; data: unknown } | null>(null);
  const [creating, setCreating] = useState(false);
  const [materialSelections, setMaterialSelections] = useState<MaterialSelectionItem[]>([]);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsModelHint, setNeedsModelHint] = useState(false);
  const [lastWorld, setLastWorld] = useState<LastWorld | null>(null);

  // 未配模型引导 + 续玩入口：两者失败均静默，不挡创建流
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings")
      .then((res) => (res.ok ? (res.json() as Promise<{ narrativeSlot?: unknown }>) : null))
      .then((json) => {
        if (!cancelled && json && !json.narrativeSlot) setNeedsModelHint(true);
      })
      .catch(() => {});
    void fetch("/api/worlds")
      .then((res) => (res.ok ? (res.json() as Promise<{ worlds?: LastWorld[] }>) : null))
      .then((json) => {
        const latest = json?.worlds?.[0];
        if (!cancelled && latest) setLastWorld(latest);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  /** 创世：持久化任务建立后立刻跳转到可恢复的进度页 */
  async function create() {
    if (creating) return;
    const text = decree.trim();
    if (text.length < 2) {
      setError(`${WORLD_MODE_PRESENTATION[worldMode].validationNoun}太短——至少说出两个字。`);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/genesis/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGenesisTaskPayload({
          mode: worldMode,
          decree: text,
          lorebook,
          materialSelections,
        })),
      });
      const json: { taskId?: string; error?: string } = await res.json();
      if (!res.ok || !json.taskId) {
        setError(json.error ?? "创世失败，虚空未曾回应。请稍后再试。");
        setCreating(false);
        return;
      }
      // 成功：保持锁定态直到页面跳转
      router.push(`/genesis/progress/${json.taskId}`);
    } catch {
      setError("创世失败：无法抵达彼岸（网络错误）。");
      setCreating(false);
    }
  }

  return (
    <main className="play-shell flex flex-1 flex-col items-center justify-center gap-10 px-6">
      <PlayBackground variant="home" />
      <GenesisModeBackground mode={worldMode} />
      <header className="relative text-center">
        <h1
          className="text-6xl font-black tracking-widest text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          创世
        </h1>
        <p className="mt-4 text-balance text-ink-soft">
          {WORLD_MODE_PRESENTATION[worldMode].subtitle}
        </p>
      </header>

      <section className="home-genesis-panel relative w-full max-w-xl">
        {needsModelHint && (
          <p className="mb-4 rounded-md border border-gilt/40 bg-gilt/5 px-3 py-2 text-sm text-gilt">
            尚未配置叙事模型——先往{" "}
            <Link href="/settings" className="underline">
              香炉
            </Link>{" "}
            封存你的 Key。
          </p>
        )}
        <fieldset className="mb-4" disabled={creating}>
          <legend className="mb-2 text-sm text-ink-faint">选择世界模式（创建后不可更改）</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {WORLD_MODES.map((mode) => {
              const copy = WORLD_MODE_PRESENTATION[mode];
              const selected = worldMode === mode;
              return (
                <label
                  key={mode}
                  className={`cursor-pointer rounded-lg border p-4 transition ${
                    selected
                      ? "border-gilt bg-gilt/10 shadow-[0_0_14px_var(--gilt-glow)]"
                      : "border-line bg-paper-raised hover:border-gilt/40"
                  } ${creating ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <span className="flex items-center gap-2 font-bold text-ink">
                    <input
                      type="radio"
                      name="world-mode"
                      value={mode}
                      checked={selected}
                      onChange={() => setWorldMode(mode)}
                      disabled={creating}
                      className="accent-[var(--gilt)]"
                    />
                    {copy.label}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-ink-soft">
                    {copy.description}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <textarea
          rows={3}
          value={decree}
          onChange={(e) => setDecree(e.target.value)}
          disabled={creating}
          placeholder={WORLD_MODE_PRESENTATION[worldMode].placeholder}
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

        <button type="button" onClick={() => setMaterialPickerOpen(true)} disabled={creating} className="mt-3 rounded border border-line px-3 py-1.5 text-sm text-gilt hover:border-gilt/50">
          ✦ 引用创世素材（已选 {materialSelections.length} 项）
        </button>

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

      <AnimatePresence>
        {materialPickerOpen && <MaterialPicker value={materialSelections} onChange={setMaterialSelections} onClose={() => setMaterialPickerOpen(false)} />}
      </AnimatePresence>

      {lastWorld && (
        <p className="relative text-sm text-ink-faint">
          上回书：<span className="text-ink-soft">{lastWorld.name}</span>
          {relativeTime(lastWorld.updatedAt) && (
            <span className="ml-2 text-xs">{relativeTime(lastWorld.updatedAt)}</span>
          )}{" "}
          <Link
            className="text-gilt hover:underline"
            href={lastWorld.status === "draft" ? `/genesis/${lastWorld.id}` : `/play/${lastWorld.id}`}
          >
            {lastWorld.status === "draft" ? "续掷卡组" : "入界"} →
          </Link>
        </p>
      )}

      <footer className="relative flex flex-col items-center gap-3 text-xs text-ink-faint">
        <nav className="flex gap-8">
          <Link href="/archives" className="transition hover:text-gilt">
            📜 往昔诸界
          </Link>
          <Link href="/materials" className="transition hover:text-gilt">
            ✦ 万象藏库
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
