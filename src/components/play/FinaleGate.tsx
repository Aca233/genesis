"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * 陨灭终章确认流 + 已成史只读横条。
 * - status=concluded：替换输入区的只读横条（览史模式）
 * - status=playing 且玩家神已陨灭：终章二次确认面板；
 *   「于余烬中挣扎」写入 sessionStorage，本次会话不再打扰。
 */
export function FinaleGate({
  worldId,
  worldStatus,
  playerGodRank,
  fallenLabel,
  busy,
  onConcluded,
}: {
  worldId: string;
  worldStatus: string;
  playerGodRank: string | null;
  fallenLabel: string;
  busy: boolean;
  onConcluded: () => void;
}) {
  const dismissKey = `chuangshi:finale-dismissed:${worldId}`;
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  });
  const [confirming, setConfirming] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (worldStatus === "concluded") {
    return (
      <div className="sticky bottom-0 z-30 mx-auto w-full max-w-3xl px-4 pb-3 xl:max-w-4xl">
        <div className="tome-plate p-3 text-center text-sm text-ink-soft">
          <span>此界已成史。万象俱在，唯不可再书。</span>
          <Link
            href="/archives"
            className="ml-3 text-gilt transition hover:underline"
          >
            ← 回到往昔诸界
          </Link>
        </div>
      </div>
    );
  }

  if (worldStatus !== "playing" || playerGodRank !== "fallen" || dismissed) {
    return null;
  }

  const disabled = busy || writing;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(dismissKey, "1");
    } catch {
      // sessionStorage 不可用时仅本次渲染隐藏
    }
    setDismissed(true);
  };

  const conclude = async () => {
    setWriting(true);
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${worldId}/conclude`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(json?.error ?? "终章未能落笔，请稍后再试");
        return;
      }
      onConcluded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="relative mb-3 overflow-hidden rounded-xl border border-cinnabar/45 p-5 shadow-[0_1rem_2.5rem_var(--shadow-warm),inset_0_1px_0_rgba(255,233,178,0.08)] [background-image:var(--fiber-noise),linear-gradient(176deg,var(--seal-ground-hi),var(--seal-ground-lo))]">
      {/* 内衬发丝线 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-1 rounded-[0.65rem] border border-gilt-bright/20"
      />
      {/* 朱砂封印钮 */}
      <span
        aria-hidden
        className="absolute right-4 top-4 flex h-12 w-12 rotate-6 items-center justify-center rounded-full border-2 border-cinnabar/70 text-xl text-[color-mix(in_srgb,var(--cinnabar)_72%,var(--gilt-bright))] shadow-[inset_0_0_0.5rem_rgba(0,0,0,0.35)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        陨
      </span>
      <p className="display-md text-gilt-bright [text-shadow:0_0_10px_var(--seal-glow)]">
        神焰已熄
      </p>
      <p className="mt-1.5 pr-14 text-sm text-seal-ink/85">
        汝已跌落至「{fallenLabel}」之阶。是就此成史，还是于余烬中续燃？
      </p>
      {confirming ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[color-mix(in_srgb,var(--cinnabar)_50%,var(--seal-ink))]">
            终章一经写下，此界永为史册，不可复返。
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void conclude()}
            className="rounded-md border border-cinnabar/60 bg-cinnabar/90 px-5 py-1.5 font-bold tracking-[0.18em] text-seal-ink shadow-[0_0_0.8rem_color-mix(in_srgb,var(--cinnabar)_40%,transparent),inset_0_1px_0_rgba(255,255,255,0.16)] transition hover:brightness-110 disabled:opacity-40"
            style={{ fontFamily: "var(--font-display)" }}
          >
            落笔
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirming(false)}
            className="text-seal-ink/60 transition hover:text-seal-ink disabled:opacity-40"
          >
            且慢
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            disabled={disabled}
            onClick={dismiss}
            className="rounded-md border border-gilt-bright/35 px-4 py-1 text-gilt-bright/90 transition hover:border-gilt-bright/60 hover:bg-gilt-bright/10 disabled:opacity-40"
          >
            于余烬中挣扎
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirming(true)}
            className="rounded-md border border-cinnabar/60 bg-cinnabar/15 px-4 py-1 text-[color-mix(in_srgb,var(--cinnabar)_55%,var(--seal-ink))] transition hover:bg-cinnabar/25 disabled:opacity-40"
          >
            书写陨灭终章
          </button>
        </div>
      )}
      {writing && <p className="mt-2 text-sm text-gilt-bright">史官执笔终章…</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[color-mix(in_srgb,var(--cinnabar)_50%,var(--seal-ink))]">
          {error}
        </p>
      )}
    </div>
  );
}
