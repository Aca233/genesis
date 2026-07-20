import { describe, expect, it } from "vitest";
import { validateDeckReferences } from "@/lib/abilities/validator";
import {
  LegacyWorldDeckSchema,
  WorldDeckSchema,
  isLegacyWorldDeck,
  normalizeLegacyWorldDeck,
  parsePersistedWorldDeck,
} from "./schemas";

function ability(ref: string, kind: "racial_innate" | "racial_tradition" | "personal" | "divine") {
  return {
    ref,
    name: `${ref}之能`,
    kind,
    effect: "产生明确的叙事效果",
    trigger: "满足条件时发动",
    cost: "无",
    limitations: "不能跨越世界法则",
    mastery: "adept",
    state: "normal",
    visibility: "known",
    rumorText: null,
  };
}

function createCharacters() {
  return Array.from({ length: 6 }, (_, index) => ({
  ref: `character-${index + 1}`,
  name: `人物${index + 1}`,
  aliases: [],
  identity: "关键见证者",
  ageStage: "成年",
  raceRef: "race-human",
  factionMemberships: [
    { factionRef: "faction-court", role: "成员", isPrimary: true },
  ],
  personality: "谨慎而坚定",
  goals: "改变时代的裂隙",
  situation: "正处于抉择之前",
  divineTies: "受玩家神注视",
  conflictTies: "卷入当前纪元冲突",
  learnedTraditionRefs: [{ sourceAbilityRef: "ability-human-ritual" }],
  racialOverrides: [],
  abilities: Array.from({ length: 2 }, (_, abilityIndex) => ability(`ability-character-${index + 1}-${abilityIndex + 1}`, "personal")),
}));
}

function completeDeck() {
  const characters = createCharacters();
  return {
    worldName: "测试界",
    cosmology: {
      origin: "星海初燃",
      powerSystem: "誓约之力",
      laws: "万物受誓约约束",
      divinity: "神明以信仰与领域显现",
    },
    fusionAxiom: null,
    playerGod: {
      ref: "god-player",
      name: "初启之神",
      origin: "新生神明",
      domains: ["晨光"],
      rank: "nascent",
      faithBase: "晨钟城",
      situation: "信仰尚未稳固",
      abilities: Array.from({ length: 3 }, (_, index) => ability(`ability-player-${index + 1}`, "divine")),
    },
    majorGods: ["潮汐", "荒野", "灰烬", "律法"].map((name, index) => ({
      ref: `god-major-${index + 1}`,
      name: `${name}之神`,
      aliases: [],
      domains: [name],
      rank: "ascended",
      persona: "冷静而深邃",
      voice: { verbalTics: [], address: "凡人", catchphrases: [], neverSays: [] },
      agenda: {
        longTermGoal: "重塑秩序",
        shortTermGoals: ["试探新神"],
        methods: "神谕",
        stanceToPlayer: { level: "rivalry", motive: "争夺领域" },
        schemes: ["布置棋局"],
      },
      initialRelationToPlayer: { label: "rival", note: "领域相邻" },
      faithScope: "诸城邦",
      abilities: Array.from({ length: 3 }, (_, abilityIndex) => ability(`ability-major-${index + 1}-${abilityIndex + 1}`, "divine")),
    })),
    minorGods: [],
    factions: [
      {
        ref: "faction-court",
        name: "晨钟议会",
        aliases: [],
        kind: "城邦议会",
        overview: "守护晨钟城的议会",
        territory: "晨钟城",
        faith: "信仰初启之神",
        keyCharacterRefs: characters.slice(0, 2).map(({ ref }) => ({ ref })),
      },
      {
        ref: "faction-archive",
        name: "星图学会",
        aliases: [],
        kind: "学会",
        overview: "记录星海异象的学会",
        territory: "旧塔",
        faith: "中立而敬畏诸神",
        keyCharacterRefs: [{ ref: "character-3" }],
      },
    ],
    races: [
      {
        ref: "race-human",
        name: "人族",
        aliases: [],
        traits: "适应力强",
        lifespan: "百年",
        distribution: "遍布诸城",
        divineTies: "最早回应晨光",
        abilities: [
          ability("ability-human-sight", "racial_innate"),
          ability("ability-human-ritual", "racial_tradition"),
        ],
      },
    ],
    majorCharacters: characters,
    places: [
      { name: "晨钟城", aliases: [], kind: "城市", overview: "初启之城", allegiance: "晨钟议会" },
    ],
    epochConflict: {
      epochName: "裂光纪",
      yearLabel: "裂光元年",
      overtConflicts: ["诸神争夺信仰"],
      hiddenCurrents: ["旧神正在苏醒"],
    },
    style: { preset: "epic", presetName: "史诗", toneNotes: "庄严而有张力" },
    theme: {
      eraSystem: "裂光历",
      rankNames: {
        fallen: "陨神", ember: "余烬", slumbering: "沉眠", nascent: "初启",
        ascended: "显圣", exalted: "天尊", sovereign: "主宰",
      },
      typeNames: {
        faction: "势力", character: "人物", race: "种族", place: "地理", artifact: "圣器", cult: "教团",
      },
      addressStyle: "以尊号相称",
    },
  };
}

function completeLegacyDeck(): Record<string, unknown> {
  const legacy = completeDeck() as Record<string, unknown>;
  const playerGod = legacy.playerGod as Record<string, unknown>;
  delete playerGod.ref;
  delete playerGod.abilities;
  for (const god of legacy.majorGods as Record<string, unknown>[]) {
    delete god.ref;
    delete god.abilities;
  }
  for (const faction of legacy.factions as Record<string, unknown>[]) {
    delete faction.ref;
    delete faction.keyCharacterRefs;
  }
  for (const race of legacy.races as Record<string, unknown>[]) {
    delete race.ref;
    delete race.abilities;
  }
  delete legacy.majorCharacters;
  return legacy;
}

describe("WorldDeck 能力与主要人物引用", () => {
  it("接受包含嵌套稳定引用的完整卡组", () => {
    const deck = WorldDeckSchema.parse(completeDeck());
    expect(() => validateDeckReferences(deck)).not.toThrow();
  });

  it("拒绝人物引用不存在的族群技艺", () => {
    const rawDeck = completeDeck();
    rawDeck.majorCharacters[0]!.learnedTraditionRefs = [
      { sourceAbilityRef: "missing-tradition" },
    ];
    const deck = WorldDeckSchema.parse(rawDeck);
    expect(() => validateDeckReferences(deck)).toThrow(/能力来源引用 .*missing-tradition.* 不存在/);
  });

  it.each([
    ["玩家神", (deck: ReturnType<typeof completeDeck>) => { deck.playerGod.ref = "   "; }],
    ["主神", (deck: ReturnType<typeof completeDeck>) => { deck.majorGods[0]!.ref = deck.playerGod.ref; }],
    ["种族", (deck: ReturnType<typeof completeDeck>) => { deck.races[0]!.ref = deck.factions[0]!.ref; }],
    ["势力", (deck: ReturnType<typeof completeDeck>) => { deck.factions[0]!.ref = ""; }],
    ["主要人物", (deck: ReturnType<typeof completeDeck>) => { deck.majorCharacters[0]!.ref = deck.races[0]!.ref; }],
    ["能力", (deck: ReturnType<typeof completeDeck>) => { deck.playerGod.abilities[0]!.ref = deck.races[0]!.abilities[0]!.ref; }],
  ])("拒绝重复或空白的%s稳定 ref", (_label, mutate) => {
    const deck = completeDeck();
    mutate(deck);
    expect(WorldDeckSchema.safeParse(deck).success).toBe(false);
  });

  it("要求先天覆写携带完整的派生能力字段并参与能力 ref 去重", () => {
    const deck = completeDeck();
    const character = deck.majorCharacters[0] as unknown as {
      racialOverrides: Array<Record<string, unknown>>;
    };
    character.racialOverrides = [{
      ...ability("ability-character-override", "racial_innate"),
      sourceAbilityRef: "ability-human-sight",
      bloodlineJustification: null,
    }];
    expect(WorldDeckSchema.parse(deck).majorCharacters[0]!.racialOverrides[0]).toMatchObject({
      ref: "ability-character-override",
      kind: "racial_innate",
      sourceAbilityRef: "ability-human-sight",
      effect: "产生明确的叙事效果",
    });

    character.racialOverrides[0]!.ref = "ability-player-1";
    expect(WorldDeckSchema.safeParse(deck).success).toBe(false);

    const incomplete = completeDeck();
    (incomplete.majorCharacters[0] as unknown as { racialOverrides: unknown[] }).racialOverrides = [{
      ref: "ability-incomplete-override",
      sourceAbilityRef: "ability-human-sight",
    }];
    expect(WorldDeckSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each([
    ["主神神权", (deck: ReturnType<typeof completeDeck>) => { deck.majorGods[0]!.abilities[0]!.ref = deck.playerGod.abilities[0]!.ref; }],
    ["人物个人技能", (deck: ReturnType<typeof completeDeck>) => { deck.majorCharacters[0]!.abilities[0]!.ref = deck.races[0]!.abilities[0]!.ref; }],
  ])("拒绝与其他能力重复的%s ref", (_label, mutate) => {
    const deck = completeDeck();
    mutate(deck);
    expect(WorldDeckSchema.safeParse(deck).success).toBe(false);
  });

  it.each([
    ["种族能力", (deck: ReturnType<typeof completeDeck>) => { deck.races[0]!.abilities = deck.races[0]!.abilities.slice(0, 1); }],
    ["玩家神权", (deck: ReturnType<typeof completeDeck>) => { deck.playerGod.abilities = deck.playerGod.abilities.slice(0, 2); }],
    ["主神神权", (deck: ReturnType<typeof completeDeck>) => { deck.majorGods[0]!.abilities = deck.majorGods[0]!.abilities.slice(0, 2); }],
    ["主要人物", (deck: ReturnType<typeof completeDeck>) => { deck.majorCharacters = deck.majorCharacters.slice(0, 5); }],
    ["个人技能", (deck: ReturnType<typeof completeDeck>) => { deck.majorCharacters[0]!.abilities = deck.majorCharacters[0]!.abilities.slice(0, 1); }],
  ])("严格的新创世卡组拒绝不足数量的%s", (_label, mutate) => {
    const deck = completeDeck();
    mutate(deck);
    expect(WorldDeckSchema.safeParse(deck).success).toBe(false);
  });

  it("将旧草稿确定性归一化为可保存的新格式，不凭空生成角色或能力", () => {
    const legacy = completeLegacyDeck();

    expect(WorldDeckSchema.safeParse(legacy).success).toBe(false);
    expect(isLegacyWorldDeck(legacy)).toBe(true);
    const normalized = normalizeLegacyWorldDeck(legacy);
    expect(LegacyWorldDeckSchema.safeParse(normalized).success).toBe(true);
    expect(WorldDeckSchema.safeParse(normalized).success).toBe(false);
    expect(parsePersistedWorldDeck(legacy)).toEqual(normalized);
    expect(normalized.playerGod.ref).toBe("player-god-1");
    expect(normalized.majorGods.map((god) => god.ref)).toEqual([
      "major-god-1", "major-god-2", "major-god-3", "major-god-4",
    ]);
    expect(normalized.races[0]!.ref).toBe("race-1");
    expect(normalized.factions[0]!.ref).toBe("faction-1");
    expect(normalized.playerGod.abilities).toEqual([]);
    expect(normalized.majorGods.flatMap((god) => god.abilities)).toEqual([]);
    expect(normalized.races.flatMap((race) => race.abilities)).toEqual([]);
    expect(normalized.majorCharacters).toEqual([]);
    expect(normalized.factions.flatMap((faction) => faction.keyCharacterRefs)).toEqual([]);
    expect(normalizeLegacyWorldDeck(legacy)).toEqual(normalized);
    expect(() => validateDeckReferences(normalized)).not.toThrow();
  });

  it.each([
    ["当前卡组只缺少 playerGod.abilities", () => {
      const deck = completeDeck() as Record<string, unknown>;
      delete (deck.playerGod as Record<string, unknown>).abilities;
      return deck;
    }],
    ["旧草稿混入 playerGod.abilities", () => {
      const deck = completeLegacyDeck();
      (deck.playerGod as Record<string, unknown>).abilities = [];
      return deck;
    }],
    ["旧草稿混入 majorCharacters", () => {
      const deck = completeLegacyDeck();
      deck.majorCharacters = [];
      return deck;
    }],
  ])("不将%s误判为可归一化的旧草稿", (_label, createInvalidDeck) => {
    const invalidDeck = createInvalidDeck();

    expect(isLegacyWorldDeck(invalidDeck)).toBe(false);
    expect(() => parsePersistedWorldDeck(invalidDeck)).toThrow();
  });

});
