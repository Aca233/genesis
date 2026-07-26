"use client";

import { useCallback, useEffect, useState } from "react";
import { WorldIcon, type SvgIconData } from "./WorldIcon";

type PickerItem = {
  token: string;
  label: string;
  role: "interface" | "narrative" | "emblem";
  family: string;
  concepts: string[];
  icon: SvgIconData | null;
};

export type IconAssignmentView = {
  token: string;
  source: "generated" | "derived" | "player";
  playerLocked: boolean;
  icon: SvgIconData | null;
};

export function IconPicker({
  worldId,
  timelineId,
  subjectType,
  subjectId,
  value,
  onChange,
}: {
  worldId: string;
  timelineId: string;
  subjectType: "entity" | "god" | "ability" | "event";
  subjectId: string;
  value: IconAssignmentView;
  onChange: (value: IconAssignmentView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<"primary" | "emblem">("emblem");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [items, setItems] = useState<PickerItem[]>([]);
  const [preview, setPreview] = useState<PickerItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ library, q: query, page: String(page), pageSize: "24" });
      void fetch(`/api/worlds/${worldId}/icons/catalog?${params}`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? "图标目录读取失败");
          setItems(body.items);
          setPages(body.pages);
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [library, open, page, query, worldId]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const save = useCallback(async (item: PickerItem) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/worlds/${worldId}/icons/assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timelineId, subjectType, subjectId, token: item.token }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "图标保存失败");
      onChange({ ...body.assignment, icon: item.icon });
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }, [onChange, subjectId, subjectType, timelineId, worldId]);

  const restore = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/worlds/${worldId}/icons/assignments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timelineId, subjectType, subjectId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "图标恢复失败");
      onChange(body.assignment);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }, [onChange, subjectId, subjectType, timelineId, worldId]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:border-gilt/50 hover:text-gilt"
        aria-expanded={open}
      >
        <WorldIcon icon={value.icon} size={18} />
        {value.playerLocked ? "已锁定图标" : "更换图标"}
      </button>
      {open && (
        <section className="mt-2 grid gap-3 rounded-lg border border-line bg-paper-raised p-3 shadow-lg" aria-label="选择世界图标">
          <div className="flex gap-2">
            {(["primary", "emblem"] as const).map((kind) => (
              <button key={kind} type="button" onClick={() => { setLibrary(kind); setPage(1); }} className={`rounded px-2 py-1 text-xs ${library === kind ? "bg-gilt/15 text-gilt" : "text-ink-faint"}`}>
                {kind === "primary" ? "主图标库" : "纹章库"}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            placeholder="搜索中文概念或语义令牌"
            className="rounded border border-line bg-paper-sunken px-2 py-1.5 text-sm text-ink outline-none focus:border-gilt/60"
          />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {items.map((item) => (
              <button
                key={item.token}
                type="button"
                onClick={() => setPreview(item)}
                onDoubleClick={() => void save(item)}
                onKeyDown={(event) => { if (event.key === "Enter") void save(item); }}
                className={`grid min-h-16 place-items-center gap-1 rounded border p-1 text-[10px] ${preview?.token === item.token ? "border-gilt bg-gilt/10 text-gilt" : "border-line text-ink-soft"}`}
                aria-label={item.label}
                aria-pressed={preview?.token === item.token}
              >
                <WorldIcon icon={item.icon} size={22} />
                <span className="line-clamp-1">{item.label}</span>
                {preview?.token === item.token && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
            <span>{page} / {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>下一页</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!preview || saving} onClick={() => preview && void save(preview)} className="rounded border border-gilt/50 px-3 py-1 text-xs text-gilt disabled:opacity-40">确认应用</button>
            <button type="button" disabled={saving} onClick={() => void restore()} className="rounded border border-line px-3 py-1 text-xs text-ink-soft">恢复随世界主题</button>
          </div>
          {error && <p className="text-xs text-cinnabar">{error}</p>}
        </section>
      )}
    </div>
  );
}
