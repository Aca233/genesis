import Link from "next/link";
import { PlayBackground } from "@/components/play/PlayBackground";

/** 路由级 404 兜底：未知 URL 以星穹羊皮纸主题页替代 Next 默认白底页。 */
export default function NotFound() {
  return (
    <main className="play-shell flex min-h-screen flex-1 items-center justify-center px-6">
      <PlayBackground variant="supporting" />
      <div className="genesis-status-panel flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
          此径不通
        </h1>
        <p className="text-sm text-ink-soft">星图之外，无有此页。</p>
        <Link href="/" className="text-sm text-ink-faint transition hover:text-gilt">
          ← 回到原初
        </Link>
      </div>
    </main>
  );
}
