"use client";

import { useState } from "react";

export type IconThemeSummary = {
  primaryFamily: "phosphor" | "tabler" | "iconPark";
  emblemFamily: "gameIcons" | "phosphor" | "iconPark";
  visualTone: string[];
  motifTags: string[];
};

const FAMILY_LABELS = {
  phosphor: "Phosphor",
  tabler: "Tabler",
  iconPark: "IconPark",
  gameIcons: "Game Icons",
} as const;

export function IconThemeControl({
  worldId,
  initialTheme,
  initialRevision,
  playing = false,
  compact = false,
  onChanged,
}: {
  worldId: string;
  initialTheme: IconThemeSummary;
  initialRevision: number;
  playing?: boolean;
  compact?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [prevInitial, setPrevInitial] = useState({ theme: initialTheme, revision: initialRevision });

  if (prevInitial.theme !== initialTheme || prevInitial.revision !== initialRevision) {
    setPrevInitial({ theme: initialTheme, revision: initialRevision });
    setTheme(initialTheme);
    setRevision(initialRevision);
  }

  async function recast() {
    if (playing && !window.confirm("重铸会改变此世界所有未锁定的叙事图标；玩家锁定项将保留。继续吗？")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/worlds/${worldId}/icons/recast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "图标主题重铸失败");
      setTheme(body.theme);
      setRevision(body.revision);
      setMessage("图标主题已重铸");
      await onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  // 幕后小注:工具性控件不与「创世」抢戏——单行淡墨,图标库名收进悬停提示
  return (
    <section
      className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-faint ${compact ? "" : "border-b border-line/60 pb-2"}`}
      aria-label="世界图标主题"
    >
      <span className="select-none text-[10px] tracking-[0.25em]">图标印记</span>
      <span className="text-ink-soft">{theme.motifTags.join(" · ") || "未命名"}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void recast()}
        title={`重铸此世界的图标印记（主库 ${FAMILY_LABELS[theme.primaryFamily]}，纹章 ${FAMILY_LABELS[theme.emblemFamily]}）；玩家锁定项保留`}
        className="ml-auto text-[11px] text-ink-faint underline-offset-2 transition hover:text-gilt hover:underline disabled:opacity-45"
      >
        {busy ? "重铸中…" : "重铸"}
      </button>
      {message && <p role="status" className="w-full text-[11px] text-ink-faint">{message}</p>}
    </section>
  );
}
