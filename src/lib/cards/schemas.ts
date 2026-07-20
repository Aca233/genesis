import { z } from "zod";
import {
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
} from "@/lib/abilities/types";

/**
 * 世界卡组 Schema —— 全项目的数据契约锚点（docs/01 §2.2）。
 * Genesis 生成、卡片编辑器、Narrator 上下文、百科种子全部引用此文件。
 * 所有面向玩家的文本一律中文。
 */

// ───────────────────────── 基础 ─────────────────────────

/** 神力位阶内部枚举（主题卡负责世界观措辞映射） */
export const RANKS = [
  "fallen",     // 陨灭
  "ember",      // 余烬
  "slumbering", // 沉睡
  "nascent",    // 微末
  "ascended",   // 成神
  "exalted",    // 显赫
  "sovereign",  // 主宰
] as const;
export const RankSchema = z.enum(RANKS);

export const StanceSchema = z.enum([
  "hostility",   // 敌意
  "rivalry",     // 竞争
  "neutral",     // 中立
  "cooperation", // 合作
  "dependence",  // 依附
]);

export const RelationLabelSchema = z.enum([
  "enemy",    // 敌对
  "rival",    // 竞争
  "neutral",  // 中立
  "ally",     // 盟友
  "vassal",   // 隶属
  "unknown",  // 未知（星图不画线）
]);

/** 叙事尺度五档：瞬息/场景/数载/年代/纪元 */
export const ScaleSchema = z.enum(["moment", "scene", "years", "era", "epoch"]);
export type Scale = z.infer<typeof ScaleSchema>;

/** Trimmed non-empty reference key used for all cross-card and ability identities. */
export const StableRefSchema = z.string().trim().min(1, "ref 不能为空白");

// ───────────────────────── 单卡 ─────────────────────────

/** 卡组阶段使用的能力完整描述；ref 是草稿内的稳定关系键。 */
export const DeckAbilitySchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  kind: AbilityKindSchema,
  effect: z.string().describe("叙事中的实际效果"),
  trigger: z.string().describe("被动生效或主动发动条件"),
  cost: z.string().describe("代价；没有时写无"),
  limitations: z.string().describe("边界、克制方式及不能做到的事"),
  mastery: AbilityMasterySchema,
  state: AbilityStateSchema,
  visibility: AbilityVisibilitySchema,
  rumorText: z.string().nullable(),
  lockedFields: z.array(z.string()).default([]),
});

export const RaceDeckAbilitySchema = DeckAbilitySchema.refine(
  (ability) => ability.kind === "racial_innate" || ability.kind === "racial_tradition",
  "种族能力只能是 racial_innate 或 racial_tradition",
);
export const DivineDeckAbilitySchema = DeckAbilitySchema.refine(
  (ability) => ability.kind === "divine",
  "神权能力只能是 divine",
);
export const PersonalDeckAbilitySchema = DeckAbilitySchema.refine(
  (ability) => ability.kind === "personal",
  "人物个人技能只能是 personal",
);

export const FactionMembershipSchema = z.object({
  factionRef: StableRefSchema,
  role: z.string().describe("人物在势力中的职务"),
  isPrimary: z.boolean().describe("是否为主要归属"),
});

export const RacialOverrideSchema = DeckAbilitySchema.extend({
  sourceAbilityRef: StableRefSchema,
  bloodlineJustification: z.string().min(1).nullable(),
}).refine(
  (ability) => ability.kind === "racial_innate",
  "先天覆写只能是 racial_innate",
);

export const MajorCharacterCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  aliases: z.array(z.string()),
  identity: z.string().describe("身份与社会角色"),
  ageStage: z.string().describe("年龄阶段"),
  raceRef: StableRefSchema.describe("主种族稳定引用"),
  factionMemberships: z.array(FactionMembershipSchema),
  personality: z.string(),
  goals: z.string(),
  situation: z.string().describe("当前处境"),
  divineTies: z.string().describe("与诸神的关系"),
  conflictTies: z.string().describe("与时代冲突的关系"),
  learnedTraditionRefs: z.array(z.object({ sourceAbilityRef: StableRefSchema })),
  racialOverrides: z.array(RacialOverrideSchema),
  abilities: z.array(PersonalDeckAbilitySchema).min(2).max(5).describe("个人技能"),
});

export const CosmologyCardSchema = z.object({
  origin: z.string().describe("世界起源"),
  powerSystem: z.string().describe("力量体系"),
  laws: z.string().describe("天道/物理法则"),
  divinity: z.string().describe("神之存在方式：位格来源、信仰依赖等"),
});

export const FusionAxiomCardSchema = z.object({
  sourceIps: z.array(z.string()).min(2).describe("融合的IP列表"),
  axioms: z.array(z.string()).min(1).describe("缝合公理，逐条"),
  powerMapping: z.string().describe("力量对标表"),
  conflictRule: z.string().describe("设定冲突时以谁为准"),
});

export const GodVoiceSchema = z.object({
  verbalTics: z.array(z.string()).describe("语癖"),
  address: z.string().describe("称呼习惯"),
  catchphrases: z.array(z.string()).describe("口头禅"),
  neverSays: z.array(z.string()).describe("绝不会说的话"),
});

export const GodAgendaSchema = z.object({
  longTermGoal: z.string(),
  shortTermGoals: z.array(z.string()),
  methods: z.string().describe("手段偏好"),
  stanceToPlayer: z.object({
    level: StanceSchema,
    motive: z.string().describe("一句话动机"),
  }),
  schemes: z.array(z.string()).describe("进行中的密谋"),
});

export const MajorGodCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用，供跨卡关系与开局物化使用"),
  name: z.string(),
  aliases: z.array(z.string()).describe("别名与称号"),
  domains: z.array(z.string()).describe("领域"),
  rank: RankSchema,
  persona: z.string().describe("性情与外显形象"),
  voice: GodVoiceSchema,
  agenda: GodAgendaSchema.describe("对玩家默认隐藏"),
  initialRelationToPlayer: z.object({
    label: RelationLabelSchema,
    note: z.string(),
  }),
  faithScope: z.string().describe("信仰范围一句话"),
  abilities: z.array(DivineDeckAbilitySchema).min(3).max(6).describe("神权能力"),
});

export const MinorGodSchema = z.object({
  name: z.string(),
  brief: z.string().describe("一句话设定"),
});

export const PlayerGodCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用，供开局物化使用"),
  name: z.string(),
  origin: z.string().describe("出身：新神/既有神/转生神/篡位者等，从玩家输入推断"),
  domains: z.array(z.string()),
  rank: RankSchema,
  faithBase: z.string().describe("初始信仰势力"),
  situation: z.string().describe("开局处境与钩子"),
  abilities: z.array(DivineDeckAbilitySchema).min(3).max(6).describe("玩家神权"),
});

export const FactionCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  aliases: z.array(z.string()),
  kind: z.string().describe("国家/宗门/教团/军团等"),
  overview: z.string(),
  territory: z.string(),
  faith: z.string().describe("信仰归属与浓度"),
  keyCharacterRefs: z.array(z.object({ ref: StableRefSchema })).describe("关键人物稳定引用"),
  // 旧草稿兼容字段；新的运行时关系以 keyCharacterRefs 为准。
  keyFigures: z.array(z.string()).optional().default([]).describe("旧草稿关键人物名"),
});

export const RaceCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  aliases: z.array(z.string()),
  traits: z.string(),
  lifespan: z.string(),
  distribution: z.string(),
  divineTies: z.string().describe("与诸神的渊源"),
  abilities: z.array(RaceDeckAbilitySchema).min(2).max(5).describe("先天能力与族群技艺"),
});

export const PlaceCardSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  kind: z.string().describe("大陆/城市/秘境/圣地"),
  overview: z.string(),
  allegiance: z.string().describe("归属"),
});

export const EpochConflictCardSchema = z.object({
  epochName: z.string().describe("当前纪元名"),
  yearLabel: z.string().describe("当前纪年"),
  overtConflicts: z.array(z.string()).describe("公开的时代矛盾"),
  hiddenCurrents: z.array(z.string()).describe("暗流（对玩家隐藏，作为诸神议程种子）"),
});

export const StyleCardSchema = z.object({
  preset: z.enum(["epic", "webnovel", "grimdark", "lightnovel", "canon"]),
  presetName: z.string().describe("预设中文名"),
  toneNotes: z.string().describe("文风细则"),
});

export const ThemeCardSchema = z.object({
  eraSystem: z.string().describe("纪年体系名，如「帝国历」「天元纪」"),
  rankNames: z
    .record(RankSchema, z.string())
    .describe("位阶的世界观措辞映射，如 nascent→散仙"),
  typeNames: z
    .record(
      z.enum(["faction", "character", "race", "place", "artifact", "cult"]),
      z.string(),
    )
    .describe(
      "众生录六类的世界观措辞，如修仙界 faction→宗门势力、cult→道统；哥特帝国 faction→军团诸侯",
    ),
  addressStyle: z.string().describe("称谓习惯"),
});

// ───────────────────────── 卡组 ─────────────────────────

const StrictWorldDeckObjectSchema = z.object({
  worldName: z.string(),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable().describe("仅多IP融合时非空"),
  playerGod: PlayerGodCardSchema,
  majorGods: z.array(MajorGodCardSchema).min(4).max(10),
  minorGods: z.array(MinorGodSchema),
  factions: z.array(FactionCardSchema).min(2).max(8),
  races: z.array(RaceCardSchema),
  majorCharacters: z.array(MajorCharacterCardSchema).min(6).max(12),
  places: z.array(PlaceCardSchema),
  epochConflict: EpochConflictCardSchema,
  style: StyleCardSchema,
  theme: ThemeCardSchema,
});

/** Compatibility-only cards used after a positively identified pre-ability draft. */
const LegacyPlayerGodCardSchema = PlayerGodCardSchema.extend({
  abilities: z.array(DivineDeckAbilitySchema).max(6),
});
const LegacyMajorGodCardSchema = MajorGodCardSchema.extend({
  abilities: z.array(DivineDeckAbilitySchema).max(6),
});
const LegacyRaceCardSchema = RaceCardSchema.extend({
  abilities: z.array(RaceDeckAbilitySchema).max(5),
});
const LegacyMajorCharacterCardSchema = MajorCharacterCardSchema.extend({
  abilities: z.array(PersonalDeckAbilitySchema).max(5),
});

const LegacyWorldDeckObjectSchema = z.object({
  worldName: z.string(),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable().describe("仅多IP融合时非空"),
  playerGod: LegacyPlayerGodCardSchema,
  majorGods: z.array(LegacyMajorGodCardSchema).min(4).max(10),
  minorGods: z.array(MinorGodSchema),
  factions: z.array(FactionCardSchema).min(2).max(8),
  races: z.array(LegacyRaceCardSchema),
  majorCharacters: z.array(LegacyMajorCharacterCardSchema).max(12),
  places: z.array(PlaceCardSchema),
  epochConflict: EpochConflictCardSchema,
  style: StyleCardSchema,
  theme: ThemeCardSchema,
});

type DeckReferenceGraph = {
  playerGod: { ref: string; abilities: Array<{ ref: string }> };
  majorGods: Array<{ ref: string; abilities: Array<{ ref: string }> }>;
  races: Array<{ ref: string; abilities: Array<{ ref: string }> }>;
  factions: Array<{ ref: string }>;
  majorCharacters: Array<{
    ref: string;
    abilities: Array<{ ref: string }>;
    racialOverrides: Array<{ ref: string }>;
  }>;
};

function addUniqueRef(
  ctx: z.RefinementCtx,
  seen: Map<string, (string | number)[]>,
  ref: string,
  path: (string | number)[],
): void {
  if (ref.trim() === "") return;
  const firstPath = seen.get(ref);
  if (firstPath !== undefined) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `稳定 ref "${ref}" 与 ${firstPath.join(".")} 重复`,
    });
    return;
  }
  seen.set(ref, path);
}

/**
 * Every stable card ref and every DeckAbility / derived override ref shares one
 * namespace so provenance stays
 * unambiguous after a draft is saved or rerolled.
 */
function validateDeckReferenceUniqueness(
  deck: DeckReferenceGraph,
  ctx: z.RefinementCtx,
): void {
  const cardRefs = new Map<string, (string | number)[]>();
  const abilityRefs = new Map<string, (string | number)[]>();
  const addAbility = (ability: { ref: string }, path: (string | number)[]) =>
    addUniqueRef(ctx, abilityRefs, ability.ref, path);

  addUniqueRef(ctx, cardRefs, deck.playerGod.ref, ["playerGod", "ref"]);
  deck.playerGod.abilities.forEach((ability, index) =>
    addAbility(ability, ["playerGod", "abilities", index, "ref"]),
  );
  deck.majorGods.forEach((god, godIndex) => {
    addUniqueRef(ctx, cardRefs, god.ref, ["majorGods", godIndex, "ref"]);
    god.abilities.forEach((ability, abilityIndex) =>
      addAbility(ability, ["majorGods", godIndex, "abilities", abilityIndex, "ref"]),
    );
  });
  deck.races.forEach((race, raceIndex) => {
    addUniqueRef(ctx, cardRefs, race.ref, ["races", raceIndex, "ref"]);
    race.abilities.forEach((ability, abilityIndex) =>
      addAbility(ability, ["races", raceIndex, "abilities", abilityIndex, "ref"]),
    );
  });
  deck.factions.forEach((faction, index) =>
    addUniqueRef(ctx, cardRefs, faction.ref, ["factions", index, "ref"]),
  );
  deck.majorCharacters.forEach((character, characterIndex) => {
    addUniqueRef(ctx, cardRefs, character.ref, ["majorCharacters", characterIndex, "ref"]);
    character.abilities.forEach((ability, abilityIndex) =>
      addAbility(ability, ["majorCharacters", characterIndex, "abilities", abilityIndex, "ref"]),
    );
    character.racialOverrides.forEach((override, overrideIndex) =>
      addAbility(override, ["majorCharacters", characterIndex, "racialOverrides", overrideIndex, "ref"]),
    );
  });
}

/** Strict contract for every newly created, patched, or rerolled WorldDeck. */
export const WorldDeckSchema = StrictWorldDeckObjectSchema.superRefine(
  validateDeckReferenceUniqueness,
);

/** Compatibility parser used only after isLegacyWorldDeck() positively identifies an old draft. */
export const LegacyWorldDeckSchema = LegacyWorldDeckObjectSchema.superRefine(
  validateDeckReferenceUniqueness,
);

export type WorldDeck = z.infer<typeof WorldDeckSchema>;
export type LegacyWorldDeck = z.infer<typeof LegacyWorldDeckSchema>;
export type MajorGodCard = z.infer<typeof MajorGodCardSchema>;

export type PlayerGodCard = z.infer<typeof PlayerGodCardSchema>;

type LooseRecord = Record<string, unknown>;

function isLooseRecord(value: unknown): value is LooseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asLooseRecord(value: unknown): LooseRecord {
  return isLooseRecord(value) ? value : {};
}

function hasOwn(value: LooseRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function lacksOwnFields(value: unknown, fields: readonly string[]): boolean {
  return isLooseRecord(value) && fields.every((field) => !hasOwn(value, field));
}

function allRecordsLackFields(value: unknown, fields: readonly string[]): boolean {
  return Array.isArray(value) && value.every((record) => lacksOwnFields(record, fields));
}

function normalizeAbilities(value: unknown, prefix: string): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((rawAbility, index) => {
    const ability = asLooseRecord(rawAbility);
    return {
      ...ability,
      ...(hasOwn(ability, "ref") ? {} : { ref: `${prefix}-ability-${index + 1}` }),
    };
  });
}

function normalizeRacialOverrides(value: unknown, prefix: string): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((rawOverride, index) => {
    const override = asLooseRecord(rawOverride);
    return {
      ...override,
      ...(hasOwn(override, "ref") ? {} : { ref: `${prefix}-override-${index + 1}` }),
      ...(hasOwn(override, "name") ? {} : { name: `先天覆写${index + 1}` }),
      ...(hasOwn(override, "kind") ? {} : { kind: "racial_innate" }),
      ...(hasOwn(override, "effect") ? {} : { effect: "沿用来源能力的效果" }),
      ...(hasOwn(override, "trigger") ? {} : { trigger: "沿用来源能力的触发条件" }),
      ...(hasOwn(override, "cost") ? {} : { cost: "沿用来源能力的代价" }),
      ...(hasOwn(override, "limitations") ? {} : { limitations: "沿用来源能力的限制" }),
      ...(hasOwn(override, "mastery") ? {} : { mastery: "adept" }),
      ...(hasOwn(override, "state") ? {} : { state: "normal" }),
      ...(hasOwn(override, "visibility") ? {} : { visibility: "known" }),
      ...(hasOwn(override, "rumorText") ? {} : { rumorText: null }),
      ...(hasOwn(override, "bloodlineJustification") ? {} : { bloodlineJustification: null }),
    };
  });
}

/**
 * Returns true only for a complete pre-ability-era fingerprint.
 *
 * Compatibility normalization may synthesize stable refs and empty collections, so
 * it must never run for partially migrated or damaged current decks. A legacy
 * draft therefore has no majorCharacters and no ability-era field on any entity.
 */
export function isLegacyWorldDeck(raw: unknown): boolean {
  if (!isLooseRecord(raw)) {
    return false;
  }

  return (
    !hasOwn(raw, "majorCharacters") &&
    lacksOwnFields(raw.playerGod, ["ref", "abilities"]) &&
    allRecordsLackFields(raw.majorGods, ["ref", "abilities"]) &&
    allRecordsLackFields(raw.factions, ["ref", "keyCharacterRefs"]) &&
    allRecordsLackFields(raw.races, ["ref", "abilities"])
  );
}

/**
 * Parses a persisted draft strictly unless its missing fields positively identify
 * it as pre-ability legacy data.
 */
export function parsePersistedWorldDeck(raw: unknown): WorldDeck | LegacyWorldDeck {
  return isLegacyWorldDeck(raw)
    ? normalizeLegacyWorldDeck(raw)
    : WorldDeckSchema.parse(raw);
}

/**
 * Migrates a persisted pre-ability draft into the compatibility card format.
 * It only supplies deterministic references and empty relationship/ability
 * collections; it never creates characters or abilities that were absent.
 */
export function normalizeLegacyWorldDeck(raw: unknown): LegacyWorldDeck {
  if (!isLegacyWorldDeck(raw)) {
    throw new Error("草稿不属于旧版兼容格式");
  }
  const deck = asLooseRecord(raw);
  const playerGod = asLooseRecord(deck.playerGod);
  const majorGods = Array.isArray(deck.majorGods) ? deck.majorGods : [];
  const factions = Array.isArray(deck.factions) ? deck.factions : [];
  const races = Array.isArray(deck.races) ? deck.races : [];
  const majorCharacters = Array.isArray(deck.majorCharacters) ? deck.majorCharacters : [];

  return LegacyWorldDeckSchema.parse({
    ...deck,
    playerGod: {
      ...playerGod,
      ...(hasOwn(playerGod, "ref") ? {} : { ref: "player-god-1" }),
      ...(hasOwn(playerGod, "abilities") ? { abilities: normalizeAbilities(playerGod.abilities, "player-god-1") } : { abilities: [] }),
    },
    majorGods: majorGods.map((rawGod, index) => {
      const god = asLooseRecord(rawGod);
      const prefix = `major-god-${index + 1}`;
      return {
        ...god,
        ...(hasOwn(god, "ref") ? {} : { ref: prefix }),
        ...(hasOwn(god, "abilities") ? { abilities: normalizeAbilities(god.abilities, prefix) } : { abilities: [] }),
      };
    }),
    factions: factions.map((rawFaction, index) => {
      const faction = asLooseRecord(rawFaction);
      return {
        ...faction,
        ...(hasOwn(faction, "ref") ? {} : { ref: `faction-${index + 1}` }),
        ...(hasOwn(faction, "keyCharacterRefs") ? {} : { keyCharacterRefs: [] }),
      };
    }),
    races: races.map((rawRace, index) => {
      const race = asLooseRecord(rawRace);
      const prefix = `race-${index + 1}`;
      return {
        ...race,
        ...(hasOwn(race, "ref") ? {} : { ref: prefix }),
        ...(hasOwn(race, "abilities") ? { abilities: normalizeAbilities(race.abilities, prefix) } : { abilities: [] }),
      };
    }),
    majorCharacters: majorCharacters.map((rawCharacter, index) => {
      const character = asLooseRecord(rawCharacter);
      const prefix = `major-character-${index + 1}`;
      return {
        ...character,
        ...(hasOwn(character, "ref") ? {} : { ref: prefix }),
        ...(hasOwn(character, "factionMemberships") ? {} : { factionMemberships: [] }),
        ...(hasOwn(character, "learnedTraditionRefs") ? {} : { learnedTraditionRefs: [] }),
        ...(hasOwn(character, "racialOverrides")
          ? { racialOverrides: normalizeRacialOverrides(character.racialOverrides, prefix) }
          : { racialOverrides: [] }),
        ...(hasOwn(character, "abilities")
          ? { abilities: normalizeAbilities(character.abilities, prefix) }
          : { abilities: [] }),
      };
    }),
  });
}

/** 卡片键（重掷粒度） */
export const DECK_CARD_KEYS = [
  "cosmology",
  "fusionAxiom",
  "playerGod",
  "majorGods",
  "minorGods",
  "factions",
  "races",
  "majorCharacters",
  "places",
  "epochConflict",
  "style",
  "theme",
] as const;
export type DeckCardKey = (typeof DECK_CARD_KEYS)[number];
