"use client";

import { useEffect, useRef, useState } from "react";
import type { Scale } from "@/lib/cards/schemas";
import { ScaleDial, SCALE_STOPS } from "./ScaleDial";
import {
  createCreatorInputState,
  followRealityRewriteEvents,
  submitCreatorInput,
  type CreatorInputState,
  type RealityRewriteView,
  type RewriteScope,
} from "./creator-input-state";
import { useTheme } from "@/components/theme/useTheme";

const SCOPE_LABELS: Record<RewriteScope, string> = {
  prospective: "自此而后",
  memory_only: "唯改记忆",
  retroactive: "溯改既往",
};
const STAGE_LABELS: Record<string, string> = {
  planning: "解析敕令",
  branching: "分叉现实",
  applying: "重铸因果",
  narrating: "书写新史",
  completed: "现实已定",
  failed: "改写中断",
};

export function CreatorInputDeck({
  worldId,
  scale,
  onScaleChange,
  suggestions,
  chapterBreakHint,
  chatBusy,
  canContinue,
  onObserve,
  onContinue,
  onStop,
  onSettle,
  refreshState,
  refreshEntityIndex,
  onRewriteBusyChange,
  onRewriteCompleted,
}: {
  worldId: string;
  scale: Scale;
  onScaleChange: (scale: Scale) => void;
  suggestions: string[];
  chapterBreakHint: boolean;
  chatBusy: boolean;
  canContinue: boolean;
  onObserve: (content: string) => Promise<void>;
  onContinue: () => void;
  onStop: () => void;
  onSettle: () => void;
  refreshState: (completed?: RealityRewriteView) => Promise<void>;
  refreshEntityIndex: () => Promise<void>;
  onRewriteBusyChange: (busy: boolean) => void;
  onRewriteCompleted?: (rewrite: RealityRewriteView) => void;
}) {
  const [input, setInput] = useState<CreatorInputState>(() => createCreatorInputState());
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { candle, setMode } = useTheme();
  const busy = chatBusy || input.busy;
  const rewrite = input.channel === "rewrite";
  const currentScale = SCALE_STOPS.find((stop) => stop.key === scale) ?? SCALE_STOPS[1];

  useEffect(() => {
    const textarea = taRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input.text]);

  useEffect(() => {
    onRewriteBusyChange(rewrite && input.busy);
  }, [input.busy, onRewriteBusyChange, rewrite]);

  async function createRewrite(request: {
    decree: string;
    scope: RewriteScope;
    idempotencyKey: string;
  }) {
    const response = await fetch(`/api/worlds/${worldId}/rewrites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const json = (await response.json().catch(() => null)) as {
      taskId?: string;
      error?: string;
    } | null;
    if (!response.ok || !json?.taskId) {
      throw new Error(json?.error ?? "现实改写未被受理");
    }
    return { taskId: json.taskId };
  }

  async function submit() {
    if (!input.text.trim() || busy) return;
    const result = await submitCreatorInput(input, {
      createIdempotencyKey: () => crypto.randomUUID(),
      observe: onObserve,
      createRewrite,
      followRewrite: (taskId, progress) => followRealityRewriteEvents(taskId, progress),
      refreshState,
      refreshEntityIndex,
    }, setInput);
    setInput(result);
    if (result.completedRewrite) onRewriteCompleted?.(result.completedRewrite);
  }

  return (
    <div className="sticky bottom-0 z-30 mx-auto w-full max-w-3xl px-4 pb-3 xl:max-w-4xl">
      {!rewrite && chapterBreakHint && !busy && (
        <div className="mb-1 border-t border-gilt/40 pt-1 text-center text-xs text-gilt/70">
          本章似已抵达段落——可令岁月流转。
        </div>
      )}
      {!rewrite && suggestions.length > 0 && !busy && (
        <div className="mb-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 text-sm">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setInput((value) => ({ ...value, text: suggestion }))} className="text-gilt/60 transition hover:text-gilt">
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <div className={`rounded-lg border p-3 shadow-lg transition-colors ${rewrite ? "border-cinnabar/60 bg-cinnabar/5" : "border-line bg-paper-raised"}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex rounded-md border border-line bg-paper-sunken p-0.5 text-xs" role="tablist" aria-label="创世主输入通道">
            <button type="button" role="tab" aria-selected={!rewrite} disabled={busy} onClick={() => setInput((value) => ({ ...value, channel: "observe", error: null }))} className={`rounded px-3 py-1 ${!rewrite ? "bg-gilt/15 text-gilt" : "text-ink-faint"}`}>观测世界</button>
            <button type="button" role="tab" aria-selected={rewrite} disabled={busy} onClick={() => setInput((value) => ({ ...value, channel: "rewrite", error: null }))} className={`rounded px-3 py-1 ${rewrite ? "bg-cinnabar/15 text-cinnabar" : "text-ink-faint"}`}>改写现实</button>
          </div>
          {rewrite && (
            <select aria-label="改写范围" value={input.scope} disabled={busy} onChange={(event) => setInput((value) => ({ ...value, scope: event.target.value as RewriteScope }))} className="rounded border border-cinnabar/30 bg-paper px-2 py-1 text-xs text-cinnabar outline-none">
              {(Object.keys(SCOPE_LABELS) as RewriteScope[]).map((scope) => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}
            </select>
          )}
        </div>

        <div className="flex items-start gap-3">
          {!rewrite && (
            <div className="flex shrink-0 flex-col items-center pt-1">
              <ScaleDial scale={scale} disabled={busy} onChange={onScaleChange} />
              <span className="mt-0.5 text-[10px] text-ink-faint">观测尺度</span>
            </div>
          )}
          <textarea
            ref={taRef}
            value={input.text}
            onChange={(event) => setInput((value) => ({ ...value, text: event.target.value, error: null }))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            disabled={busy}
            placeholder={busy
              ? rewrite ? "现实正在重铸…" : "史官正在展卷…"
              : rewrite ? "降下不可违逆的现实敕令……" : currentScale.placeholder}
            rows={2}
            className="w-full resize-none bg-transparent leading-relaxed text-ink outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
          />
        </div>

        {input.stage && rewrite && <p aria-live="polite" className="mt-2 text-xs text-cinnabar/80">⌘ {STAGE_LABELS[input.stage] ?? input.stage}</p>}
        {input.error && <p role="alert" className="mt-2 text-xs text-cinnabar">{input.error}</p>}

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
            {!rewrite && <>
              <button type="button" disabled={busy || !canContinue} onClick={onContinue} className="text-ink-soft hover:text-gilt disabled:opacity-40">续观</button>
              <button type="button" disabled={busy || !canContinue} onClick={onSettle} className="text-ink-soft hover:text-gilt disabled:opacity-40">⌘ 结束本章</button>
            </>}
            <button type="button" onClick={() => setMode(candle ? "day" : "candle")} className="text-xs text-ink-faint hover:text-gilt">{candle ? "☀ 日卷" : "🕯 烛光"}</button>
          </div>
          {chatBusy && !rewrite ? (
            <button type="button" onClick={onStop} className="rounded-md border border-cinnabar/50 px-6 py-1.5 text-sm text-cinnabar">■ 搁笔</button>
          ) : (
            <button type="button" onClick={() => void submit()} disabled={busy || !input.text.trim()} className={`rounded-md border px-6 py-1.5 text-sm transition disabled:opacity-40 ${rewrite ? "border-cinnabar/50 text-cinnabar hover:bg-cinnabar/10" : "border-gilt/50 text-gilt hover:bg-gilt/10"}`}>
              {rewrite ? "敕定现实" : "观测"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
