"use client";

import { useEffect, useRef, useState } from "react";
import {
  canSubmitMaterialVersion, closeSaveMaterialDialog, initialSaveMaterialVersionState,
  openSaveMaterialDialog, settleSaveMaterialVersion,
} from "./save-material-version-state";

export type SaveMaterialVersionButtonProps = {
  sourceType: "god" | "entity" | "ability";
  sourceId: string;
  compact?: boolean;
};

export function SaveMaterialVersionButton({ sourceType, sourceId, compact = false }: SaveMaterialVersionButtonProps) {
  const [state, setState] = useState(initialSaveMaterialVersionState);
  const [savedTick, setSavedTick] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  async function submit() {
    if (!canSubmitMaterialVersion(state)) return;
    setState((current) => ({ ...current, pending: true, error: null }));
    try {
      const response = await fetch("/api/materials/snapshot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, sourceId, versionName: state.versionName.trim(), note: state.note || undefined, setDefault: state.setDefault }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setState((current) => settleSaveMaterialVersion(current, null));
      setSavedTick(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedTick(false), 2000);
    } catch (error) {
      setState((current) => settleSaveMaterialVersion(current, error instanceof Error ? error.message : String(error)));
    }
  }
  return (
    <>
      <button type="button" onClick={() => setState((current) => openSaveMaterialDialog(current))}
        className={compact ? "text-[11px] text-gilt/75 transition hover:text-gilt" : "rounded border border-gilt/35 px-2 py-1 text-xs text-gilt/80 transition hover:border-gilt hover:text-gilt"}>
        {compact ? "✦ 收藏版本" : "✦ 保存至万象藏库"}
      </button>
      {savedTick && <span className="text-xs text-gilt">✓ 已入藏库</span>}
      {state.open && (
        /* 高于抽屉体系（z-50/60）的最顶层对话框；遮罩暂用 bg-ink/35，待 WP4 的 --scrim 令牌落地后换 bg-scrim */
        <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !state.pending) setState(closeSaveMaterialDialog); }}>
          <section className="w-full max-w-md rounded-lg border border-gilt/40 bg-paper p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="保存素材版本">
            <h3 className="text-lg text-ink" style={{ fontFamily: "var(--font-display)" }}>留存剧情版本</h3>
            <label className="mt-4 grid gap-1 text-xs text-ink-faint">版本名称
              <input autoFocus maxLength={80} value={state.versionName} onChange={(event) => setState((current) => ({ ...current, versionName: event.target.value, error: null }))} className="rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink outline-none focus:border-gilt/60" placeholder="例如：星历七年 · 神战余烬" />
            </label>
            <label className="mt-3 grid gap-1 text-xs text-ink-faint">备注（可选）
              <textarea maxLength={500} value={state.note} onChange={(event) => setState((current) => ({ ...current, note: event.target.value }))} className="min-h-20 rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink outline-none focus:border-gilt/60" />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" checked={state.setDefault} onChange={(event) => setState((current) => ({ ...current, setDefault: event.target.checked }))} />设为以后创世时的默认版本</label>
            {state.error && <p className="mt-3 text-sm text-cinnabar">{state.error}</p>}
            <footer className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={state.pending} onClick={() => setState(closeSaveMaterialDialog)} className="rounded border border-line px-3 py-1.5 text-sm text-ink-faint disabled:opacity-50">取消</button>
              <button type="button" disabled={!canSubmitMaterialVersion(state)} onClick={() => void submit()} className="rounded border border-gilt/50 bg-gilt/10 px-3 py-1.5 text-sm text-gilt disabled:opacity-40">{state.pending ? "封存中…" : "保存版本"}</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
