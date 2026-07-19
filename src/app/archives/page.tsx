"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** 存档列表项（GET /api/worlds 返回 shape） */
type WorldItem = {
  id: string;
  name: string;
  genesisInput: string;
  status: string; // draft | playing | concluded
  createdAt: string;
  updatedAt: string;
};

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
      setWorlds([]);
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
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1
            className="text-3xl text-ink"
            style={{ fontFamily: "var(--font-display)" }}
          >
            📜 往昔诸界
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

      {error && <p className="mb-4 text-sm text-cinnabar">{error}</p>}

      {worlds === null ? (
        <p className="py-16 text-center text-ink-faint">展卷中…</p>
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
        <ul className="grid gap-4">
          {worlds.map((w) => {
            const badge = STATUS_BADGE[w.status] ?? {
              label: w.status,
              cls: "text-ink-faint border-line",
            };
            const enterHref =
              w.status === "draft" ? `/genesis/${w.id}` : `/play/${w.id}`;
            return (
              <li
                key={w.id}
                className="rounded-lg border border-line bg-paper-raised p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2
                      className="flex items-center gap-2 text-xl text-ink"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      <span className="truncate">{w.name}</span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </h2>
                    <p className="decree mt-2 text-sm">
                      {excerpt(w.genesisInput)}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-ink-faint">
                    {fmtTime(w.updatedAt)}
                  </time>
                </div>

                <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-sm">
                  <button
                    onClick={() => router.push(enterHref)}
                    className="text-gilt transition hover:underline"
                  >
                    {w.status === "draft" ? "续掷卡组" : "入界"}
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
    </main>
  );
}
