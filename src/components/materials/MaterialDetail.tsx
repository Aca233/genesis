"use client";

import { useEffect, useState } from "react";
import { MaterialContentView } from "./MaterialContentView";

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
      <div className="rounded-lg border border-cinnabar/40 p-5 text-cinnabar">
        {error}
        <button type="button" onClick={onClose} className="ml-4 underline">关闭</button>
      </div>
    );
  }
  if (!material) return <p className="fog-text">展卷中…</p>;

  return (
    <section className="rounded-xl border border-line bg-paper-raised p-5">
      <header className="flex justify-between gap-4">
        <div>
          <h2 className="text-2xl text-ink">{material.name}</h2>
          <p className="mt-1 text-sm text-ink-soft">{material.summary}</p>
          <p className="mt-1 text-xs text-ink-faint">
            来源：{material.sourceWorldName}{!material.sourceWorldId && "（来源世界已删除）"}
          </p>
        </div>
        <button type="button" onClick={onClose} className="self-start text-ink-faint hover:text-gilt">关闭</button>
      </header>

      <div className="mt-5 grid gap-3">
        {material.versions.map((version) => {
          const expanded = expandedVersionId === version.id;
          const panelId = `material-version-${version.id}`;
          return (
            <article key={version.id} className={`rounded-lg border transition ${expanded ? "border-gilt/50" : "border-line"}`}>
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
                    <span className="block truncate text-gilt">
                      v{version.version} · {version.name}
                      {material.defaultVersionId === version.id && <span className="ml-2 text-xs">默认版本</span>}
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
                <div id={panelId} className="border-t border-line p-4">
                  {version.note && <p className="mb-4 rounded bg-paper-sunken px-3 py-2 text-sm text-ink-soft">版本注记：{version.note}</p>}
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
