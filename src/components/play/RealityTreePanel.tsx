"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  buildRealityTreeRows,
  getRealityTreeKeyboardTarget,
  getUndoTarget,
  isRealityNavigationDisabled,
  type RealityTreeNavigationKey,
  type BusyKinds,
  type RealityNodeView,
  type RealityTreeView,
} from "./reality-tree-state";

export function RealityTreePanel({
  worldId,
  activeTimelineId,
  busy,
  onTimelineChanged,
  initialTree = null,
}: {
  worldId: string;
  activeTimelineId: string;
  busy: BusyKinds;
  initialTree?: RealityTreeView | null;
  onTimelineChanged: (timelineId: string) => Promise<void>;
}) {
  const [tree, setTree] = useState<RealityTreeView | null>(initialTree);
  const [focusedId, setFocusedId] = useState(activeTimelineId);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<RealityNodeView | null>(null);
  const navigationDisabled = isRealityNavigationDisabled(busy) || loading;

  const reload = useCallback(async () => {
    const response = await fetch(`/api/worlds/${worldId}/realities`);
    const json = (await response.json().catch(() => null)) as (RealityTreeView & { error?: string }) | null;
    if (!response.ok || json === null) throw new Error(json?.error ?? "现实树无从展开");
    setTree(json);
  }, [worldId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/worlds/${worldId}/realities`, { signal: controller.signal });
        const json = (await response.json().catch(() => null)) as (RealityTreeView & { error?: string }) | null;
        if (!response.ok || json === null) throw new Error(json?.error ?? "现实树无从展开");
        if (!controller.signal.aborted) setTree(json);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => controller.abort();
  }, [worldId]);

  async function request(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, timelineChanged?: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/worlds/${worldId}/realities`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as { error?: string; activeId?: string } | null;
      if (!response.ok) throw new Error(json?.error ?? "现实树操作失败");
      await reload();
      if (timelineChanged !== undefined) await onTimelineChanged(json?.activeId ?? timelineChanged);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  const rows = buildRealityTreeRows(tree?.nodes ?? []);
  const currentId = tree?.activeId ?? activeTimelineId;
  const undoTarget = getUndoTarget(tree?.nodes ?? [], currentId);
  const rovingId = rows.some(({ node }) => node.id === focusedId) ? focusedId : currentId;

  function navigateTree(event: KeyboardEvent<HTMLElement>, nodeId: string) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const targetId = getRealityTreeKeyboardTarget(rows, nodeId, event.key as RealityTreeNavigationKey);
    setFocusedId(targetId);
    itemRefs.current.get(targetId)?.focus();
  }

  return (
    <section className="space-y-4" aria-label="现实树">
      <div>
        <p className="text-xs tracking-[0.25em] text-gilt">现实树</p>
        <h3 className="mt-1 text-xl text-ink" style={{ fontFamily: "var(--font-display)" }}>诸界分枝</h3>
        <p className="mt-2 text-sm text-ink-soft">每一道敕令都生成独立子现实；原现实冻结保留，可随时返回。</p>
      </div>

      {isRealityNavigationDisabled(busy) && (
        <p className="rounded border border-gilt/30 bg-gilt/5 px-3 py-2 text-xs text-gilt">
          叙事、结算或改写进行中时不可切换现实
        </p>
      )}

      <button
        type="button"
        disabled={navigationDisabled || undoTarget === null}
        onClick={() => void request("POST", { action: "undo", expectedActiveId: currentId }, undoTarget ?? undefined)}
        className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:border-gilt hover:text-gilt disabled:opacity-40"
      >
        ↶ 撤回父现实
      </button>

      <div role="tree" aria-label="现实分支" className="space-y-2">
        {tree === null && !error ? <p className="text-sm text-ink-faint">展开现实树中…</p> : rows.map(({ node, depth }) => {
            const current = node.id === currentId;
            return (
              <article
                key={node.id}
                role="treeitem"
                ref={(element) => {
                  if (element) itemRefs.current.set(node.id, element);
                  else itemRefs.current.delete(node.id);
                }}
                tabIndex={node.id === rovingId ? 0 : -1}
                onFocus={() => setFocusedId(node.id)}
                onKeyDown={(event) => navigateTree(event, node.id)}
                aria-level={depth + 1}
                aria-expanded={node.childCount > 0 ? true : undefined}
                aria-current={current ? "true" : undefined}
                aria-selected={current}
                className={`rounded border p-3 ${current ? "border-gilt bg-gilt/5" : "border-line"}`}
                style={{ marginLeft: `${depth * 1.1}rem` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{node.branchName} {current && <span className="text-xs text-gilt">· 当前</span>}</p>
                    {node.branchSummary && <p className="mt-1 text-xs leading-relaxed text-ink-soft">{node.branchSummary}</p>}
                    <p className="mt-1 text-[11px] text-ink-faint">{node.parentId === null ? "根现实" : `分叉于第 ${node.forkChapter ?? "?"} 章`} · {node.childCount} 个子现实</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-x-2 gap-y-1 text-xs">
                    {!current && <button disabled={navigationDisabled} onClick={() => void request("POST", { action: "switch", targetTimelineId: node.id, expectedActiveId: currentId }, node.id)} className="text-gilt disabled:opacity-40">进入</button>}
                    <button onClick={() => {
                      const name = window.prompt("重命名现实", node.branchName);
                      if (name !== null) void request("PATCH", { timelineId: node.id, branchName: name });
                    }} disabled={loading} className="text-ink-soft hover:text-gilt disabled:opacity-40">重命名</button>
                    {node.rewriteDecree && <button onClick={() => setInspected(node)} className="text-ink-soft hover:text-gilt">敕令</button>}
                    {node.parentId !== null && !current && <button disabled={navigationDisabled} onClick={() => {
                      if (window.confirm(`删除「${node.branchName}」及其全部子现实？`)) {
                        void request("DELETE", { timelineId: node.id, expectedActiveId: currentId });
                      }
                    }} className="text-cinnabar disabled:opacity-40">删枝</button>}
                  </div>
                </div>
              </article>
            );
          })}
      </div>

      {inspected && (
        <div className="rounded border border-gilt/30 bg-paper-sunken p-4" role="note">
          <div className="flex items-center justify-between"><p className="text-xs text-gilt">分叉敕令 · {inspected.branchName}</p><button onClick={() => setInspected(null)} aria-label="关闭敕令">✕</button></div>
          <blockquote className="mt-2 whitespace-pre-wrap leading-relaxed text-ink">{inspected.rewriteDecree}</blockquote>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-cinnabar">{error}</p>}
    </section>
  );
}
