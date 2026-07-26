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
        <div className="rounded-lg border border-line bg-paper-raised p-3 text-center text-sm text-ink-soft shadow-lg">
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
    <div className="mb-3 rounded-lg border border-cinnabar/40 bg-paper-raised p-4">
      <p className="text-lg text-ink" style={{ fontFamily: "var(--font-display)" }}>
        神焰已熄
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        汝已跌落至「{fallenLabel}」之阶。是就此成史，还是于余烬中续燃？
      </p>
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-cinnabar">终章一经写下，此界永为史册，不可复返。</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void conclude()}
            className="rounded-md border border-cinnabar/50 bg-cinnabar/5 px-4 py-1 text-cinnabar transition hover:bg-cinnabar/15 disabled:opacity-40"
          >
            落笔
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirming(false)}
            className="text-ink-faint transition hover:text-ink disabled:opacity-40"
          >
            且慢
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            disabled={disabled}
            onClick={dismiss}
            className="rounded-md border border-line px-4 py-1 text-ink-soft transition hover:border-gilt/50 hover:text-gilt disabled:opacity-40"
          >
            于余烬中挣扎
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirming(true)}
            className="rounded-md border border-cinnabar/50 bg-cinnabar/5 px-4 py-1 text-cinnabar transition hover:bg-cinnabar/15 disabled:opacity-40"
          >
            书写陨灭终章
          </button>
        </div>
      )}
      {writing && <p className="mt-2 text-sm text-gilt">史官执笔终章…</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-cinnabar">
          {error}
        </p>
      )}
    </div>
  );
}
