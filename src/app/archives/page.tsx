"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlayBackground } from "@/components/play/PlayBackground";
import { OperationIcon } from "@/components/icons/OperationIcon";
import { worldModeLabel, type WorldMode } from "@/lib/world-mode";
import {
  countUnreadActivities,
  type ActivityCursor,
} from "@/components/play/world-activity-panel-state";

/** 存档列表项（GET /api/worlds 返回 shape） */
type WorldItem = {
  id: string;
  mode: WorldMode;
  name: string;
  genesisInput: string;
  status: string; // draft | playing | concluded
  materialArchiveStatus: string;
  materialArchiveError: string | null;
  createdAt: string;
  updatedAt: string;
  /** 进行中世界的状态行：你离开时正在发生什么（仅 playing + 有活动时间线） */
  statusLine?: {
    timelineId: string;
    era: string;
    time: string;
    trackedEventTitle: string | null;
    recentActivityRefs: { id: string; createdAt: string }[];
  };
};

/** 未读动态数：读取入界页写下的本地阅读游标，与状态行动态引用对比 */
function unreadFor(w: WorldItem): number {
  if (!w.statusLine || typeof window === "undefined") return 0;
  let cursor: ActivityCursor | null = null;
  try {
    // 键格式与入界页（/play/[worldId]）完全一致
    const raw = window.localStorage.getItem(
      `genesis:activity-cursor:${w.id}:${w.statusLine.timelineId}`,
    );
    cursor = raw ? (JSON.parse(raw) as ActivityCursor) : null;
  } catch {
    cursor = null;
  }
  return countUnreadActivities(w.statusLine.recentActivityRefs, cursor);
}

/** 蜡印章底座：微倾斜的圆形封蜡 + 同色内圈压纹 */
const WAX_SEAL_BASE =
  "inline-flex shrink-0 -rotate-2 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-[0.1em] shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_26%,transparent)] [font-family:var(--font-display)]";

/** 状态封蜡：草稿是未点燃的暗蜡，进行中是鎏金微焕，已成史落朱砂印 */
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "border-fog/50 bg-fog/10 text-fog" },
  playing: {
    label: "进行中",
    cls: "border-gilt/60 bg-gilt/10 text-gilt-strong shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_26%,transparent),0_0_8px_var(--gilt-glow)]",
  },
  concluded: { label: "已成史", cls: "border-cinnabar/55 bg-cinnabar/10 text-cinnabar" },
};

/** 时间显示：本地化短格式 */
function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 原初神谕摘录 */
function excerpt(text: string, max = 64) {
  return text.length > max ? `${text.slice(0, max)}……` : text;
}

/* ── 书脊纹章：与首页模式纹章同一种刻线语言的缩刻版 ── */

/** 万神星环（诸神共世） */
function PantheonSpineSigil() {
  return (
    <svg
      viewBox="0 0 32 32"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="16" cy="16" r="12" strokeOpacity={0.9} />
      <circle cx="16" cy="16" r="8.4" strokeWidth={0.9} strokeDasharray="2.2 2.9" strokeOpacity={0.6} />
      <path
        d="M16 10.5 L17.4 14.6 L21.5 16 L17.4 17.4 L16 21.5 L14.6 17.4 L10.5 16 L14.6 14.6 Z"
        fill="currentColor"
        fillOpacity={0.9}
        stroke="none"
      />
    </svg>
  );
}

/** 造物主之目（创世主） */
function CreatorSpineSigil() {
  return (
    <svg
      viewBox="0 0 32 32"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 16 C8.3 10 23.7 10 28.5 16 C23.7 22 8.3 22 3.5 16 Z" strokeOpacity={0.9} />
      <circle cx="16" cy="16" r="4.2" strokeOpacity={0.9} />
      <circle cx="16" cy="16" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 书脊配色：诸神共世取鎏金皮革，创世主取深墨底（双主题同为深底，纹章在其上镌刻） */
const SPINE: Record<WorldMode, { background: string; emblem: string }> = {
  pantheon: {
    background:
      "linear-gradient(180deg, color-mix(in srgb, var(--gilt) 72%, var(--seal-ground-hi)), color-mix(in srgb, var(--gilt) 34%, var(--seal-ground-lo)))",
    emblem: "rgba(26, 18, 8, 0.85)",
  },
  creator: {
    background: "linear-gradient(180deg, var(--seal-ground-hi), var(--seal-ground-lo))",
    emblem: "color-mix(in srgb, var(--gilt-bright) 82%, transparent)",
  },
};

export default function ArchivesPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [worlds, setWorlds] = useState<WorldItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/worlds");
      const json: { worlds?: WorldItem[]; error?: string } = await res.json();
      if (!res.ok) throw new Error(json.error ?? "读取失败");
      setWorlds(json.worlds ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // defer 避免 effect 内同步 setState 触发级联渲染
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  /** 导入存档：选 JSON → POST /api/worlds/import */
  async function pickImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setImporting(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error("存档解析失败：不是有效的 JSON 文件。");
      }
      const res = await fetch("/api/worlds/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json: { worldId?: string; error?: string } = await res.json();
      if (!res.ok) throw new Error(json.error ?? "导入失败。");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  /** 删除（二次确认后执行） */
  async function retryArchive(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${id}/materials/archive`, { method: "POST" });
      const json: { error?: string } = await res.json();
      if (!res.ok) throw new Error(json.error ?? "重试归档失败");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function remove(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "删除失败。");
      }
      setWorlds((ws) => ws?.filter((w) => w.id !== id) ?? ws);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    // 弃中间包裹面板：世界书卷直接陈于星案之上，各自投下暖影
    <main className="play-shell min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <PlayBackground variant="supporting" />
      <div className="mx-auto w-full min-w-0 max-w-2xl [overflow-wrap:anywhere]">
        <header className="mb-8 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="text-sm text-ink-faint transition hover:text-gilt">
              ← 回到原初
            </Link>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                onChange={pickImport}
                className="hidden"
              />
              {/* 黄铜小器钮：玺印钮的紧凑变体 */}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="seal-button min-h-9! px-4! py-1.5! text-xs"
              >
                {importing ? "复现世界中…" : "⬆ 导入存档"}
              </button>
            </div>
          </div>
          <h1 className="illuminated-header display-lg">
            <span className="illuminated-header__glyph" aria-hidden="true">
              <OperationIcon name="archives" size={22} />
            </span>
            往昔诸界
          </h1>
          <p className="text-center text-sm text-ink-soft">
            汝所书写过的每一部创世史，皆封存于此。
          </p>
        </header>

        {error && worlds !== null && <p className="mb-4 text-sm text-cinnabar">{error}</p>}

        {worlds === null ? (
          error ? (
            <p className="py-16 text-center text-sm text-cinnabar">
              {error}{" "}
              <button
                onClick={() => {
                  setError(null);
                  void load();
                }}
                className="underline"
              >
                重试
              </button>
            </p>
          ) : (
            <p className="letterpress py-16 text-center">展卷中…</p>
          )
        ) : worlds.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gilt/30 bg-paper-raised/40 py-16 text-center shadow-tome">
            <p className="fog-text">尚无世界。回到原初，说出第一句神谕。</p>
            <Link
              href="/"
              className="mt-4 inline-block text-sm text-gilt transition hover:underline"
            >
              → 回到原初
            </Link>
          </div>
        ) : (
          <ul className="grid min-w-0 gap-5">
            {worlds.map((w, index) => {
              const badge = STATUS_BADGE[w.status] ?? {
                label: w.status,
                cls: "border-line bg-paper-sunken/40 text-ink-faint",
              };
              const enterHref =
                w.status === "draft" ? `/genesis/${w.id}` : `/play/${w.id}`;
              const unread = unreadFor(w);
              const spine = SPINE[w.mode] ?? SPINE.pantheon;
              return (
                <li
                  key={w.id}
                  className="tome-plate min-w-0 overflow-hidden p-5 pl-14"
                >
                  {/* 书架节奏：奇数册以微沉纸色区分 */}
                  {index % 2 === 1 && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-[inherit]"
                      style={{ background: "color-mix(in srgb, var(--paper-sunken) 36%, transparent)" }}
                    />
                  )}
                  {/* 书脊：按世界模式着色并镌刻纹章 */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 flex w-9 justify-center rounded-l-[inherit] pt-4"
                    style={{
                      background: spine.background,
                      boxShadow:
                        "inset -1px 0 0 rgba(0, 0, 0, 0.22), inset 1px 0 0 rgba(255, 235, 190, 0.1)",
                    }}
                  >
                    <span style={{ color: spine.emblem }}>
                      {w.mode === "creator" ? <CreatorSpineSigil /> : <PantheonSpineSigil />}
                    </span>
                  </span>

                  <div className="relative flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
                    <div className="min-w-0 w-full">
                      <h2
                        className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xl text-gilt-strong [text-shadow:0_0_14px_var(--gilt-glow)]"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        <span className="min-w-0 max-w-full truncate">{w.name}</span>
                        <span className="inline-flex shrink-0 items-center gap-2">
                          <span className={`${WAX_SEAL_BASE} ${badge.cls}`}>
                            {badge.label}
                          </span>
                          <span className="rounded-sm border border-gilt/30 bg-gilt/5 px-1.5 py-0.5 text-[11px] font-normal tracking-[0.14em] text-gilt [font-family:var(--font-display)]">
                            {worldModeLabel(w.mode)}
                          </span>
                        </span>
                      </h2>
                      <p className="decree mt-2 text-sm">
                        {excerpt(w.genesisInput)}
                      </p>
                      {w.statusLine && (
                        <p className="mt-3 flex min-w-0 items-center border-t border-line/80 pt-2 text-xs tracking-[0.06em] text-ink-soft">
                          <span className="shrink-0">
                            「{w.statusLine.era} · {w.statusLine.time}」
                          </span>
                          {w.statusLine.trackedEventTitle && (
                            <span className="ml-2 min-w-0 max-w-[14rem] truncate">
                              追踪：{w.statusLine.trackedEventTitle}
                            </span>
                          )}
                          {unread > 0 && (
                            <span className="ml-2 shrink-0 rounded-full border border-gilt/45 bg-gilt/10 px-2 py-px text-gilt shadow-[0_0_6px_var(--gilt-glow)]">
                              {unread} 条新动态
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <time className="shrink-0 text-xs tracking-[0.06em] text-ink-faint">
                      {fmtTime(w.updatedAt)}
                    </time>
                  </div>

                  {w.materialArchiveStatus === "failed" && (
                    <div className="relative mt-3 rounded border border-cinnabar/30 bg-cinnabar/5 p-2 text-xs text-cinnabar">
                      万象藏库自动收录失败：{w.materialArchiveError ?? "未知错误"}
                      <button type="button" onClick={() => void retryArchive(w.id)} className="ml-2 underline">重试收录</button>
                    </div>
                  )}
                  <div className="relative mt-4 flex items-center gap-4 border-t border-line pt-3 text-sm">
                    {/* 入界升为玺印小钮；导出/删除保持静默文字 */}
                    <button
                      onClick={() => router.push(enterHref)}
                      className="seal-button min-h-8! px-4! py-1! text-xs"
                    >
                      {w.status === "draft"
                        ? "续掷卡组"
                        : w.status === "concluded"
                          ? "览史"
                          : "入界"}
                    </button>
                    <a
                      href={`/api/worlds/${w.id}/export`}
                      className="text-ink-soft transition hover:text-gilt"
                    >
                      导出
                    </a>
                    {confirmDeleteId === w.id ? (
                      <span className="flex items-center gap-2 text-cinnabar">
                        抹去此界？不可复得。
                        <button
                          onClick={() => remove(w.id)}
                          disabled={deletingId === w.id}
                          className="font-bold underline disabled:opacity-50"
                        >
                          {deletingId === w.id ? "抹去中…" : "确认"}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-ink-faint hover:text-ink"
                        >
                          且慢
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(w.id)}
                        className="text-ink-faint transition hover:text-cinnabar"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="mt-10 text-center text-xs text-ink-faint">
          <Link href="/" className="transition hover:text-gilt">
            ← 回到原初
          </Link>
        </footer>
      </div>
    </main>
  );
}
