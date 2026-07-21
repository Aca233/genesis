"use client";

import { useEffect, useMemo, useState } from "react";
import type { MaterialSelectionItem } from "@/lib/materials/types";
import { validateAbilityOwner, type SelectedMaterial } from "@/lib/materials/selection";
import { ConflictPanel } from "./ConflictPanel";
import { DependencyDialog } from "./DependencyDialog";
import { inspectPickerSelection, removeSelection, upsertSelection } from "./material-picker-state";

type Version = { id: string; version: number; name: string; content?: unknown; dependencies?: Array<{ key: string; label: string; targetRef: string; required?: boolean }> };
type Card = { id: string; kind: string; name: string; summary: string; favorite: boolean; defaultVersionId: string | null; versions: Version[] };
type VersionDetail = { content: unknown; dependencies: NonNullable<Version["dependencies"]> };

export function MaterialPicker({ value, onChange, onClose }: { value: MaterialSelectionItem[]; onChange: (items: MaterialSelectionItem[]) => void; onClose: () => void }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [details, setDetails] = useState<Record<string, VersionDetail>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/materials").then((response) => response.json()).then((json) => setCards(json.materials ?? [])).catch(() => setError("素材列表读取失败")); }, []);
  const selected = useMemo(() => new Map(value.map((item) => [item.materialCardId, item])), [value]);
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  async function loadVersion(cardId: string, versionId: string): Promise<VersionDetail> {
    const cached = details[versionId];
    if (cached) return cached;
    const response = await fetch(`/api/materials/${cardId}`);
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "素材版本读取失败");
    const version = (json.material.versions as Version[]).find((candidate) => candidate.id === versionId);
    if (!version) throw new Error("素材版本已失效，请重新选择");
    const detail = { content: version.content, dependencies: version.dependencies ?? [] };
    setDetails((current) => ({ ...current, [versionId]: detail }));
    return detail;
  }

  async function toggle(card: Card) {
    const old = selected.get(card.id);
    if (old) { onChange(removeSelection(value, card.id)); return; }
    const versionId = card.defaultVersionId ?? card.versions[0]?.id;
    if (!versionId) return;
    try {
      const detail = await loadVersion(card.id, versionId);
      onChange(upsertSelection(value, {
        materialCardId: card.id, materialVersionId: versionId, mode: "remix", fullLock: false,
        dependencyDecisions: Object.fromEntries(detail.dependencies.map((dependency) => [dependency.key, dependency.required === false ? "omit" : "rebuild"])),
        abilityOwner: card.kind === "ability" ? { mode: "model", allowCreateOwner: true } : null,
        priority: value.length, compressed: false,
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function changeVersion(card: Card, versionId: string) {
    const current = selected.get(card.id); if (!current) return;
    try {
      const detail = await loadVersion(card.id, versionId);
      onChange(upsertSelection(value, {
        ...current, materialVersionId: versionId,
        dependencyDecisions: Object.fromEntries(detail.dependencies.map((dependency) => [dependency.key, dependency.required === false ? "omit" : "rebuild"])),
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function update(id: string, patch: Partial<MaterialSelectionItem>) {
    const current = selected.get(id); if (current) onChange(upsertSelection(value, { ...current, ...patch }));
  }
  function shiftPriority(id: string, delta: number) {
    const ordered = [...value].sort((a, b) => a.priority - b.priority);
    const index = ordered.findIndex((item) => item.materialCardId === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    onChange(ordered.map((item, priority) => ({ ...item, priority })));
  }

  const inspected = useMemo(() => {
    const items = value.flatMap<SelectedMaterial>((selection) => {
      const card = cardById.get(selection.materialCardId);
      const content = details[selection.materialVersionId]?.content;
      return card && content ? [{ id: selection.materialVersionId, kind: card.kind as SelectedMaterial["kind"], mode: selection.mode, priority: selection.priority, content: content as SelectedMaterial["content"] }] : [];
    });
    return inspectPickerSelection(items);
  }, [value, cardById, details]);

  function legalOwners(choice: MaterialSelectionItem) {
    const content = details[choice.materialVersionId]?.content as { card?: { kind?: string } } | undefined;
    const abilityKind = content?.card?.kind ?? "";
    return value.flatMap((candidate) => {
      if (candidate.materialCardId === choice.materialCardId) return [];
      const card = cardById.get(candidate.materialCardId);
      return card && validateAbilityOwner(abilityKind, card.kind as never) ? [{ card, candidate }] : [];
    });
  }

  return <div className="fixed inset-0 z-50 overflow-auto bg-black/30 p-4">
    <section className="mx-auto max-w-5xl rounded-xl border border-line bg-paper p-6">
      <header className="flex justify-between gap-4"><div><h2 className="text-2xl text-ink">引用创世素材</h2><p className="text-sm text-ink-faint">手动逐张选择；所有素材仍合并为一次创世请求。</p></div><button onClick={onClose} disabled={inspected.blockingMessages.length > 0} className="text-gilt disabled:opacity-40">完成（{value.length}）</button></header>
      {error && <p className="mt-3 text-sm text-cinnabar">{error}</p>}
      <div className="mt-4 grid gap-2"><p className="text-xs text-ink-faint">当前已估算 {inspected.budget.estimatedChars.toLocaleString()} / 120,000 字符{inspected.budget.largest[0] ? `；最大项 ${cardById.get(value.find((item) => item.materialVersionId === inspected.budget.largest[0]!.id)?.materialCardId ?? "")?.name ?? "未知"}` : ""}</p><ConflictPanel issues={inspected.blockingMessages} /></div>
      <ul className="mt-5 grid gap-3 md:grid-cols-2">{cards.map((card) => {
        const choice = selected.get(card.id);
        const deps = choice ? details[choice.materialVersionId]?.dependencies ?? [] : [];
        const owners = choice && card.kind === "ability" ? legalOwners(choice) : [];
        return <li key={card.id} className={`rounded border p-4 ${choice ? "border-gilt" : "border-line"}`}>
          <button onClick={() => void toggle(card)} className="w-full text-left"><h3>{card.favorite ? "★ " : ""}{card.name}</h3><p className="line-clamp-2 text-xs text-ink-faint">{card.summary}</p></button>
          {choice && <div className="mt-3 grid gap-2">
            <select value={choice.materialVersionId} onChange={(event) => void changeVersion(card, event.target.value)} className="bg-paper-sunken text-xs">{card.versions.map((version) => <option value={version.id} key={version.id}>v{version.version} · {version.name}</option>)}</select>
            <select value={choice.mode} onChange={(event) => update(card.id, { mode: event.target.value as MaterialSelectionItem["mode"], fullLock: event.target.value === "locked" })} className="bg-paper-sunken text-xs"><option value="remix">融合改写</option><option value="inherit">原样继承（核心锁定）</option><option value="locked">完全锁定</option></select>
            {choice.mode === "inherit" && <label className="text-xs text-ink-soft"><input type="checkbox" checked={choice.fullLock} onChange={(event) => update(card.id, { fullLock: event.target.checked })} /> 将整张卡完全锁定</label>}
            <label className="text-xs text-ink-soft"><input type="checkbox" checked={choice.compressed} onChange={(event) => update(card.id, { compressed: event.target.checked })} /> 使用本地核心摘要减少输入</label>
            {card.kind === "ability" && <label className="grid gap-1 text-xs text-ink-faint">能力拥有者<select value={choice.abilityOwner?.mode === "selected" ? choice.abilityOwner.materialVersionId : "model"} onChange={(event) => update(card.id, { abilityOwner: event.target.value === "model" ? { mode: "model", allowCreateOwner: true } : { mode: "selected", materialVersionId: event.target.value } })} className="bg-paper-sunken text-xs"><option value="model">由模型分配或创建合法拥有者</option>{owners.map(({ card: ownerCard, candidate }) => <option key={candidate.materialVersionId} value={candidate.materialVersionId}>指定：{ownerCard.name}</option>)}</select></label>}
            <DependencyDialog dependencies={deps} decisions={choice.dependencyDecisions} onChange={(dependencyDecisions) => update(card.id, { dependencyDecisions })} />
            <div className="flex gap-2 text-[11px] text-ink-faint"><span>优先级 {choice.priority + 1}</span><button onClick={() => shiftPriority(card.id, -1)}>↑ 提高</button><button onClick={() => shiftPriority(card.id, 1)}>↓ 降低</button></div>
          </div>}
        </li>;
      })}</ul>
    </section>
  </div>;
}
