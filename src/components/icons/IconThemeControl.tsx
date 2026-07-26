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

  return (
    <section className={`rounded-lg border border-line bg-paper-raised/80 ${compact ? "px-3 py-2" : "p-4"}`} aria-label="世界图标主题">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <strong className="text-ink">图标主题</strong>
        <span>主库：{FAMILY_LABELS[theme.primaryFamily]}</span>
        <span>纹章：{FAMILY_LABELS[theme.emblemFamily]}</span>
        {!compact && <span>母题：{theme.motifTags.join(" · ") || "未命名"}</span>}
        <button type="button" disabled={busy} onClick={() => void recast()} className="ml-auto rounded border border-gilt/45 px-2 py-1 text-gilt transition hover:bg-gilt/10 disabled:opacity-45">
          {busy ? "重铸中…" : "重铸图标主题"}
        </button>
      </div>
      {!compact && theme.visualTone.length > 0 && <p className="mt-2 text-xs text-ink-faint">视觉关键词：{theme.visualTone.join("、")}</p>}
      {message && <p role="status" className="mt-1 text-xs text-ink-faint">{message}</p>}
    </section>
  );
}
