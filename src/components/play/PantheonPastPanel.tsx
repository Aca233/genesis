"use client";

import { useEffect, useState } from "react";
import { RealityTreePanel } from "./RealityTreePanel";
import { isRealityNavigationDisabled, type BusyKinds } from "./reality-tree-state";

/**
 * 万神殿"往昔"页签：检查点列表（回到此刻 → 冻结分叉）+ 内嵌现实树，
 * 供玩家在自己的诸多分叉之间穿行。
 * 回溯确认为卡内墨批对话行（原位替代 window.confirm）。
 */

type CheckpointView = {
  chapterId: string;
  index: number;
  timeLabel: string;
  excerpt: string | null;
  eligible: boolean;
  settledAt: string;
};

export function PantheonPastPanel({
  worldId,
  activeTimelineId,
  busy,
  onTimelineChanged,
}: {
  worldId: string;
  activeTimelineId: string;
  busy: BusyKinds;
  onTimelineChanged: (timelineId: string) => Promise<void>;
}) {
  const [checkpoints, setCheckpoints] = useState<CheckpointView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  /** 回溯二次确认：待确认的检查点 chapterId（卡内墨批行） */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/worlds/${worldId}/checkpoints`, { signal: controller.signal });
        const json = (await response.json().catch(() => null)) as
          | { checkpoints?: CheckpointView[]; error?: string }
          | null;
        if (!response.ok || !json?.checkpoints) throw new Error(json?.error ?? "往昔无从展开");
        if (!controller.signal.aborted) setCheckpoints(json.checkpoints);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => controller.abort();
  }, [worldId, activeTimelineId]);

  async function fork(checkpoint: CheckpointView) {
    setConfirmingId(null);
    setForking(true);
    setError(null);
    try {
      const response = await fetch(`/api/worlds/${worldId}/realities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fork",
          sourceChapterId: checkpoint.chapterId,
          expectedActiveId: activeTimelineId,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const json = (await response.json().catch(() => null)) as { activeId?: string; error?: string } | null;
      if (!response.ok || !json?.activeId) throw new Error(json?.error ?? "回溯失败");
      await onTimelineChanged(json.activeId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setForking(false);
    }
  }

  const forkDisabled = isRealityNavigationDisabled(busy) || forking;

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label="检查点">
        <div>
          <p className="letterpress text-xs text-gilt!">检查点</p>
          <p className="mt-2 text-sm text-ink-soft">已定格的时刻皆可回到；历史将自那一刻另起一枝。</p>
        </div>

        {checkpoints === null && !error && <p className="fog-text text-sm">追索往昔中…</p>}
        {checkpoints !== null && checkpoints.length === 0 && (
          <p className="fog-text text-sm">尚无已定格的时刻。</p>
        )}
        {checkpoints?.map((checkpoint) => (
          <article
            key={checkpoint.chapterId}
            className="rounded-lg border border-line bg-paper-raised/55 p-3 shadow-[0_2px_10px_var(--shadow-warm),inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_85%,transparent)] transition [background-image:var(--fiber-noise)] hover:border-gilt/45"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="font-medium text-ink"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  「{checkpoint.timeLabel} · 第{checkpoint.index}卷」
                </p>
                {checkpoint.excerpt && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">{checkpoint.excerpt}</p>
                )}
              </div>
              {checkpoint.eligible ? (
                <button
                  type="button"
                  disabled={forkDisabled}
                  onClick={() => setConfirmingId(checkpoint.chapterId)}
                  className="seal-button min-h-7! shrink-0 px-3! py-1! text-xs"
                >
                  回到此刻
                </button>
              ) : (
                <span className="shrink-0 text-xs text-ink-faint">旧存档快照，不支持回溯</span>
              )}
            </div>
            {confirmingId === checkpoint.chapterId && (
              <div
                role="note"
                className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-md border border-cinnabar/40 bg-paper-sunken/70 px-3 py-2 text-xs shadow-[inset_0_1px_3px_color-mix(in_srgb,var(--ink)_12%,transparent)]"
              >
                <span className="text-cinnabar">
                  回到「{checkpoint.timeLabel}」？将从那一刻分出新的现实，当前历史冻结保留。
                </span>
                <button
                  type="button"
                  disabled={forkDisabled}
                  onClick={() => void fork(checkpoint)}
                  className="font-bold text-cinnabar underline underline-offset-2 disabled:opacity-40"
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="text-ink-faint transition hover:text-ink"
                >
                  且慢
                </button>
              </div>
            )}
          </article>
        ))}
        {error && <p role="alert" className="text-sm text-cinnabar">{error}</p>}
      </section>

      <div className="space-y-5">
        <span
          aria-hidden
          className="block h-px w-full bg-gradient-to-r from-transparent via-gilt/40 to-transparent"
        />
        <RealityTreePanel
          worldId={worldId}
          activeTimelineId={activeTimelineId}
          busy={busy}
          mode="pantheon"
          onTimelineChanged={onTimelineChanged}
        />
      </div>
    </div>
  );
}
