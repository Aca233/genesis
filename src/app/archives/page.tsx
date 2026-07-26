"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CelestialPageShell } from "@/components/layout/CelestialPageShell";
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

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "text-ink-faint border-line" },
  playing: { label: "进行中", cls: "text-gilt border-gilt/40" },
  concluded: { label: "已成史", cls: "text-cinnabar border-cinnabar/40" },
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
    <CelestialPageShell contentClassName="mx-auto w-full max-w-2xl">
      <header className="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/" className="text-sm text-ink-faint hover:text-gilt">
            ← 回到原初
          </Link>
          <h1
            className="mt-2 flex items-center gap-2 text-3xl text-ink"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <OperationIcon name="archives" size={26} /> 往昔诸界
          </h1>
          <p className="mt-2 text-sm text-ink-faint">
            汝所书写过的每一部创世史，皆封存于此。
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            onChange={pickImport}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded-md border border-gilt/50 px-4 py-1.5 text-sm text-gilt transition hover:bg-gilt/10 disabled:opacity-40"
          >
            {importing ? "复现世界中…" : "⬆ 导入存档"}
          </button>
        </div>
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
          <p className="py-16 text-center text-ink-faint">展卷中…</p>
        )
      ) : worlds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line py-16 text-center">
          <p className="fog-text">尚无世界。回到原初，说出第一句神谕。</p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm text-gilt transition hover:underline"
          >
            → 回到原初
          </Link>
        </div>
      ) : (
        <ul className="grid min-w-0 gap-4">
          {worlds.map((w) => {
            const badge = STATUS_BADGE[w.status] ?? {
              label: w.status,
              cls: "text-ink-faint border-line",
            };
            const enterHref =
              w.status === "draft" ? `/genesis/${w.id}` : `/play/${w.id}`;
            const unread = unreadFor(w);
            return (
              <li
                key={w.id}
                className="min-w-0 rounded-lg border border-line bg-paper-raised p-5"
              >
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
                  <div className="min-w-0 w-full">
                    <h2
                      className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xl text-ink"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      <span className="min-w-0 max-w-full truncate">{w.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-xs ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        <span className="rounded border border-gilt/25 bg-gilt/5 px-1.5 py-0.5 text-xs text-gilt">
                          {worldModeLabel(w.mode)}
                        </span>
                      </span>
                    </h2>
                    <p className="decree mt-2 text-sm">
                      {excerpt(w.genesisInput)}
                    </p>
                    {w.statusLine && (
                      <p className="mt-2 flex min-w-0 items-center text-xs text-ink-soft">
                        <span className="shrink-0">
                          「{w.statusLine.era} · {w.statusLine.time}」
                        </span>
                        {w.statusLine.trackedEventTitle && (
                          <span className="ml-2 min-w-0 max-w-[14rem] truncate">
                            追踪：{w.statusLine.trackedEventTitle}
                          </span>
                        )}
                        {unread > 0 && (
                          <span className="ml-2 shrink-0 text-gilt">
                            {unread} 条新动态
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <time className="shrink-0 text-xs text-ink-faint">
                    {fmtTime(w.updatedAt)}
                  </time>
                </div>

                {w.materialArchiveStatus === "failed" && (
                  <div className="mt-3 rounded border border-cinnabar/30 bg-cinnabar/5 p-2 text-xs text-cinnabar">
                    万象藏库自动收录失败：{w.materialArchiveError ?? "未知错误"}
                    <button type="button" onClick={() => void retryArchive(w.id)} className="ml-2 underline">重试收录</button>
                  </div>
                )}
                <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-sm">
                  <button
                    onClick={() => router.push(enterHref)}
                    className="text-gilt transition hover:underline"
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
    </CelestialPageShell>
  );
}
