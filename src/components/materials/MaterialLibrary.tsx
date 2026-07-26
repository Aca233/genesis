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
import {
  KIND_LABELS,
  KindSigil,
  humanizeMachineText,
  kindBandStyle,
  kindGiltColor,
  kindInkColor,
} from "./MaterialContentView";
import { MaterialDetail } from "./MaterialDetail";

/* 羊皮凹井输入框：与 .scroll-select 同一材质语言（纸井、墨线、鎏金聚焦） */
const fieldClassName = "min-h-10 min-w-0 w-full rounded-lg border border-ink-soft/30 bg-paper-sunken px-3 py-2 font-prose text-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-ink-faint/70 focus:border-gilt focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.08),0_0_0.6rem_var(--gilt-glow)]";

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
    return <p className="letterpress py-16 text-center">展卷中…</p>;
  }

  return (
    <div className="grid min-w-0 gap-5">
      {error && <p className="rounded-lg border border-cinnabar/40 bg-cinnabar/5 px-4 py-3 text-cinnabar shadow-tome">{error}</p>}

      {/* 拣选案：书卷面板上的卷轴拣选器与星标开关（小屏两列并置以让藏品早现） */}
      <section className="tome-plate grid min-w-0 gap-4 p-4 sm:p-5" aria-label="素材筛选">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-[minmax(18rem,1fr)_repeat(3,minmax(9rem,auto))]">
          <label className="col-span-2 grid gap-1.5 xl:col-span-1">
            <span className="letterpress text-sm">关键词</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名讳 / 摘要 / 来源"
              className={fieldClassName}
            />
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="letterpress text-sm">素材类型</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)} className="scroll-select min-h-10 w-full min-w-0">
              <option value="">全部类型</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5">
            <span className="letterpress text-sm">来源世界</span>
            <select value={source} onChange={(event) => setSource(event.target.value)} className="scroll-select min-h-10 w-full min-w-0 truncate xl:max-w-56">
              <option value="">全部来源</option>
              {options.sources.map((option) => (
                <option key={option.value} value={option.value}>
                  {humanizeMachineText(option.label) || option.label}{option.deleted ? "（已删除）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 grid min-w-0 gap-1.5 xl:col-span-1">
            <span className="letterpress text-sm">版本类别</span>
            <select value={version} onChange={(event) => setVersion(event.target.value as MaterialVersionFilter)} className="scroll-select min-h-10 w-full min-w-0">
              <option value="all">全部版本类别</option>
              <option value="initial-only">仅有初始版</option>
              <option value="has-edits">已有衍生版本</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-line pt-3">
          <span className="letterpress mr-1 text-sm">可见性</span>
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
              className={`rounded-full border px-3 py-1 text-sm transition ${visibility === value ? "border-gilt/70 bg-gilt/15 text-gilt-strong shadow-[0_0_0.55rem_var(--gilt-glow)]" : "border-line text-ink-soft hover:border-gilt/60 hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
          <label className="star-toggle ml-1 text-sm">
            <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
            只看收藏
          </label>
          <span className="ml-auto text-sm tabular-nums text-ink-faint">{shown.length} / {(items ?? []).length} 项</span>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="text-sm text-gilt hover:underline">
              清除筛选
            </button>
          )}
        </div>
      </section>

      {/* 藏品架：每卡一枚类型纹章与淡彩卡头；神格素材配星角纹饰 */}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((item) => {
          const godly = item.kind === "player_god" || item.kind === "major_god";
          const displayName = humanizeMachineText(item.name) || "佚名之藏";
          const displaySource = humanizeMachineText(item.sourceWorldName) || "无名之界";
          return (
            <li
              key={item.id}
              className={`tome-plate${godly ? " tome-plate--corners" : ""} min-w-0 overflow-hidden${item.hidden ? " opacity-60 saturate-50" : ""}`}
            >
              <button type="button" onClick={() => setOpen(item.id)} className="block min-w-0 w-full text-left">
                <div className="flex items-center gap-2 px-4 pb-2 pt-2.5" style={kindBandStyle(item.kind)}>
                  <KindSigil kind={item.kind} className="h-4 w-4 shrink-0" style={{ color: kindGiltColor(item.kind) }} />
                  <p className="text-xs font-medium tracking-[0.18em]" style={{ color: kindInkColor(item.kind) }}>
                    {KIND_LABELS[item.kind] ?? item.kind}
                  </p>
                  <p className="ml-auto shrink-0 text-xs text-ink-faint">{item.versions.length} 个版本</p>
                </div>
                <div className="px-4 pb-3 pt-1.5">
                  <h2
                    title={displayName === item.name ? undefined : item.name}
                    className="display-md break-words text-ink [overflow-wrap:anywhere]"
                  >
                    {displayName}
                  </h2>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-soft">{item.summary}</p>
                  <p title={`来源：${item.sourceWorldName}`} className="mt-2.5 truncate text-xs text-ink-faint">
                    {displaySource}{!item.sourceWorldId && " · 来源已删除"}
                  </p>
                </div>
              </button>
              <div className="mx-4 flex gap-4 border-t border-line pb-3 pt-2 text-sm">
                <button type="button" onClick={() => void patch(item.id, { favorite: !item.favorite })} className="text-gilt-strong transition hover:text-gilt">
                  {item.favorite ? "★ 已收藏" : "☆ 收藏"}
                </button>
                <button type="button" onClick={() => void patch(item.id, { hidden: !item.hidden })} className="text-ink-faint transition hover:text-ink-soft">
                  {item.hidden ? "取消隐藏" : "隐藏"}
                </button>
              </div>
            </li>
          );
        })}
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
