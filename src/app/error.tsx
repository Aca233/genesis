"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PlayBackground } from "@/components/play/PlayBackground";

/** 路由级错误兜底：渲染崩溃时以星穹羊皮纸主题页替代 Next 默认白底页。 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // 技术信息仅记录于控制台，不向访客展示原文
    console.error(error);
  }, [error]);

  return (
    <main className="play-shell flex min-h-screen flex-1 items-center justify-center px-6">
      <PlayBackground variant="supporting" />
      <div className="genesis-status-panel flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
          星轨紊乱，此页崩解
        </h1>
        <p className="text-sm text-ink-soft">羊皮纸上的这一页暂时无法展开。</p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-md border border-gilt bg-gilt/10 px-6 py-2 text-gilt transition hover:bg-gilt/20"
        >
          重新展卷
        </button>
        <Link href="/" className="text-sm text-ink-faint transition hover:text-gilt">
          ← 回到原初
        </Link>
      </div>
    </main>
  );
}
