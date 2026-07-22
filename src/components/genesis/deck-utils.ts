import type { WorldDeck, MajorGodCard, CreatorMajorGodCard, DeckCardKey } from "@/lib/cards/schemas";
import { RANKS } from "@/lib/cards/schemas";

/** 卡片编辑器共用工具：路径读写、枚举中文映射、升格模板 */

export type Rank = (typeof RANKS)[number];

/** 位阶内部枚举 → 中文标签（编辑器用；游玩界面由主题卡措辞映射） */
export const RANK_LABELS: Record<Rank, string> = {
  fallen: "陨灭",
  ember: "余烬",
  slumbering: "沉睡",
  nascent: "微末",
  ascended: "成神",
  exalted: "显赫",
  sovereign: "主宰",
};

export const STANCE_LABELS: Record<string, string> = {
  hostility: "敌意",
  rivalry: "竞争",
  neutral: "中立",
  cooperation: "合作",
  dependence: "依附",
};

export const RELATION_LABELS: Record<string, string> = {
  enemy: "敌对",
  rival: "竞争",
  neutral: "中立",
  ally: "盟友",
  vassal: "隶属",
  unknown: "未知",
};

export const STYLE_PRESET_LABELS: Record<string, string> = {
  epic: "史诗",
  webnovel: "网文",
  grimdark: "黑暗低语",
  lightnovel: "轻小说",
  canon: "原著贴合",
};

/** 重掷组的中文名（提示文案用） */
export const CARD_KEY_LABELS: Record<DeckCardKey, string> = {
  cosmology: "宇宙论",
  fusionAxiom: "融合公理",
  playerGod: "玩家神",
  majorGods: "神谱主神",
  minorGods: "次要神",
  factions: "势力",
  races: "种族",
  majorCharacters: "主要人物",
  places: "地理",
  epochConflict: "纪元冲突",
  style: "叙事风格",
  theme: "主题措辞",
};

const SHARED_DECK_CARD_ORDER = [
  "cosmology",
  "majorGods",
  "minorGods",
  "factions",
  "races",
  "majorCharacters",
  "places",
  "epochConflict",
  "style",
  "theme",
] as const satisfies readonly DeckCardKey[];

/** Card-wall order follows the real mode shape; Creator never receives a player-god section. */
export function deckCardOrder(deck: WorldDeck): DeckCardKey[] {
  const order: DeckCardKey[] = ["cosmology"];
  if (deck.fusionAxiom) order.push("fusionAxiom");
  if (deck.mode === "pantheon") order.push("playerGod");
  order.push(...SHARED_DECK_CARD_ORDER.slice(1));
  return order;
}

/** 按点分路径读值（"majorGods.2.persona"） */
export function getPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

/** 按点分路径写值——沿路径浅拷贝，返回新对象（不改动原值） */
export function setPathClone<T>(root: T, path: string, value: unknown): T {
  const keys = path.split(".");
  function rec(node: unknown, i: number): unknown {
    if (i === keys.length) return value;
    const key = keys[i];
    if (Array.isArray(node)) {
      const copy = node.slice();
      copy[Number(key)] = rec(node[Number(key)], i + 1);
      return copy;
    }
    const obj = (node && typeof node === "object" ? node : {}) as Record<
      string,
      unknown
    >;
    return { ...obj, [key]: rec(obj[key], i + 1) };
  }
  return rec(root, 0) as T;
}

/** 某路径（或其祖先）是否已被玩家手改上锁 */
export function isPathLocked(lockedPaths: string[], path: string): boolean {
  return lockedPaths.some((p) => p === path || path.startsWith(`${p}.`));
}

/** 某基路径下锁定字段计数（卡片墙角标用） */
export function countLockedUnder(lockedPaths: string[], base: string): number {
  return lockedPaths.filter((p) => p === base || p.startsWith(`${base}.`))
    .length;
}

type RaceAbilityDeck = {
  races: Array<{
    ref: string;
    abilities: Array<{ ref: string; kind: string }>;
  }>;
};

type CharacterTraditionRefs = {
  raceRef: string;
  learnedTraditionRefs: Array<{ sourceAbilityRef: string }>;
  racialOverrides?: Array<{
    ref: string;
    sourceAbilityRef: string;
    bloodlineJustification?: string | null;
  }>;
};

type AbilityRefDeck = {
  playerGod?: { abilities: Array<{ ref: string }> };
  majorGods: Array<{ abilities: Array<{ ref: string }> }>;
  races: Array<{ abilities: Array<{ ref: string }> }>;
  majorCharacters: Array<{
    abilities: Array<{ ref: string }>;
    racialOverrides: Array<{ ref: string }>;
  }>;
};

/** 封印中的隐藏能力不能在未破封时改为公开可见。 */
export function canEditAbilityVisibility(
  visibility: string,
  sensitiveFieldsRevealed: boolean,
): boolean {
  return visibility !== "hidden" || sensitiveFieldsRevealed;
}

/** 严格卡组数量下限：到达下限后不能再删除。 */
export function canRemoveAbility(length: number, minItems: number): boolean {
  return length > minItems;
}

/** 严格卡组数量上限与来源约束：不满足任一条件时不能新增。 */
export function canAddAbility(
  length: number,
  maxItems: number,
  sourceAvailable = true,
): boolean {
  return length < maxItems && sourceAvailable;
}

/** 返回某个种族可供人物学习的族群技艺稳定引用。 */
export function traditionAbilityRefsForRace(
  deck: RaceAbilityDeck,
  raceRef: string,
): string[] {
  return deck.races
    .find((race) => race.ref === raceRef)
    ?.abilities.filter((ability) => ability.kind === "racial_tradition")
    .map((ability) => ability.ref) ?? [];
}

/** 取得任一可引用的先天模板；没有时显式返回 undefined，绝不生成空 ref。 */
export function firstRacialInnateAbilityRef(
  deck: RaceAbilityDeck,
  raceRef: string,
): string | undefined {
  return racialInnateAbilityRefsForRace(deck, raceRef)[0];
}

/** 当前种族可引用的先天模板。 */
export function racialInnateAbilityRefsForRace(
  deck: RaceAbilityDeck,
  raceRef: string,
): string[] {
  return deck.races
    .find((race) => race.ref === raceRef)
    ?.abilities
    .filter((ability) => ability.kind === "racial_innate")
    .map((ability) => ability.ref) ?? [];
}

/** 排除其他覆写已经占用的当前种族先天模板。 */
export function availableRacialInnateAbilityRefs(
  deck: RaceAbilityDeck,
  raceRef: string,
  usedSourceAbilityRefs: readonly string[],
): string[] {
  const used = new Set(usedSourceAbilityRefs);
  return racialInnateAbilityRefsForRace(deck, raceRef).filter((ref) => !used.has(ref));
}

/**
 * 既有且合法的跨种族覆写可保留其原始来源；新建项仍只能从当前种族可用模板中选取。
 */
export function selectableRacialOverrideSourceRefs(
  deck: RaceAbilityDeck,
  raceRef: string,
  usedOtherSourceAbilityRefs: readonly string[],
  currentOverride: { sourceAbilityRef: string; bloodlineJustification?: string | null },
): string[] {
  const currentRaceOptions = availableRacialInnateAbilityRefs(
    deck,
    raceRef,
    usedOtherSourceAbilityRefs,
  );
  const sourceRace = deck.races.find((race) =>
    race.abilities.some(
      (ability) =>
        ability.ref === currentOverride.sourceAbilityRef &&
        ability.kind === "racial_innate",
    ),
  );
  const preserveCrossRaceSource =
    sourceRace !== undefined &&
    sourceRace.ref !== raceRef &&
    Boolean(currentOverride.bloodlineJustification?.trim());

  return preserveCrossRaceSource
    ? [...currentRaceOptions, currentOverride.sourceAbilityRef]
    : currentRaceOptions;
}

/** 在封印状态过滤隐藏能力，避免暴露其名称、种类与位置。 */
export function visibleAbilityIndexes(
  abilities: ReadonlyArray<{ kind: string; visibility: string }>,
  allowedKinds: readonly string[],
  hideSealedHidden: boolean,
  sensitiveFieldsRevealed: boolean,
): number[] {
  return abilities.flatMap((ability, index) =>
    allowedKinds.includes(ability.kind) &&
    (!hideSealedHidden || sensitiveFieldsRevealed || ability.visibility !== "hidden")
      ? [index]
      : [],
  );
}

/** 收集卡组内所有能力和先天覆写 ref，供新增项避免全局冲突。 */
export function abilityRefsInDeck(deck: AbilityRefDeck): string[] {
  return [
    ...(deck.playerGod?.abilities ?? []),
    ...deck.majorGods.flatMap((god) => god.abilities),
    ...deck.races.flatMap((race) => race.abilities),
    ...deck.majorCharacters.flatMap((character) => [
      ...character.abilities,
      ...character.racialOverrides,
    ]),
  ].map((ability) => ability.ref);
}

/** 在全卡组已用 ref 中寻找当前能力区的下一个安全 ref。 */
export function nextAvailableAbilityRef(
  basePath: string,
  usedRefs: readonly string[],
): string {
  const prefix = `${basePath.replaceAll(".", "-")}-ability`;
  const existing = new Set(usedRefs);
  let serial = 1;
  while (existing.has(`${prefix}-${serial}`)) serial += 1;
  return `${prefix}-${serial}`;
}

/**
 * 切换人物主种族，并同步移除不再属于新种族的族群技艺引用。
 * UI 用 removedTraditionRefs 决定是否向玩家展示清理提示。
 */
export function changeCharacterRace<T extends CharacterTraditionRefs>(
  character: T,
  raceRef: string,
  deck: RaceAbilityDeck,
): {
  character: T;
  removedTraditionRefs: string[];
  removedOverrideRefs: string[];
} {
  const allowedRefs = new Set(traditionAbilityRefsForRace(deck, raceRef));
  const learnedTraditionRefs = character.learnedTraditionRefs.filter((reference) =>
    allowedRefs.has(reference.sourceAbilityRef),
  );
  const removedTraditionRefs = character.learnedTraditionRefs
    .filter((reference) => !allowedRefs.has(reference.sourceAbilityRef))
    .map((reference) => reference.sourceAbilityRef);
  const sourceRaceByRef = new Map(
    deck.races.flatMap((race) =>
      race.abilities.map((ability) => [ability.ref, race.ref] as const),
    ),
  );
  const racialOverrides = character.racialOverrides?.filter((override) =>
    sourceRaceByRef.get(override.sourceAbilityRef) === raceRef ||
    Boolean(override.bloodlineJustification?.trim()),
  );
  const removedOverrideRefs = character.racialOverrides
    ?.filter((override) => !racialOverrides?.includes(override))
    .map((override) => override.ref) ?? [];

  return {
    character: {
      ...character,
      raceRef,
      learnedTraditionRefs,
      ...(racialOverrides === undefined ? {} : { racialOverrides }),
    } as T,
    removedTraditionRefs,
    removedOverrideRefs,
  };
}

const PLACEHOLDER = "（待补：可用重掷或手改完善）";

/** 次要神升格为主神——占位模板确保过 WorldDeckSchema 校验 */
export function promoteMinorGod(
  minor: WorldDeck["minorGods"][number],
  mode: "pantheon",
): MajorGodCard;
export function promoteMinorGod(
  minor: WorldDeck["minorGods"][number],
  mode: "creator",
  relationTargetRef?: string,
): CreatorMajorGodCard;
export function promoteMinorGod(
  minor: WorldDeck["minorGods"][number],
  mode: WorldDeck["mode"] = "pantheon",
  relationTargetRef?: string,
): MajorGodCard | CreatorMajorGodCard {
  const ref = `god-${minor.name}`;
  const shared = {
    ref,
    name: minor.name,
    aliases: [],
    domains: [PLACEHOLDER],
    rank: "nascent" as const,
    persona: minor.brief || PLACEHOLDER,
    voice: {
      verbalTics: [],
      address: PLACEHOLDER,
      catchphrases: [],
      neverSays: [],
    },
    faithScope: PLACEHOLDER,
    abilities: Array.from({ length: 3 }, (_, index) => ({
      ref: `${ref}-ability-${index + 1}`,
      name: `神权${index + 1}`,
      kind: "divine" as const,
      effect: PLACEHOLDER,
      trigger: PLACEHOLDER,
      cost: "无",
      limitations: PLACEHOLDER,
      mastery: "novice" as const,
      state: "normal" as const,
      visibility: "known" as const,
      rumorText: null,
      lockedFields: [],
    })),
  };
  if (mode === "pantheon") {
    return {
      ...shared,
      agenda: {
        longTermGoal: PLACEHOLDER,
        shortTermGoals: [],
        methods: PLACEHOLDER,
        stanceToPlayer: { level: "neutral", motive: PLACEHOLDER },
        schemes: [],
      },
      initialRelationToPlayer: { label: "unknown", note: PLACEHOLDER },
    };
  }
  return {
    ...shared,
    agenda: {
      longTermGoal: PLACEHOLDER,
      shortTermGoals: [],
      methods: PLACEHOLDER,
      schemes: [],
    },
    relations: relationTargetRef
      ? [{ targetGodRef: relationTargetRef, label: "unknown", note: PLACEHOLDER }]
      : [],
  };
}

/** 截取摘要行 */
export function clip(text: string, max = 56): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
