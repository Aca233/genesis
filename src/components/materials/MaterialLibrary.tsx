"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  filterMaterials,
  getMaterialFilterOptions,
  sortMaterials,
  type MaterialListItem,
  type MaterialVersionFilter,
  type MaterialVisibility,
} from "./material-library-state";
import { MaterialDetail } from "./MaterialDetail";

const LABELS: Record<string, string> = {
  player_god: "玩家神",
  major_god: "主神",
  character: "人物",
  race: "种族",
  faction: "势力",
  place: "地点",
  ability: "能力",
  cosmology: "宇宙论",
  fusion_axiom: "融合公理",
  epoch_conflict: "时代冲突",
  style: "文风",
  theme: "主题",
};

const fieldClassName = "min-h-10 min-w-0 w-full rounded border border-line bg-paper-sunken px-3 py-2 text-ink outline-none transition focus:border-gilt";

export function MaterialLibrary() {
  const [items, setItems] = useState<MaterialListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const [visibility, setVisibility] = useState<MaterialVisibility>("visible");
  const [version, setVersion] = useState<MaterialVersionFilter>("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/materials?showHidden=true", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setItems(json.materials);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const options = useMemo(() => getMaterialFilterOptions(items ?? []), [items]);
  const shown = useMemo(() => sortMaterials(filterMaterials(items ?? [], {
    visibility,
    favoriteOnly,
    kind: kind || null,
    source: source || null,
    version,
    query,
  })), [items, visibility, favoriteOnly, kind, source, version, query]);
  const hasActiveFilters = Boolean(query || kind || source || favoriteOnly || version !== "all" || visibility !== "visible");

  async function patch(id: string, payload: Partial<Pick<MaterialListItem, "favorite" | "hidden">>) {
    const before = items;
    setError(null);
    setItems((all) => (all ?? []).map((item) => item.id === id ? { ...item, ...payload } : item));

    try {
      const response = await fetch(`/api/materials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
    } catch (patchError) {
      setItems(before);
      setError(patchError instanceof Error ? patchError.message : String(patchError));
    }
  }

  function resetFilters() {
    setQuery("");
    setKind("");
    setSource("");
    setVisibility("visible");
    setVersion("all");
    setFavoriteOnly(false);
  }

  if (open) return <MaterialDetail id={open} onClose={() => setOpen(null)} onChanged={load} />;

  // 加载态：首次拉取未归来且无错误时，仅展示展卷提示
  if (items === null && !error) {
    return <p className="py-16 text-center text-ink-faint">展卷中…</p>;
  }

  return (
    <div className="grid min-w-0 gap-5">
      {error && <p className="rounded border border-cinnabar/30 bg-cinnabar/5 px-4 py-3 text-cinnabar">{error}</p>}

      <section className="grid min-w-0 gap-4 rounded-lg border border-line bg-paper-raised p-4" aria-label="素材筛选">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_repeat(3,minmax(9rem,auto))]">
          <label className="grid gap-1 text-xs text-ink-faint">
            关键词
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名讳 / 摘要 / 来源"
              className={fieldClassName}
            />
          </label>
          <label className="grid gap-1 text-xs text-ink-faint">
            素材类型
            <select value={kind} onChange={(event) => setKind(event.target.value)} className={fieldClassName}>
              <option value="">全部类型</option>
              {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-faint">
            来源世界
            <select value={source} onChange={(event) => setSource(event.target.value)} className={`${fieldClassName} max-w-56 truncate`}>
              <option value="">全部来源</option>
              {options.sources.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}{option.deleted ? "（已删除）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-faint">
            版本类别
            <select value={version} onChange={(event) => setVersion(event.target.value as MaterialVersionFilter)} className={fieldClassName}>
              <option value="all">全部版本类别</option>
              <option value="initial-only">仅有初始版</option>
              <option value="has-edits">已有衍生版本</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="mr-1 text-xs text-ink-faint">可见性</span>
          {([
            ["visible", "未隐藏"],
            ["hidden", "仅隐藏"],
            ["all", "全部"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={visibility === value}
              onClick={() => setVisibility(value)}
              className={`rounded-full border px-3 py-1 text-sm transition ${visibility === value ? "border-gilt bg-gilt/10 text-gilt" : "border-line text-ink-soft hover:border-gilt/60"}`}
            >
              {label}
            </button>
          ))}
          <label className="ml-1 flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1 text-sm text-ink-soft">
            <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
            只看收藏
          </label>
          <span className="ml-auto text-sm text-ink-faint">{shown.length} / {(items ?? []).length} 项</span>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="text-sm text-gilt hover:underline">
              清除筛选
            </button>
          )}
        </div>
      </section>

      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((item) => (
          <li key={item.id} className={`min-w-0 rounded-lg border bg-paper-raised p-4 ${item.hidden ? "border-line opacity-70" : "border-line"}`}>
            <button type="button" onClick={() => setOpen(item.id)} className="min-w-0 w-full text-left">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gilt">{LABELS[item.kind] ?? item.kind}</p>
                <p className="text-xs text-ink-faint">{item.versions.length} 个版本</p>
              </div>
              <h2 className="mt-1 break-words text-lg text-ink [overflow-wrap:anywhere]">{item.name}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-ink-soft">{item.summary}</p>
              <p className="mt-2 break-words text-xs text-ink-faint [overflow-wrap:anywhere]">
                {item.sourceWorldName}{!item.sourceWorldId && " · 来源已删除"}
              </p>
            </button>
            <div className="mt-3 flex gap-3 border-t border-line pt-2 text-sm">
              <button type="button" onClick={() => void patch(item.id, { favorite: !item.favorite })} className="text-gilt">
                {item.favorite ? "★ 已收藏" : "☆ 收藏"}
              </button>
              <button type="button" onClick={() => void patch(item.id, { hidden: !item.hidden })} className="text-ink-faint">
                {item.hidden ? "取消隐藏" : "隐藏"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {items !== null && shown.length === 0 && (
        <div className="py-16 text-center">
          <p className="fog-text">{hasActiveFilters ? "无素材应此筛选。" : "藏库中尚无素材——终局或导出的世界会自动入藏。"}</p>
          {hasActiveFilters && <button type="button" onClick={resetFilters} className="mt-3 text-sm text-gilt hover:underline">清除全部筛选</button>}
        </div>
      )}
    </div>
  );
}
