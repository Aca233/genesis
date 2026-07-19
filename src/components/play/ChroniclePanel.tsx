"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * 编年史：按章分组的年表 + 诸神/实体过滤（docs/01 §9.3）。
 * 补录条目（revealedAtChapter 晚于 chapterIndex）以朱批小注标识——
 * 「后世方知」的迷雾揭示感。
 */

type EntryRow = {
  id: string;
  chapterIndex: number;
  yearLabel: string;
  text: string;
  entityIds: string[];
  godIds: string[];
  revealedAtChapter: number | null;
  source: string;
};

type NameRow = { id: string; name: string };

export function ChroniclePanel({ timelineId }: { timelineId: string }) {
  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [gods, setGods] = useState<NameRow[]>([]);
  const [entities, setEntities] = useState<NameRow[]>([]);
  const [godId, setGodId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ timelineId });
        if (godId) qs.set("godId", godId);
        if (entityId) qs.set("entityId", entityId);
        const res = await fetch(`/api/chronicle?${qs}`);
        const json = (await res.json()) as {
          entries?: EntryRow[];
          gods?: NameRow[];
          entities?: NameRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "年表无从展开");
          return;
        }
        setEntries(json.entries ?? []);
        setGods(json.gods ?? []);
        setEntities(json.entities ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timelineId, godId, entityId]);

  // 按章分组（保持后端章序）
  const groups = useMemo(() => {
    if (!entries) return [];
    const map = new Map<number, EntryRow[]>();
    for (const e of entries) {
      const g = map.get(e.chapterIndex);
      if (g) g.push(e);
      else map.set(e.chapterIndex, [e]);
    }
    return [...map.entries()];
  }, [entries]);

  if (error) return <p className="text-sm text-cinnabar">{error}</p>;
  if (!entries) return <p className="fog-text text-sm">展卷中…</p>;

  return (
    <div className="grid gap-4">
      {/* 过滤器 */}
      {(gods.length > 0 || entities.length > 0) && (
        <div className="flex flex-wrap gap-2 text-sm">
          <select
            value={godId}
            onChange={(e) => setGodId(e.target.value)}
            className="rounded-md border border-line bg-paper-sunken px-2 py-1 text-ink outline-none focus:border-gilt/50"
          >
            <option value="">诸神——不限</option>
            {gods.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className="max-w-56 rounded-md border border-line bg-paper-sunken px-2 py-1 text-ink outline-none focus:border-gilt/50"
          >
            <option value="">众生——不限</option>
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
          {(godId || entityId) && (
            <button
              onClick={() => {
                setGodId("");
                setEntityId("");
              }}
              className="text-xs text-ink-faint transition hover:text-gilt"
            >
              清除
            </button>
          )}
        </div>
      )}

      {groups.length === 0 && (
        <p className="fog-text text-sm">
          {godId || entityId
            ? "此间无史可稽。"
            : "史册尚白——首章结算后，岁月方留痕。"}
        </p>
      )}

      {/* 竖向年表 */}
      <ol className="relative grid gap-6 border-l border-gilt/30 pl-5">
        {groups.map(([chapterIndex, list]) => (
          <li key={chapterIndex} className="relative">
            {/* 章节节点 */}
            <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border border-gilt bg-paper" />
            <h3
              className="mb-2 text-sm text-gilt"
              style={{ fontFamily: "var(--font-display)" }}
            >
              第{chapterIndex}章
            </h3>
            <ul className="grid gap-2.5">
              {list.map((e) => {
                const backfilled =
                  e.revealedAtChapter != null &&
                  e.revealedAtChapter > e.chapterIndex;
                return (
                  <li key={e.id} className="text-sm leading-relaxed">
                    <span className="mr-2 text-xs text-ink-faint">
                      {e.yearLabel}
                    </span>
                    <span className={backfilled ? "text-ink-soft" : "text-ink"}>
                      {e.text}
                    </span>
                    {backfilled && (
                      <span
                        className="ml-1.5 text-xs text-cinnabar/80"
                        title="此事当时隐于帷幕，后世方为人知"
                      >
                        〔第{e.revealedAtChapter}章方揭〕
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
