"use client";

import type { AbilityKind } from "@/lib/abilities/types";
import type { PantheonWorldDeck } from "@/lib/cards/schemas";
import {
  canAddAbility,
  canEditAbilityVisibility,
  canRemoveAbility,
  nextAvailableAbilityRef,
  visibleAbilityIndexes,
} from "./deck-utils";
import { TextAreaField, TextField, SelectField, Sect } from "./fields";

type DeckAbility = PantheonWorldDeck["playerGod"]["abilities"][number];

export type AbilityEditorProps = {
  abilities: readonly DeckAbility[];
  basePath: string;
  lockedPaths: string[];
  onEdit: (path: string, value: unknown) => void;
  /** 控制本编辑器显示与可选的能力种类。 */
  allowedKinds: readonly AbilityKind[];
  /** 隐藏能力的敏感字段只能随当前卡的天机一同破封。 */
  sensitiveFieldsRevealed?: boolean;
  /** 派生能力可借此补齐来源等额外字段。 */
  createAbility?: (ref: string, kind: AbilityKind) => DeckAbility;
  /** 严格卡组下限；达到下限时禁用删除。 */
  minItems?: number;
  /** 严格卡组上限；达到上限时禁用新增。 */
  maxItems?: number;
  /** 派生能力可额外声明是否存在可用来源。 */
  canAdd?: boolean;
  addDisabledMessage?: string;
  /** 全卡组已用能力和覆写 ref；新增项必须避开它们。 */
  usedRefs: readonly string[];
  /** 主神天机未破封时，隐藏能力不进入任何可交互渲染分支。 */
  hideSealedHidden?: boolean;
};

const KIND_LABELS: Record<AbilityKind, string> = {
  racial_innate: "先天能力",
  racial_tradition: "族群技艺",
  personal: "个人技能",
  divine: "神权",
};

const MASTERY_OPTIONS = [
  ["unawakened", "未觉醒"],
  ["novice", "初学"],
  ["adept", "熟练"],
  ["expert", "精通"],
  ["master", "宗师"],
].map(([value, label]) => ({ value, label }));

const STATE_OPTIONS = [
  ["normal", "正常"],
  ["enhanced", "强化"],
  ["impaired", "受损"],
  ["sealed", "封印"],
  ["lost", "失落"],
  ["deprecated", "废弃"],
].map(([value, label]) => ({ value, label }));

const VISIBILITY_OPTIONS = [
  ["known", "已知"],
  ["rumored", "传闻"],
  ["hidden", "隐藏（天机）"],
].map(([value, label]) => ({ value, label }));

function blankAbility(ref: string, kind: AbilityKind): DeckAbility {
  return {
    ref,
    name: "新能力",
    kind,
    effect: "",
    trigger: "",
    cost: "无",
    limitations: "",
    mastery: "novice",
    state: "normal",
    visibility: "known",
    rumorText: null,
    lockedFields: [],
  };
}

/** 可复用的卡组能力编辑器；数组增删统一回写到 basePath。 */
export function AbilityEditor({
  abilities,
  basePath,
  lockedPaths,
  onEdit,
  allowedKinds,
  sensitiveFieldsRevealed = true,
  createAbility,
  minItems = 0,
  maxItems = Number.POSITIVE_INFINITY,
  canAdd = true,
  addDisabledMessage,
  usedRefs,
  hideSealedHidden = false,
}: AbilityEditorProps) {
  const common = { lockedPaths, onEdit };
  const kindOptions = allowedKinds.map((kind) => ({
    value: kind,
    label: KIND_LABELS[kind],
  }));
  const visibleAbilities = visibleAbilityIndexes(
    abilities,
    allowedKinds,
    hideSealedHidden,
    sensitiveFieldsRevealed,
  ).map((index) => ({ ability: abilities[index]!, index }));
  const addAllowed = canAddAbility(abilities.length, maxItems, canAdd);
  const sealedHidden = hideSealedHidden && !sensitiveFieldsRevealed;

  return (
    <div className="grid gap-4">
      {visibleAbilities.map(({ ability, index }, visibleIndex) => {
        const path = `${basePath}.${index}`;
        const sensitiveHidden = ability.visibility === "hidden" && !sensitiveFieldsRevealed;
        const visibilityEditable = canEditAbilityVisibility(ability.visibility, sensitiveFieldsRevealed);
        const removeAllowed = canRemoveAbility(abilities.length, minItems);
        return (
          <div key={ability.ref} className="grid gap-3 rounded-md border border-line bg-paper p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-faint">能力 {visibleIndex + 1}</span>
              <button
                type="button"
                disabled={!removeAllowed}
                onClick={() => {
                  if (!removeAllowed) return;
                  onEdit(basePath, abilities.filter((_, abilityIndex) => abilityIndex !== index));
                }}
                className="rounded-md border border-line px-2.5 py-0.5 text-xs text-ink-faint transition hover:border-cinnabar/50 hover:text-cinnabar disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除
              </button>
            </div>
            <TextField label="名称" path={`${path}.name`} value={ability.name} {...common} />
            <SelectField label="种类" path={`${path}.kind`} value={ability.kind} options={kindOptions} {...common} />
            {visibilityEditable && (
              <SelectField label="可见性" path={`${path}.visibility`} value={ability.visibility} options={VISIBILITY_OPTIONS} {...common} />
            )}

            {sensitiveHidden ? (
              <div className="rounded-md border border-[#4a3b28] bg-[#2a2118] px-4 py-3 text-sm text-[#e8dfc8]/65">
                此隐藏能力的效果、触发、代价、限制与状态将在本卡天机破封后显现。
              </div>
            ) : (
              <>
                <TextAreaField label="实际效果" path={`${path}.effect`} value={ability.effect} rows={3} {...common} />
                <TextAreaField label="触发条件" path={`${path}.trigger`} value={ability.trigger} rows={2} {...common} />
                <TextAreaField label="代价" path={`${path}.cost`} value={ability.cost} rows={2} {...common} />
                <TextAreaField label="限制与克制" path={`${path}.limitations`} value={ability.limitations} rows={2} {...common} />
                <SelectField label="掌握程度" path={`${path}.mastery`} value={ability.mastery} options={MASTERY_OPTIONS} {...common} />
                <SelectField label="当前状态" path={`${path}.state`} value={ability.state} options={STATE_OPTIONS} {...common} />
                <TextAreaField label="传闻文本" path={`${path}.rumorText`} value={ability.rumorText ?? ""} rows={2} {...common} />
              </>
            )}
          </div>
        );
      })}
      {!sealedHidden && <button
        type="button"
        disabled={!addAllowed}
        title={addAllowed ? undefined : addDisabledMessage ?? "已达到能力数量上限"}
        onClick={() => {
          if (!addAllowed) return;
          const kind = allowedKinds[0];
          if (!kind) return;
          const ref = nextAvailableAbilityRef(basePath, usedRefs);
          onEdit(basePath, [...abilities, createAbility?.(ref, kind) ?? blankAbility(ref, kind)]);
        }}
        className="justify-self-start rounded-md border border-dashed border-line px-4 py-1.5 text-sm text-ink-faint transition hover:border-gilt/40 hover:text-gilt disabled:cursor-not-allowed disabled:opacity-40"
      >
        ＋ 添一项能力
      </button>}
    </div>
  );
}

/** 仅供调用方保持能力编辑区的章节视觉一致。 */
export function AbilitySection({ title }: { title: string }) {
  return <Sect title={title} />;
}
