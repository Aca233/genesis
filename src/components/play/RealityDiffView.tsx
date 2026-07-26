"use client";

import { useEffect, useState } from "react";
import { ENTITY_TYPE_LABELS } from "./lexicon";
import type { RealityNodeView } from "./reality-tree-state";

type ChronicleDiffRowView = {
  id: string;
  chapterIndex: number;
  yearLabel: string;
  text: string;
  source: string;
  revealed: boolean;
};

type EntityDiffCardView = {
  name: string;
  type: string;
  presence: "both" | "left-only" | "right-only";
  summaryDiff: { left: string; right: string } | null;
  sectionDiffs: { key: string; left: string | null; right: string | null }[];
};

type ComparisonView = {
  divergenceLabel: string;
  chronicle: {
    commonCount: number;
    leftOnly: ChronicleDiffRowView[];
    rightOnly: ChronicleDiffRowView[];
  };
  entities: EntityDiffCardView[];
};

function ChronicleDiffEntryCard({ row }: { row: ChronicleDiffRowView }) {
  return (
    <article className="rounded border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gilt">{row.yearLabel.trim() || "时间未载"}</span>
        {row.source === "rewrite" && (
          <span className="rounded-full border border-gilt/40 px-1.5 text-[10px] text-gilt">敕令</span>
        )}
        {!row.revealed && (
          <span className="rounded-full border border-line px-1.5 text-[10px] text-ink-faint">暗记</span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{row.text}</p>
    </article>
  );
}

function DiffText({ value }: { value: string | null }) {
  if (value === null) return <p className="text-sm text-ink-faint">—（无此栏目）</p>;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{value}</p>;
}

/** 只读分歧对照：两界编年史与众生的双栏对比，数据来自 /realities/compare。 */
export function RealityDiffView({
  worldId,
  leftId,
  rightId,
  nodes,
  onBack,
}: {
  worldId: string;
  leftId: string;
  rightId: string;
  nodes: readonly RealityNodeView[];
  onBack: () => void;
}) {
  const [data, setData] = useState<ComparisonView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/worlds/${worldId}/realities/compare?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`,
          { signal: controller.signal },
        );
        const json = (await response.json().catch(() => null)) as (ComparisonView & { error?: string }) | null;
        if (!response.ok || json === null) throw new Error(json?.error ?? "分歧对照无从展开");
        if (!controller.signal.aborted) setData(json);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    })();
    return () => controller.abort();
  }, [worldId, leftId, rightId]);

  const leftNode = nodes.find((node) => node.id === leftId) ?? null;
  const rightNode = nodes.find((node) => node.id === rightId) ?? null;
  const leftName = leftNode?.branchName ?? "此界";
  const rightName = rightNode?.branchName ?? "彼界";
  const emptyDiff = data !== null
    && data.chronicle.leftOnly.length === 0
    && data.chronicle.rightOnly.length === 0
    && data.entities.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:border-gilt hover:text-gilt"
        >
          ← 返回现实树
        </button>
        <p className="text-sm text-ink">
          分歧对照{data !== null && ` · 分歧于 ${data.divergenceLabel}`}
        </p>
      </div>

      {error !== null && <p role="alert" className="text-sm text-cinnabar">{error}</p>}
      {data === null && error === null && <p className="text-sm text-ink-faint">比对诸界中…</p>}

      {emptyDiff && (
        <p className="fog-text py-6 text-center text-sm">两界尚未分道扬镳——所有卷宗一致。</p>
      )}

      {data !== null && !emptyDiff && (
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="font-medium text-ink">
            {leftName} {leftNode?.isActive && <span className="text-xs text-gilt">· 当前</span>}
          </p>
          <p className="font-medium text-ink">
            {rightName} {rightNode?.isActive && <span className="text-xs text-gilt">· 当前</span>}
          </p>

          <p className="col-span-full text-xs tracking-[0.25em] text-gilt">编年史分歧</p>
          <p className="col-span-full text-center text-xs text-ink-faint">
            共同历史 · {data.chronicle.commonCount} 条已折叠
          </p>
          <div className="space-y-2">
            {data.chronicle.leftOnly.map((row) => <ChronicleDiffEntryCard key={row.id} row={row} />)}
          </div>
          <div className="space-y-2">
            {data.chronicle.rightOnly.map((row) => <ChronicleDiffEntryCard key={row.id} row={row} />)}
          </div>

          {data.entities.length > 0 && (
            <p className="col-span-full text-xs tracking-[0.25em] text-gilt">众生分歧</p>
          )}
          {data.entities.map((entity) => (
            <article key={`${entity.type}:${entity.name}`} className="col-span-full rounded border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-ink">{entity.name}</p>
                <span className="rounded-full border border-line px-1.5 text-[10px] text-ink-faint">
                  {ENTITY_TYPE_LABELS[entity.type] ?? entity.type}
                </span>
                {entity.presence !== "both" && (
                  <span className="text-xs text-cinnabar">
                    仅存于「{entity.presence === "left-only" ? leftName : rightName}」
                  </span>
                )}
              </div>
              {entity.summaryDiff !== null && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] text-ink-faint">{leftName}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{entity.summaryDiff.left}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-ink-faint">{rightName}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{entity.summaryDiff.right}</p>
                  </div>
                </div>
              )}
              {entity.sectionDiffs.map((section) => (
                <div key={section.key} className="mt-2">
                  <p className="text-xs tracking-wide text-gilt">{section.key}</p>
                  <div className="mt-0.5 grid gap-2 sm:grid-cols-2">
                    <DiffText value={section.left} />
                    <DiffText value={section.right} />
                  </div>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
