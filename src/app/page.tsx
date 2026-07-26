"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { useTheme } from "@/components/theme/useTheme";
import { MaterialPicker } from "@/components/materials/MaterialPicker";
import { PlayBackground } from "@/components/play/PlayBackground";
import { GenesisModeBackground } from "@/components/genesis/GenesisModeBackground";
import { OperationIcon } from "@/components/icons/OperationIcon";
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

/* ── 世界模式蚀刻纹章：与背景星图共用同一种刻线语言，选中即点燃 ── */

/** 万神星环（诸神共世）：外环嵌四方星点，环心燃四芒星 */
function PantheonSigil() {
  return (
    <svg
      viewBox="0 0 32 32"
      width={30}
      height={30}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="12.6" strokeOpacity={0.85} />
      <circle cx="16" cy="16" r="9" strokeWidth={0.75} strokeDasharray="2.2 2.9" strokeOpacity={0.6} />
      <path
        d="M16 1.2 L16.9 3.4 L16 5.6 L15.1 3.4 Z M30.8 16 L28.6 16.9 L26.4 16 L28.6 15.1 Z M16 30.8 L15.1 28.6 L16 26.4 L16.9 28.6 Z M1.2 16 L3.4 15.1 L5.6 16 L3.4 16.9 Z"
        fill="currentColor"
        fillOpacity={0.8}
        stroke="none"
      />
      <circle cx="22.4" cy="9.6" r="0.8" fill="currentColor" fillOpacity={0.55} stroke="none" />
      <circle cx="22.4" cy="22.4" r="0.8" fill="currentColor" fillOpacity={0.55} stroke="none" />
      <circle cx="9.6" cy="22.4" r="0.8" fill="currentColor" fillOpacity={0.55} stroke="none" />
      <circle cx="9.6" cy="9.6" r="0.8" fill="currentColor" fillOpacity={0.55} stroke="none" />
      <path
        d="M16 11.5 L17.2 14.8 L20.5 16 L17.2 17.2 L16 20.5 L14.8 17.2 L11.5 16 L14.8 14.8 Z"
        fill="currentColor"
        fillOpacity={0.9}
        stroke="none"
      />
    </svg>
  );
}

/** 造物主之目（创世主）：全视之瞳，虹膜刻弦纹，上下射睫线 */
function CreatorSigil() {
  return (
    <svg
      viewBox="0 0 32 32"
      width={30}
      height={30}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.6 16 C7.6 9.6 24.4 9.6 29.4 16 C24.4 22.4 7.6 22.4 2.6 16 Z" strokeOpacity={0.85} />
      <circle cx="16" cy="16" r="4.6" strokeOpacity={0.9} />
      <circle cx="16" cy="16" r="3" strokeWidth={0.7} strokeDasharray="1.6 1.9" strokeOpacity={0.55} />
      <circle cx="16" cy="16" r="1.8" fill="currentColor" stroke="none" />
      <path
        d="M16 3 V6 M16 29 V26 M6.8 5.4 L8.4 8 M25.2 5.4 L23.6 8 M6.8 26.6 L8.4 24 M25.2 26.6 L23.6 24"
        strokeOpacity={0.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

const MODE_SIGILS: Record<WorldMode, ComponentType> = {
  pantheon: PantheonSigil,
  creator: CreatorSigil,
};

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
    // 弃 justify-center 改首尾 auto 边距：高度富余时依旧居中，
    // 内容超出小屏视口时自然滚动，巨题与落款不再被上下裁切
    <main className="play-shell flex flex-1 flex-col items-center gap-10 px-6 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <PlayBackground variant="home" />
      <GenesisModeBackground mode={worldMode} />
      <header className="relative mt-auto text-center">
        <h1
          className="text-5xl font-black tracking-widest text-ink sm:text-6xl"
          style={{ fontFamily: "var(--font-display)", textShadow: "0 0 30px var(--gilt-glow)" }}
        >
          创世
        </h1>
        <p className="mt-4 text-balance text-ink-soft">
          {WORLD_MODE_PRESENTATION[worldMode].subtitle}
        </p>
      </header>

      <section className="home-genesis-panel tome-plate tome-plate--corners relative w-full max-w-xl">
        {/* 陈年晕渍与星角纹饰分占两层（均用 ::after），故以覆层承载晕渍 */}
        <div
          aria-hidden="true"
          className="stain-vignette"
          style={{ position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none" }}
        />
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
          <legend className="illuminated-header letterpress mb-3 w-full">
            <span className="text-center">
              <span className="whitespace-nowrap">选择世界模式</span>
              <span className="whitespace-nowrap text-[0.85em] tracking-normal text-ink-faint">（创建后不可更改）</span>
            </span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {WORLD_MODES.map((mode) => {
              const copy = WORLD_MODE_PRESENTATION[mode];
              const selected = worldMode === mode;
              const Sigil = MODE_SIGILS[mode];
              return (
                <label
                  key={mode}
                  className={`relative flex cursor-pointer flex-col gap-2.5 rounded-lg border p-4 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gilt ${
                    selected
                      ? "border-gilt/50 bg-gilt/10 shadow-[inset_0_0_1.5rem_var(--gilt-glow),0_0_0.9rem_var(--gilt-glow)]"
                      : "border-line bg-paper-raised hover:border-gilt/40"
                  } ${creating ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  {/* 原生单选钮仅供无障碍与键盘导航，视觉交由纹章点燃承担 */}
                  <input
                    type="radio"
                    name="world-mode"
                    value={mode}
                    checked={selected}
                    onChange={() => setWorldMode(mode)}
                    disabled={creating}
                    className="sr-only"
                  />
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex-none transition duration-300 ${
                        selected
                          ? "text-gilt drop-shadow-[0_0_5px_var(--seal-glow)]"
                          : "text-ink-faint"
                      }`}
                    >
                      <Sigil />
                    </span>
                    <span className="display-md text-ink">{copy.label}</span>
                  </span>
                  <span className="block text-xs leading-5 text-ink-soft">
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

        {/* 携带典籍/引用素材：静而有质——发丝分隔线代替浮空文字 */}
        <div className="mt-4 text-sm">
          <div className="flex min-h-11 items-center gap-3 border-t border-line py-2">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={pickLorebook}
              className="hidden"
            />
            {lorebook ? (
              <span className="flex items-center gap-2 text-gilt">
                <OperationIcon name="scroll" size={14} /> 已携典籍：{lorebook.name}
                <button
                  onClick={() => setLorebook(null)}
                  disabled={creating}
                  className="text-ink-faint transition hover:text-cinnabar"
                  title="移除典籍"
                >
                  <OperationIcon name="close" size={12} />
                </button>
              </span>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={creating}
                className="flex items-center gap-1.5 text-ink-faint transition hover:text-gilt disabled:opacity-50"
                title="上传 SillyTavern 世界书 JSON，作为创世的设定依据"
              >
                <OperationIcon name="scroll" size={14} /> 携带典籍（可选：SillyTavern 世界书）
              </button>
            )}
          </div>
          <div className="flex min-h-11 items-center border-t border-line py-2">
            <button
              type="button"
              onClick={() => setMaterialPickerOpen(true)}
              disabled={creating}
              className="flex items-center gap-1.5 text-gilt transition hover:text-gilt-strong disabled:opacity-50"
            >
              <OperationIcon name="materials" size={14} /> 引用创世素材（已选 {materialSelections.length} 项）
            </button>
          </div>
        </div>

        {error && <p className="mt-2 text-sm text-cinnabar">{error}</p>}

        <div className="mt-4 flex flex-col gap-4 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={() => setMode(candle ? "day" : "candle")}
            className="flex items-center gap-1.5 self-start text-sm text-ink-faint transition hover:text-gilt sm:self-auto"
          >
            {candle
              ? <><OperationIcon name="sun" size={14} /> 展卷于日</>
              : <><OperationIcon name="candle" size={14} /> 燃烛夜读</>}
          </button>
          {/* 典仪级 CTA：玺印钮——此页最亮之物；禁用是未点燃的蜡印而非幽灵 */}
          <button
            onClick={create}
            disabled={creating || decree.trim().length < 2}
            className="seal-button w-full text-base sm:w-auto sm:min-w-44"
          >
            {creating ? "凝聚世界中…" : "创世"}
          </button>
        </div>
      </section>

      <AnimatePresence>
        {materialPickerOpen && <MaterialPicker value={materialSelections} onChange={setMaterialSelections} onClose={() => setMaterialPickerOpen(false)} />}
      </AnimatePresence>

      {lastWorld && (
        <div className="relative flex w-full max-w-xl items-center gap-2.5 overflow-hidden rounded-md border border-line bg-paper-raised/75 py-2.5 pl-4 pr-3 text-sm shadow-[0_2px_12px_var(--shadow-warm)]">
          {/* 微型书脊：鎏金脊线让「上回书」像一册薄薄的书 */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1"
            style={{
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--gilt) 78%, transparent), color-mix(in srgb, var(--gilt) 34%, transparent) 50%, color-mix(in srgb, var(--gilt) 78%, transparent))",
            }}
          />
          <span className="flex-none text-ink-faint">上回书：</span>
          <span
            className="min-w-0 truncate font-bold text-gilt-strong"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "0.04em" }}
          >
            {lastWorld.name}
          </span>
          {relativeTime(lastWorld.updatedAt) && (
            <span className="flex-none text-xs text-ink-faint">{relativeTime(lastWorld.updatedAt)}</span>
          )}
          <Link
            className="ml-auto flex-none text-gilt transition hover:text-gilt-strong hover:drop-shadow-[0_0_6px_var(--seal-glow)]"
            href={lastWorld.status === "draft" ? `/genesis/${lastWorld.id}` : `/play/${lastWorld.id}`}
          >
            {lastWorld.status === "draft" ? "续掷卡组" : "入界"} →
          </Link>
        </div>
      )}

      <footer className="relative mb-auto flex flex-col items-center gap-4 text-xs text-ink-faint">
        {/* 镌刻导引：字距拉开如卷末牌记，纹样与文字光学对齐 */}
        <nav className="flex gap-6 sm:gap-8">
          <Link href="/archives" className="flex items-center gap-2 tracking-[0.22em] transition hover:text-gilt">
            <span aria-hidden="true" className="flex-none translate-y-[0.5px]">
              <OperationIcon name="archives" size={13} />
            </span>
            往昔诸界
          </Link>
          <Link href="/materials" className="flex items-center gap-2 tracking-[0.22em] transition hover:text-gilt">
            <span aria-hidden="true" className="flex-none translate-y-[0.5px]">
              <OperationIcon name="materials" size={13} />
            </span>
            万象藏库
          </Link>
          <Link href="/settings" className="flex items-center gap-2 tracking-[0.22em] transition hover:text-gilt">
            <span aria-hidden="true" className="flex-none translate-y-[0.5px]">
              <OperationIcon name="censer" size={13} />
            </span>
            香炉
          </Link>
        </nav>
        {/* 卷末落款：宋体展示字略放大、墨色加深，让页面以一记收笔结束 */}
        <p
          className="text-[0.95rem] tracking-[0.2em] text-ink-soft"
          style={{ fontFamily: "var(--font-display)" }}
        >
          ——此界之史，由汝亲书——
        </p>
      </footer>
    </main>
  );
}
