import { PlayBackground } from "@/components/play/PlayBackground";

/** 路由级加载兜底：路由切换间隙的极简主题化占位（根级出现频繁，克制为上）。 */
export default function Loading() {
  return (
    <main className="play-shell flex min-h-screen flex-1 items-center justify-center px-6">
      <PlayBackground variant="supporting" />
      <p className="text-ink-faint">展卷中…</p>
    </main>
  );
}
