"use client";

import { useEffect, useState } from "react";
import {
  KIND_LABELS,
  KindSigil,
  MaterialContentView,
  humanizeMachineText,
  kindGiltColor,
  kindInkColor,
} from "./MaterialContentView";

type MaterialVersionData = {
  id: string;
  version: number;
  name: string;
  note: string | null;
  content: unknown;
  dependencies: unknown[];
  createdAt: string;
};

type MaterialDetailData = {
  id: string;
  kind?: string;
  name: string;
  summary: string;
  sourceWorldId: string | null;
  sourceWorldName: string;
  defaultVersionId: string | null;
  versions: MaterialVersionData[];
};

export function MaterialDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [material, setMaterial] = useState<MaterialDetailData | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/materials/${id}`)
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error);
        return json.material as MaterialDetailData;
      })
      .then((nextMaterial) => {
        if (!active) return;
        setMaterial(nextMaterial);
        setExpandedVersionId(null);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => { active = false; };
  }, [id]);

  async function copy(version: MaterialVersionData) {
    const name = window.prompt("新版本名称", `${version.name} · 副本`);
    if (!name) return;

    const response = await fetch(`/api/materials/${id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        content: version.content,
        dependencies: version.dependencies,
        parentVersionId: version.id,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json.error);
      return;
    }

    onChanged();
    const fresh = await fetch(`/api/materials/${id}`).then((result) => result.json());
    setMaterial(fresh.material);
  }

  if (error) {
    return (
      <div className="rounded-lg border border-cinnabar/40 bg-cinnabar/5 p-5 text-cinnabar shadow-tome">
        {error}
        <button type="button" onClick={onClose} className="ml-4 underline">关闭</button>
      </div>
    );
  }
  if (!material) return <p className="letterpress py-16 text-center">展卷中…</p>;

  const displayName = humanizeMachineText(material.name) || "佚名之藏";
  const displaySource = humanizeMachineText(material.sourceWorldName) || "无名之界";

  return (
    <section className="tome-plate tome-plate--corners p-5 sm:p-6">
      <header className="flex justify-between gap-4">
        <div className="min-w-0">
          {material.kind && (
            <p className="mb-1.5 flex items-center gap-2 text-xs tracking-[0.18em]" style={{ color: kindInkColor(material.kind) }}>
              <KindSigil kind={material.kind} className="h-4 w-4 shrink-0" style={{ color: kindGiltColor(material.kind) }} />
              {KIND_LABELS[material.kind] ?? material.kind}
            </p>
          )}
          <h2
            title={displayName === material.name ? undefined : material.name}
            className="display-lg break-words text-ink [overflow-wrap:anywhere]"
          >
            {displayName}
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-ink-soft">{material.summary}</p>
          <p title={`来源：${material.sourceWorldName}`} className="mt-1.5 truncate text-xs text-ink-faint">
            来源：{displaySource}{!material.sourceWorldId && "（来源世界已删除）"}
          </p>
        </div>
        <button type="button" onClick={onClose} className="self-start text-ink-faint transition hover:text-gilt">关闭</button>
      </header>

      <div className="mt-5 grid gap-3">
        {material.versions.map((version) => {
          const expanded = expandedVersionId === version.id;
          const panelId = `material-version-${version.id}`;
          return (
            <article
              key={version.id}
              className={`overflow-hidden rounded-lg border bg-paper-raised/70 transition ${expanded ? "border-gilt/50 shadow-[0_0_0.8rem_var(--gilt-glow)]" : "border-line"}`}
            >
              <div className="flex items-center gap-3 p-4">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setExpandedVersionId(expanded ? null : version.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span aria-hidden className={`text-gilt transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
                  <span className="min-w-0">
                    <span className="block truncate font-display font-bold tracking-[0.06em] text-gilt-strong">
                      v{version.version} · {humanizeMachineText(version.name) || version.name}
                      {material.defaultVersionId === version.id && (
                        <span className="ml-2 rounded-full border border-gilt/40 bg-gilt/10 px-2 py-0.5 text-xs font-normal tracking-normal text-gilt-strong">默认版本</span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-ink-faint">
                      {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(version.createdAt))}
                      {expanded ? " · 点击收起" : " · 点击展开正文"}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => void copy(version)} className="shrink-0 text-xs text-gilt hover:underline">
                  复制为新版本
                </button>
              </div>

              {expanded && (
                <div id={panelId} className="border-t border-line bg-paper-sunken/30 p-3 sm:p-4">
                  {version.note && <p className="mb-4 rounded-md border border-line bg-paper-sunken px-3 py-2 text-sm text-ink-soft">版本注记：{version.note}</p>}
                  <MaterialContentView content={version.content} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
