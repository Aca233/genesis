"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { resolveCompareRelationship } from "@/lib/reality/compare";
import { RealityDiffView } from "./RealityDiffView";
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
  mode = "creator",
}: {
  worldId: string;
  activeTimelineId: string;
  busy: BusyKinds;
  initialTree?: RealityTreeView | null;
  /** 仅影响文案：万神殿以"往昔诸相/回溯"措辞呈现同一棵现实树 */
  mode?: "creator" | "pantheon";
  onTimelineChanged: (timelineId: string) => Promise<void>;
}) {
  const [tree, setTree] = useState<RealityTreeView | null>(initialTree);
  const [focusedId, setFocusedId] = useState(activeTimelineId);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspected, setInspected] = useState<RealityNodeView | null>(null);
  // 分歧对照：先「对照」选定一界，再于另一界「与之对照」；只读，不受 busy 限制
  const [comparePick, setComparePick] = useState<string | null>(null);
  const [compareView, setCompareView] = useState<{ leftId: string; rightId: string } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const navigationDisabled = isRealityNavigationDisabled(busy) || loading;

  function handleCompareClick(nodeId: string) {
    setCompareError(null);
    if (comparePick === nodeId) {
      setComparePick(null);
      return;
    }
    if (comparePick === null) {
      setComparePick(nodeId);
      return;
    }
    try {
      resolveCompareRelationship(tree?.nodes ?? [], comparePick, nodeId);
      setCompareView({ leftId: comparePick, rightId: nodeId });
      setComparePick(null);
    } catch (reason) {
      setCompareError(reason instanceof Error ? reason.message : String(reason));
    }
  }

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
        <p className="letterpress text-xs text-gilt!">现实树</p>
        <h3 className="display-md mt-1 text-ink">
          {mode === "pantheon" ? "往昔诸相" : "诸界分枝"}
        </h3>
        <p className="mt-2 text-sm text-ink-soft">
          {mode === "pantheon"
            ? "每次回溯都会从那一刻分出新的现实；原现实冻结保留，可随时回望。"
            : "每一道敕令都生成独立子现实；原现实冻结保留，可随时返回。"}
        </p>
      </div>

      {compareView !== null && tree !== null ? (
        <RealityDiffView
          worldId={worldId}
          leftId={compareView.leftId}
          rightId={compareView.rightId}
          nodes={tree.nodes}
          onBack={() => setCompareView(null)}
        />
      ) : (<>

      {isRealityNavigationDisabled(busy) && (
        <p className="rounded border border-gilt/30 bg-gilt/5 px-3 py-2 text-xs text-gilt">
          叙事、结算或改写进行中时不可切换现实
        </p>
      )}

      <button
        type="button"
        disabled={navigationDisabled || undoTarget === null}
        onClick={() => void request("POST", { action: "undo", expectedActiveId: currentId }, undoTarget ?? undefined)}
        className="rounded-md border border-line bg-paper-raised/55 px-3 py-1.5 text-sm text-ink-soft shadow-[inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_75%,transparent)] transition hover:border-gilt hover:text-gilt disabled:opacity-40"
      >
        ↶ 撤回父现实
      </button>

      {compareError && <p role="alert" className="text-sm text-cinnabar">{compareError}</p>}

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
                className={`rounded-lg border p-3 transition [background-image:var(--fiber-noise)] ${
                  current
                    ? "border-gilt/70 bg-gilt/10 shadow-[0_0_0.7rem_var(--gilt-glow),0_2px_10px_var(--shadow-warm),inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_80%,transparent)]"
                    : "border-line bg-paper-raised/45 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_75%,transparent)] hover:border-gilt/40"
                }`}
                style={{ marginLeft: `${depth * 1.1}rem` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{node.branchName} {current && <span className="text-xs text-gilt">· 当前</span>}</p>
                    {node.branchSummary && <p className="mt-1 text-xs leading-relaxed text-ink-soft">{node.branchSummary}</p>}
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {node.parentId === null
                        ? "根现实"
                        : node.forkTimeLabel
                          ? `分叉于 ${node.forkTimeLabel}`
                          : "由旧现实分叉"}
                      {" · "}
                      {node.childCount} 个子现实
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-x-2 gap-y-1 text-xs">
                    {!current && <button disabled={navigationDisabled} onClick={() => void request("POST", { action: "switch", targetTimelineId: node.id, expectedActiveId: currentId }, node.id)} className="text-gilt disabled:opacity-40">进入</button>}
                    <button onClick={() => {
                      const name = window.prompt("重命名现实", node.branchName);
                      if (name !== null) void request("PATCH", { timelineId: node.id, branchName: name });
                    }} disabled={loading} className="text-ink-soft hover:text-gilt disabled:opacity-40">重命名</button>
                    <button
                      type="button"
                      onClick={() => handleCompareClick(node.id)}
                      className={comparePick === node.id ? "text-gilt" : "text-ink-soft hover:text-gilt"}
                    >
                      {comparePick === node.id ? "取消对照" : comparePick === null ? "对照" : "与之对照"}
                    </button>
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
        <div
          className="rounded-lg border border-gilt/30 bg-paper-sunken p-4 shadow-[inset_0_1px_3px_color-mix(in_srgb,var(--ink)_10%,transparent)] [background-image:var(--fiber-noise)]"
          role="note"
        >
          <div className="flex items-center justify-between">
            <p className="letterpress text-xs text-gilt!">分叉敕令 · {inspected.branchName}</p>
            <button
              onClick={() => setInspected(null)}
              aria-label="关闭敕令"
              className="text-ink-faint transition hover:text-gilt"
            >
              ✕
            </button>
          </div>
          <blockquote className="decree mt-2 whitespace-pre-wrap text-sm leading-relaxed">{inspected.rewriteDecree}</blockquote>
        </div>
      )}
      </>)}
      {error && <p role="alert" className="text-sm text-cinnabar">{error}</p>}
    </section>
  );
}
