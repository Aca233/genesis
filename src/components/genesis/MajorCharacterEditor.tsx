"use client";

import { useState } from "react";
import type { WorldDeck } from "@/lib/cards/schemas";
import {
  changeCharacterRace,
  firstRacialInnateAbilityRef,
  isPathLocked,
  traditionAbilityRefsForRace,
} from "./deck-utils";
import { AbilityEditor, AbilitySection } from "./AbilityEditor";
import { ListField, SelectField, TextAreaField, TextField } from "./fields";

type Props = {
  deck: WorldDeck;
  index: number;
  lockedPaths: string[];
  onEdit: (path: string, value: unknown) => void;
};

function ReferenceChoices({
  label,
  path,
  options,
  selectedRefs,
  lockedPaths,
  onEdit,
}: {
  label: string;
  path: string;
  options: Array<{ ref: string; label: string }>;
  selectedRefs: string[];
  lockedPaths: string[];
  onEdit: (path: string, value: unknown) => void;
}) {
  const locked = isPathLocked(lockedPaths, path);
  return (
    <fieldset className="grid gap-1">
      <legend className="text-xs text-ink-faint">
        {label}{locked && <span className="ml-1 text-gilt/80" title="手改字段，重掷时保留">🔒</span>}
      </legend>
      <div className="grid gap-1.5 rounded-md border border-line bg-paper p-3">
        {options.length === 0 ? (
          <p className="text-sm text-ink-faint">暂无可引用的条目。</p>
        ) : options.map((option) => {
          const selected = selectedRefs.includes(option.ref);
          return (
            <label key={option.ref} className="flex cursor-pointer items-start gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onEdit(
                  path,
                  selected
                    ? selectedRefs.filter((ref) => ref !== option.ref)
                    : [...selectedRefs, option.ref],
                )}
                className="mt-0.5 accent-gilt"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 主要人物卡的关系、种族传承与个人能力编辑器。 */
export function MajorCharacterEditor({ deck, index, lockedPaths, onEdit }: Props) {
  const character = deck.majorCharacters[index];
  const [notice, setNotice] = useState<string | null>(null);
  if (!character) return null;

  const base = `majorCharacters.${index}`;
  const common = { lockedPaths, onEdit };
  const currentRace = deck.races.find((race) => race.ref === character.raceRef);
  const raceOptions = deck.races.map((race) => ({
    value: race.ref,
    label: `${race.name} · ${race.ref}`,
  }));
  const factionOptions = deck.factions.map((faction) => ({
    value: faction.ref,
    label: `${faction.name} · ${faction.ref}`,
  }));
  const learnedOptions = traditionAbilityRefsForRace(deck, character.raceRef).map((ref) => {
    const ability = currentRace?.abilities.find((entry) => entry.ref === ref);
    return { ref, label: `${ability?.name ?? ref} · ${ref}` };
  });
  const innateOptions = deck.races.flatMap((race) =>
    race.abilities
      .filter((ability) => ability.kind === "racial_innate")
      .map((ability) => ({
        value: ability.ref,
        label: `${race.name} · ${ability.name} · ${ability.ref}`,
      })),
  );
  const firstInnateRef = firstRacialInnateAbilityRef(deck);

  const selectedTraditions = character.learnedTraditionRefs.map((reference) => reference.sourceAbilityRef);

  return (
    <>
      <TextField label="姓名" path={`${base}.name`} value={character.name} {...common} />
      <ListField label="别名" path={`${base}.aliases`} values={character.aliases} {...common} />
      <TextField label="身份与社会角色" path={`${base}.identity`} value={character.identity} {...common} />
      <TextField label="年龄阶段" path={`${base}.ageStage`} value={character.ageStage} {...common} />
      <SelectField
        label="主种族"
        path={`${base}.raceRef`}
        value={character.raceRef}
        options={raceOptions}
        lockedPaths={lockedPaths}
        onEdit={(_path, value) => {
          const nextRaceRef = String(value);
          const changed = changeCharacterRace(character, nextRaceRef, deck);
          onEdit(`${base}.raceRef`, changed.character.raceRef);
          onEdit(`${base}.learnedTraditionRefs`, changed.character.learnedTraditionRefs);
          setNotice(
            changed.removedTraditionRefs.length > 0
              ? "已移除旧种族技艺引用"
              : null,
          );
        }}
      />
      {notice && <p className="rounded-md border border-gilt/30 bg-gilt/5 px-3 py-2 text-sm text-gilt">{notice}</p>}

      <AbilitySection title="势力成员" />
      <div className="grid gap-3">
        {character.factionMemberships.map((membership, membershipIndex) => (
          <div key={`${membership.factionRef}-${membershipIndex}`} className="grid gap-2 rounded-md border border-line bg-paper p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-faint">成员关系 {membershipIndex + 1}</span>
              <button
                type="button"
                onClick={() => onEdit(
                  `${base}.factionMemberships`,
                  character.factionMemberships.filter((_, entryIndex) => entryIndex !== membershipIndex),
                )}
                className="rounded-md border border-line px-2.5 py-0.5 text-xs text-ink-faint transition hover:border-cinnabar/50 hover:text-cinnabar"
              >
                删除
              </button>
            </div>
            <SelectField label="势力" path={`${base}.factionMemberships.${membershipIndex}.factionRef`} value={membership.factionRef} options={factionOptions} {...common} />
            <TextField label="职务" path={`${base}.factionMemberships.${membershipIndex}.role`} value={membership.role} {...common} />
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={membership.isPrimary}
                onChange={(event) => onEdit(`${base}.factionMemberships.${membershipIndex}.isPrimary`, event.target.checked)}
                className="accent-gilt"
              />
              主要归属
            </label>
          </div>
        ))}
        {deck.factions.some((faction) => !character.factionMemberships.some((membership) => membership.factionRef === faction.ref)) && (
          <button
            type="button"
            onClick={() => {
              const faction = deck.factions.find((entry) => !character.factionMemberships.some((membership) => membership.factionRef === entry.ref));
              if (!faction) return;
              onEdit(`${base}.factionMemberships`, [...character.factionMemberships, { factionRef: faction.ref, role: "成员", isPrimary: character.factionMemberships.length === 0 }]);
            }}
            className="justify-self-start rounded-md border border-dashed border-line px-4 py-1.5 text-sm text-ink-faint transition hover:border-gilt/40 hover:text-gilt"
          >
            ＋ 加入势力
          </button>
        )}
      </div>

      <AbilitySection title="人物内核" />
      <TextAreaField label="性情" path={`${base}.personality`} value={character.personality} rows={3} {...common} />
      <TextAreaField label="目标" path={`${base}.goals`} value={character.goals} rows={3} {...common} />
      <TextAreaField label="当前处境" path={`${base}.situation`} value={character.situation} rows={3} {...common} />
      <TextAreaField label="与诸神的关系" path={`${base}.divineTies`} value={character.divineTies} rows={2} {...common} />
      <TextAreaField label="与时代冲突的关系" path={`${base}.conflictTies`} value={character.conflictTies} rows={2} {...common} />

      <AbilitySection title="已掌握的族群技艺" />
      <ReferenceChoices
        label="仅可引用主种族的族群技艺"
        path={`${base}.learnedTraditionRefs`}
        options={learnedOptions}
        selectedRefs={selectedTraditions}
        lockedPaths={lockedPaths}
        onEdit={(_path, refs) => onEdit(`${base}.learnedTraditionRefs`, (refs as string[]).map((sourceAbilityRef) => ({ sourceAbilityRef })))}
      />

      <AbilitySection title="先天覆写" />
      {character.racialOverrides.map((override, overrideIndex) => (
        <div key={override.ref} className="grid gap-2 rounded-md border border-line bg-paper p-3">
          <SelectField label="来源先天能力" path={`${base}.racialOverrides.${overrideIndex}.sourceAbilityRef`} value={override.sourceAbilityRef} options={innateOptions} {...common} />
          <TextAreaField label="血脉依据（跨主种族时必填）" path={`${base}.racialOverrides.${overrideIndex}.bloodlineJustification`} value={override.bloodlineJustification ?? ""} rows={2} {...common} />
        </div>
      ))}
      <AbilityEditor
        abilities={character.racialOverrides}
        basePath={`${base}.racialOverrides`}
        allowedKinds={["racial_innate"]}
        lockedPaths={lockedPaths}
        onEdit={onEdit}
        canAdd={firstInnateRef !== undefined}
        addDisabledMessage="没有可引用的先天模板，无法新增先天覆写"
        createAbility={(ref) => {
          if (firstInnateRef === undefined) {
            throw new Error("新增先天覆写前必须存在可引用的先天模板");
          }
          return {
            ref,
            name: "新先天覆写",
            kind: "racial_innate",
            effect: "",
            trigger: "",
            cost: "无",
            limitations: "",
            mastery: "novice",
            state: "normal",
            visibility: "known",
            rumorText: null,
            lockedFields: [],
            sourceAbilityRef: firstInnateRef,
            bloodlineJustification: null,
          };
        }}
      />

      <AbilitySection title="个人技能" />
      <AbilityEditor
        abilities={character.abilities}
        basePath={`${base}.abilities`}
        allowedKinds={["personal"]}
        lockedPaths={lockedPaths}
        onEdit={onEdit}
        minItems={2}
        maxItems={5}
      />
    </>
  );
}
