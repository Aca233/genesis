"use client";

import type { PantheonWorldDeck, WorldDeck } from "@/lib/cards/schemas";
import { RANKS } from "@/lib/cards/schemas";
import {
  RANK_LABELS,
  STANCE_LABELS,
  RELATION_LABELS,
  STYLE_PRESET_LABELS,
  type Rank,
  abilityRefsInDeck,
  isPathLocked,
  addCreatorGodRelation,
  creatorRelationTargetRefs,
  removeCreatorGodRelation,
  updateCreatorGodRelation,
} from "./deck-utils";
import { AbilityEditor, AbilitySection } from "./AbilityEditor";
import {
  TextField,
  TextAreaField,
  SelectField,
  ListField,
  SealedBlock,
  Sect,
} from "./fields";

/** 各卡片的全文编辑表单（在 CardEditorModal 内使用） */

type EditorProps = {
  deck: WorldDeck;
  lockedPaths: string[];
  onEdit: (path: string, value: unknown) => void;
};

type PantheonEditorProps = Omit<EditorProps, "deck"> & {
  deck: PantheonWorldDeck;
};

const RANK_OPTIONS = RANKS.map((r) => ({ value: r, label: RANK_LABELS[r] }));
const STANCE_OPTIONS = Object.entries(STANCE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const RELATION_OPTIONS = Object.entries(RELATION_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const STYLE_OPTIONS = Object.entries(STYLE_PRESET_LABELS).map(
  ([value, label]) => ({ value, label }),
);

// ───────────────────────── 宇宙论 ─────────────────────────

export function CosmologyEditor({ deck, lockedPaths, onEdit }: EditorProps) {
  const c = deck.cosmology;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <TextAreaField label="世界起源" path="cosmology.origin" value={c.origin} {...common} />
      <TextAreaField label="力量体系" path="cosmology.powerSystem" value={c.powerSystem} {...common} />
      <TextAreaField label="天道 / 物理法则" path="cosmology.laws" value={c.laws} {...common} />
      <TextAreaField label="神之存在方式" path="cosmology.divinity" value={c.divinity} {...common} />
    </>
  );
}

// ───────────────────────── 融合公理 ─────────────────────────

export function FusionAxiomEditor({ deck, lockedPaths, onEdit }: EditorProps) {
  const f = deck.fusionAxiom;
  if (!f) return null;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <ListField label="融合的 IP" path="fusionAxiom.sourceIps" values={f.sourceIps} {...common} />
      <ListField label="缝合公理（逐条）" path="fusionAxiom.axioms" values={f.axioms} {...common} />
      <TextAreaField label="力量对标表" path="fusionAxiom.powerMapping" value={f.powerMapping} {...common} />
      <TextAreaField label="设定冲突时以谁为准" path="fusionAxiom.conflictRule" value={f.conflictRule} rows={2} {...common} />
    </>
  );
}

// ───────────────────────── 玩家神 ─────────────────────────

export function PlayerGodEditor({ deck, lockedPaths, onEdit }: PantheonEditorProps) {
  const g = deck.playerGod;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <TextField label="名号" path="playerGod.name" value={g.name} {...common} />
      <TextAreaField label="出身" path="playerGod.origin" value={g.origin} rows={2} {...common} />
      <ListField label="领域" path="playerGod.domains" values={g.domains} {...common} />
      <SelectField label="位阶" path="playerGod.rank" value={g.rank} options={RANK_OPTIONS} {...common} />
      <TextAreaField label="初始信仰势力" path="playerGod.faithBase" value={g.faithBase} rows={2} {...common} />
      <TextAreaField label="开局处境与钩子" path="playerGod.situation" value={g.situation} rows={4} {...common} />
      <AbilitySection title="神权" />
      <AbilityEditor
        abilities={g.abilities}
        basePath="playerGod.abilities"
        allowedKinds={["divine"]}
        lockedPaths={lockedPaths}
        onEdit={onEdit}
        minItems={3}
        maxItems={6}
        usedRefs={abilityRefsInDeck(deck)}
      />
    </>
  );
}

// ───────────────────────── 主神（单卡） ─────────────────────────

export function MajorGodEditor(props: EditorProps & {
  index: number;
  agendaRevealed: boolean;
  onRevealAgenda: () => void;
}) {
  return props.deck.mode === "pantheon"
    ? <PantheonMajorGodEditor {...props} deck={props.deck} />
    : <CreatorMajorGodEditor {...props} deck={props.deck} />;
}

function MajorGodSharedFields({
  deck,
  index,
  lockedPaths,
  onEdit,
  agendaRevealed,
  onRevealAgenda,
  relationFields,
  stanceFields,
}: EditorProps & {
  index: number;
  agendaRevealed: boolean;
  onRevealAgenda: () => void;
  relationFields: React.ReactNode;
  stanceFields: React.ReactNode;
}) {
  const god = deck.majorGods[index];
  if (!god) return null;
  const base = `majorGods.${index}`;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <TextField label="名号" path={`${base}.name`} value={god.name} {...common} />
      <ListField label="别名与称号" path={`${base}.aliases`} values={god.aliases} {...common} />
      <ListField label="领域" path={`${base}.domains`} values={god.domains} {...common} />
      <SelectField label="位阶" path={`${base}.rank`} value={god.rank} options={RANK_OPTIONS} {...common} />
      <TextAreaField label="性情与外显形象" path={`${base}.persona`} value={god.persona} rows={3} {...common} />
      <TextAreaField label="信仰范围" path={`${base}.faithScope`} value={god.faithScope} rows={2} {...common} />

      <Sect title="声纹" />
      <ListField label="语癖" path={`${base}.voice.verbalTics`} values={god.voice.verbalTics} {...common} />
      <TextField label="称呼习惯" path={`${base}.voice.address`} value={god.voice.address} {...common} />
      <ListField label="口头禅" path={`${base}.voice.catchphrases`} values={god.voice.catchphrases} {...common} />
      <ListField label="绝不会说的话" path={`${base}.voice.neverSays`} values={god.voice.neverSays} {...common} />

      {relationFields}

      <AbilitySection title="神权" />
      <AbilityEditor
        abilities={god.abilities}
        basePath={`${base}.abilities`}
        allowedKinds={["divine"]}
        lockedPaths={lockedPaths}
        onEdit={onEdit}
        sensitiveFieldsRevealed={agendaRevealed}
        minItems={3}
        maxItems={6}
        usedRefs={abilityRefsInDeck(deck)}
        hideSealedHidden
      />

      <Sect title="议程（天机）" />
      {!agendaRevealed ? (
        <SealedBlock
          message="窥探天机将自破迷雾，此神的图谋将永久对你可见。确定？"
          onReveal={onRevealAgenda}
        />
      ) : (
        <>
          <TextAreaField label="长期目标" path={`${base}.agenda.longTermGoal`} value={god.agenda.longTermGoal} rows={2} {...common} />
          <ListField label="短期目标" path={`${base}.agenda.shortTermGoals`} values={god.agenda.shortTermGoals} {...common} />
          <TextAreaField label="手段偏好" path={`${base}.agenda.methods`} value={god.agenda.methods} rows={2} {...common} />
          {stanceFields}
          <ListField label="进行中的密谋" path={`${base}.agenda.schemes`} values={god.agenda.schemes} {...common} />
        </>
      )}
    </>
  );
}

function PantheonMajorGodEditor(props: Omit<EditorProps, "deck"> & {
  deck: PantheonWorldDeck;
  index: number;
  agendaRevealed: boolean;
  onRevealAgenda: () => void;
}) {
  const god = props.deck.majorGods[props.index];
  if (!god) return null;
  const base = `majorGods.${props.index}`;
  const common = { lockedPaths: props.lockedPaths, onEdit: props.onEdit };
  return (
    <MajorGodSharedFields
      {...props}
      relationFields={<>
        <Sect title="与玩家神的初始关系" />
        <SelectField label="关系" path={`${base}.initialRelationToPlayer.label`} value={god.initialRelationToPlayer.label} options={RELATION_OPTIONS} {...common} />
        <TextAreaField label="备注" path={`${base}.initialRelationToPlayer.note`} value={god.initialRelationToPlayer.note} rows={2} {...common} />
      </>}
      stanceFields={<>
        <SelectField label="对玩家神的真实态度" path={`${base}.agenda.stanceToPlayer.level`} value={god.agenda.stanceToPlayer.level} options={STANCE_OPTIONS} {...common} />
        <TextField label="态度动机（一句话）" path={`${base}.agenda.stanceToPlayer.motive`} value={god.agenda.stanceToPlayer.motive} {...common} />
      </>}
    />
  );
}

function CreatorMajorGodEditor(props: Omit<EditorProps, "deck"> & {
  deck: Extract<WorldDeck, { mode: "creator" }>;
  index: number;
  agendaRevealed: boolean;
  onRevealAgenda: () => void;
}) {
  return (
    <MajorGodSharedFields
      {...props}
      relationFields={<CreatorGodRelationsEditor {...props} />}
      stanceFields={null}
    />
  );
}

function CreatorGodRelationsEditor({
  deck,
  index,
  lockedPaths,
  onEdit,
}: EditorProps & { index: number }) {
  if (deck.mode !== "creator") return null;
  const god = deck.majorGods[index];
  if (!god) return null;
  const path = `majorGods.${index}.relations`;
  const common = { lockedPaths };
  return (
    <>
      <Sect title="与世界内诸神的关系" />
      {god.relations.map((relation, relationIndex) => {
        const relationPath = `${path}.${relationIndex}`;
        const targetOptions = creatorRelationTargetRefs(deck, index, relationIndex)
          .map((ref) => deck.majorGods.find((target) => target.ref === ref))
          .filter((target) => target !== undefined)
          .map((target) => ({ value: target.ref, label: `${target.name} · ${target.ref}` }));
        const editRelation = (patch: Partial<typeof relation>) =>
          updateCreatorGodRelation(deck, index, relationIndex, patch);
        return (
          <div key={`${relation.targetGodRef}-${relationIndex}`} className="grid gap-3 rounded-md border border-line bg-paper p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-ink-faint">关系 {relationIndex + 1}</span>
              <button
                type="button"
                onClick={() => {
                  const next = removeCreatorGodRelation(deck, index, relationIndex);
                  onEdit(path, next.majorGods[index]!.relations);
                }}
                className="rounded-md border border-line px-2.5 py-0.5 text-xs text-ink-faint transition hover:border-cinnabar/50 hover:text-cinnabar"
              >
                删除
              </button>
            </div>
            <SelectField
              label="目标神明"
              path={`${relationPath}.targetGodRef`}
              value={relation.targetGodRef}
              options={targetOptions}
              onEdit={(_, value) => {
                const next = editRelation({ targetGodRef: String(value) });
                onEdit(`${relationPath}.targetGodRef`, next.majorGods[index]!.relations[relationIndex]!.targetGodRef);
              }}
              {...common}
            />
            <SelectField
              label="关系"
              path={`${relationPath}.label`}
              value={relation.label}
              options={RELATION_OPTIONS}
              onEdit={(_, value) => {
                const next = editRelation({ label: value as typeof relation.label });
                onEdit(`${relationPath}.label`, next.majorGods[index]!.relations[relationIndex]!.label);
              }}
              {...common}
            />
            <TextAreaField
              label="备注"
              path={`${relationPath}.note`}
              value={relation.note}
              rows={2}
              onEdit={(_, value) => {
                const next = editRelation({ note: String(value) });
                onEdit(`${relationPath}.note`, next.majorGods[index]!.relations[relationIndex]!.note);
              }}
              {...common}
            />
          </div>
        );
      })}
      <button
        type="button"
        disabled={creatorRelationTargetRefs(deck, index).length === 0}
        onClick={() => {
          const next = addCreatorGodRelation(deck, index);
          if (next === deck) return;
          onEdit(path, next.majorGods[index]!.relations);
        }}
        className="justify-self-start rounded-md border border-dashed border-line px-4 py-1.5 text-sm text-ink-faint transition hover:border-gilt/40 hover:text-gilt disabled:opacity-40"
      >
        ＋ 添一条神际关系
      </button>
    </>
  );
}

// ───────────────────────── 次要神列表 ─────────────────────────

export function MinorGodsEditor({
  deck,
  lockedPaths,
  onEdit,
  onPromote,
}: EditorProps & { onPromote: (index: number) => void }) {
  const list = deck.minorGods;
  const common = { lockedPaths, onEdit };
  return (
    <>
      {list.map((g, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-md border border-line bg-paper p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-faint">第 {i + 1} 位</span>
            <div className="flex gap-2">
              <button
                type="button"
                title="升格为主神（声纹与议程以占位模板补全，请随后完善）"
                onClick={() => onPromote(i)}
                className="rounded-md border border-gilt/40 px-2.5 py-0.5 text-xs text-gilt transition hover:bg-gilt/10"
              >
                ☖ 升格
              </button>
              <button
                type="button"
                onClick={() =>
                  onEdit(
                    "minorGods",
                    list.filter((_, j) => j !== i),
                  )
                }
                className="rounded-md border border-line px-2.5 py-0.5 text-xs text-ink-faint transition hover:border-cinnabar/50 hover:text-cinnabar"
              >
                除名
              </button>
            </div>
          </div>
          <TextField label="名号" path={`minorGods.${i}.name`} value={g.name} {...common} />
          <TextAreaField label="一句话设定" path={`minorGods.${i}.brief`} value={g.brief} rows={2} {...common} />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onEdit("minorGods", [...list, { name: "无名小神", brief: "" }])
        }
        className="justify-self-start rounded-md border border-dashed border-line px-4 py-1.5 text-sm text-ink-faint transition hover:border-gilt/40 hover:text-gilt"
      >
        ＋ 添一位次要神
      </button>
    </>
  );
}

// ───────────────────────── 势力 / 种族 / 地理 ─────────────────────────

export function FactionEditor({
  deck,
  index,
  lockedPaths,
  onEdit,
}: EditorProps & { index: number }) {
  const f = deck.factions[index];
  if (!f) return null;
  const base = `factions.${index}`;
  const common = { lockedPaths, onEdit };
  const selectedRefs = f.keyCharacterRefs.map((reference) => reference.ref);
  const keyRefsPath = `${base}.keyCharacterRefs`;
  return (
    <>
      <TextField label="名号" path={`${base}.name`} value={f.name} {...common} />
      <ListField label="别名" path={`${base}.aliases`} values={f.aliases} {...common} />
      <TextField label="类型（国家/宗门/教团/军团等）" path={`${base}.kind`} value={f.kind} {...common} />
      <TextAreaField label="概览" path={`${base}.overview`} value={f.overview} rows={4} {...common} />
      <TextAreaField label="疆域" path={`${base}.territory`} value={f.territory} rows={2} {...common} />
      <TextAreaField label="信仰归属与浓度" path={`${base}.faith`} value={f.faith} rows={2} {...common} />
      <fieldset className="grid gap-1">
        <legend className="text-xs text-ink-faint">
          关键人物（仅可引用人物名录）
          {isPathLocked(lockedPaths, keyRefsPath) && <span className="ml-1 text-gilt/80" title="手改字段，重掷时保留">🔒</span>}
        </legend>
        <div className="grid gap-1.5 rounded-md border border-line bg-paper p-3">
          {deck.majorCharacters.map((character) => {
            const checked = selectedRefs.includes(character.ref);
            return (
              <label key={character.ref} className="flex cursor-pointer items-start gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onEdit(
                    keyRefsPath,
                    checked
                      ? f.keyCharacterRefs.filter((reference) => reference.ref !== character.ref)
                      : [...f.keyCharacterRefs, { ref: character.ref }],
                  )}
                  className="mt-0.5 accent-gilt"
                />
                <span>{character.name} · {character.identity} · {character.ref}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}

export function RaceEditor({
  deck,
  index,
  lockedPaths,
  onEdit,
}: EditorProps & { index: number }) {
  const r = deck.races[index];
  if (!r) return null;
  const base = `races.${index}`;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <TextField label="族名" path={`${base}.name`} value={r.name} {...common} />
      <ListField label="别名" path={`${base}.aliases`} values={r.aliases} {...common} />
      <TextAreaField label="特质" path={`${base}.traits`} value={r.traits} rows={3} {...common} />
      <TextField label="寿命" path={`${base}.lifespan`} value={r.lifespan} {...common} />
      <TextAreaField label="分布" path={`${base}.distribution`} value={r.distribution} rows={2} {...common} />
      <TextAreaField label="与诸神的渊源" path={`${base}.divineTies`} value={r.divineTies} rows={2} {...common} />
      <AbilitySection title="先天能力" />
      <AbilityEditor
        abilities={r.abilities}
        basePath={`${base}.abilities`}
        allowedKinds={["racial_innate"]}
        lockedPaths={lockedPaths}
        onEdit={onEdit}
        minItems={2}
        maxItems={5}
        usedRefs={abilityRefsInDeck(deck)}
      />
      <AbilitySection title="族群技艺" />
      <AbilityEditor
        abilities={r.abilities}
        basePath={`${base}.abilities`}
        allowedKinds={["racial_tradition"]}
        lockedPaths={lockedPaths}
        onEdit={onEdit}
        minItems={2}
        maxItems={5}
        usedRefs={abilityRefsInDeck(deck)}
      />
    </>
  );
}

export function PlaceEditor({
  deck,
  index,
  lockedPaths,
  onEdit,
}: EditorProps & { index: number }) {
  const p = deck.places[index];
  if (!p) return null;
  const base = `places.${index}`;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <TextField label="地名" path={`${base}.name`} value={p.name} {...common} />
      <ListField label="别名" path={`${base}.aliases`} values={p.aliases} {...common} />
      <TextField label="类型（大陆/城市/秘境/圣地）" path={`${base}.kind`} value={p.kind} {...common} />
      <TextAreaField label="概览" path={`${base}.overview`} value={p.overview} rows={4} {...common} />
      <TextAreaField label="归属" path={`${base}.allegiance`} value={p.allegiance} rows={2} {...common} />
    </>
  );
}

// ───────────────────────── 纪元冲突 ─────────────────────────

export function EpochConflictEditor({
  deck,
  lockedPaths,
  onEdit,
  currentsRevealed,
  onRevealCurrents,
}: EditorProps & {
  currentsRevealed: boolean;
  onRevealCurrents: () => void;
}) {
  const e = deck.epochConflict;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <TextField label="当前纪元名" path="epochConflict.epochName" value={e.epochName} {...common} />
      <TextField label="当前纪年" path="epochConflict.yearLabel" value={e.yearLabel} {...common} />
      <ListField label="公开的时代矛盾" path="epochConflict.overtConflicts" values={e.overtConflicts} {...common} />

      <Sect title="暗流（天机）" />
      {!currentsRevealed ? (
        <SealedBlock
          message="窥探天机将自破迷雾，时代的暗流将永久对你可见。确定？"
          onReveal={onRevealCurrents}
        />
      ) : (
        <ListField label="暗流（诸神议程的种子）" path="epochConflict.hiddenCurrents" values={e.hiddenCurrents} {...common} />
      )}
    </>
  );
}

// ───────────────────────── 叙事风格 / 主题措辞 ─────────────────────────

export function StyleEditor({ deck, lockedPaths, onEdit }: EditorProps) {
  const s = deck.style;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <SelectField label="文风预设" path="style.preset" value={s.preset} options={STYLE_OPTIONS} {...common} />
      <TextField label="预设中文名" path="style.presetName" value={s.presetName} {...common} />
      <TextAreaField label="文风细则" path="style.toneNotes" value={s.toneNotes} rows={4} {...common} />
    </>
  );
}

export function ThemeEditor({ deck, lockedPaths, onEdit }: EditorProps) {
  const t = deck.theme;
  const common = { lockedPaths, onEdit };
  return (
    <>
      <TextField label="纪年体系名" path="theme.eraSystem" value={t.eraSystem} {...common} />
      <TextAreaField label="称谓习惯" path="theme.addressStyle" value={t.addressStyle} rows={2} {...common} />
      <Sect title="位阶的世界观措辞" />
      {RANKS.map((rank: Rank) => (
        <TextField
          key={rank}
          label={`${RANK_LABELS[rank]}（${rank}）`}
          path={`theme.rankNames.${rank}`}
          value={t.rankNames[rank] ?? ""}
          {...common}
        />
      ))}
    </>
  );
}
