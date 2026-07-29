import { describe, expect, expectTypeOf, it } from "vitest";
import { validateDeckReferences } from "@/lib/abilities/validator";
import {
  CreatorWorldDeckSchema,
  DECK_CARD_KEYS,
  LegacyWorldDeckSchema,
  TemporalAnchorCardSchema,
  WorldDeckSchema,
  isLegacyWorldDeck,
  normalizeLegacyWorldDeck,
  parsePersistedWorldDeck,
  type CreatorMajorGodCard,
  type CreatorWorldDeck,
  type WorldDeck,
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
    mode: "pantheon" as const,
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
      { ref: "place-city", name: "晨钟城", aliases: [], kind: "城市", overview: "初启之城", allegiance: "晨钟议会" },
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


function completeCreatorDeck() {
  const { playerGod: _playerGod, ...shared } = completeDeck();
  void _playerGod;
  return {
    ...shared,
    mode: "creator" as const,
    majorGods: shared.majorGods.map(({ agenda, initialRelationToPlayer: _relation, ...god }, index, gods) => {
      void _relation;
      return {
        ...god,
        agenda: {
          longTermGoal: agenda.longTermGoal,
          shortTermGoals: agenda.shortTermGoals,
          methods: agenda.methods,
          schemes: agenda.schemes,
        },
        relations: [{
          targetGodRef: gods[(index + 1) % gods.length]!.ref,
          label: "rival" as const,
          note: "世界内神明之间的竞争",
        }],
      };
    }),
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

describe("WorldDeck 模式判别联合", () => {
  it("导出类型与严格 creator 运行时契约一致", () => {
    type CreatorBranch = Extract<WorldDeck, { mode: "creator" }>;

    expectTypeOf<CreatorBranch>().toEqualTypeOf<CreatorWorldDeck>();
    expectTypeOf<CreatorBranch["majorGods"][number]>().toEqualTypeOf<CreatorMajorGodCard>();
  });

  it("要求 pantheon 显式声明 mode 并包含 playerGod", () => {
    const pantheon = WorldDeckSchema.parse(completeDeck());
    expect(pantheon.mode).toBe("pantheon");
    expect(pantheon.mode === "pantheon" && pantheon.playerGod.name).toBeTruthy();

    const { mode: _mode, ...withoutMode } = completeDeck();
    void _mode;
    expect(WorldDeckSchema.safeParse(withoutMode).success).toBe(false);
  });

  it("接受不含玩家神且只描述世界内关系的 creator 卡组", () => {
    const creator = CreatorWorldDeckSchema.parse(completeCreatorDeck());
    expect(creator.mode).toBe("creator");
    expect("playerGod" in creator).toBe(false);
    expect("stanceToPlayer" in creator.majorGods[0]!.agenda).toBe(false);
    if (creator.mode !== "creator") throw new Error("预期 creator 卡组");
    expect(creator.majorGods[0]!.relations[0]?.targetGodRef).toBe("god-major-2");
  });

  it("严格拒绝 creator 卡组附带 playerGod 或玩家关系字段", () => {
    const creator = completeCreatorDeck();
    expect(WorldDeckSchema.safeParse({ ...creator, playerGod: completeDeck().playerGod }).success).toBe(false);
    expect(WorldDeckSchema.safeParse({
      ...creator,
      majorGods: creator.majorGods.map((god, index) => index === 0
        ? { ...god, initialRelationToPlayer: { label: "rival", note: "不应存在" } }
        : god),
    }).success).toBe(false);
    expect(WorldDeckSchema.safeParse({
      ...creator,
      majorGods: creator.majorGods.map((god, index) => index === 0
        ? { ...god, agenda: { ...god.agenda, stanceToPlayer: { level: "rivalry", motive: "不应存在" } } }
        : god),
    }).success).toBe(false);
  });

  it("将无 mode 的已持久化当前卡组归一化为 pantheon", () => {
    const { mode: _mode, ...persisted } = completeDeck();
    void _mode;
    expect(parsePersistedWorldDeck(persisted).mode).toBe("pantheon");
  });
});

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
    ["主要人物", (deck: ReturnType<typeof completeDeck>) => { deck.majorCharacters = deck.majorCharacters.slice(0, 3); }],
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
    expect(normalized.mode).toBe("pantheon");
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

function canonEventsFixture() {
  return [
    {
      ref: "canon-event-1",
      title: "旧神苏醒的前兆",
      timeLabel: "三年后的血月",
      ordinal: 1,
      epoch: "future",
      summary: "旧神在裂隙深处半睁开眼",
      participantRefs: ["god-major-1", "place-city"],
      prerequisites: [
        { kind: "entity_status", entityRef: "faction-court", requiredStatus: ["动摇"] },
      ],
      blockers: [],
      expectedConsequences: [
        { kind: "status_change", targetRef: "faction-court", toStatus: "分裂" },
      ],
      status: "pending",
      visibility: "author_only",
    },
    {
      ref: "canon-event-2",
      title: "晨钟异响",
      timeLabel: "血月之后",
      ordinal: 2,
      epoch: "future",
      summary: "晨钟城的钟声开始逆响",
      participantRefs: ["character-1"],
      prerequisites: [
        { kind: "prior_event_occurred", canonEventRef: "canon-event-1" },
      ],
      status: "pending",
      visibility: "author_only",
    },
    {
      ref: "canon-event-3",
      title: "星图残缺",
      timeLabel: "数年之后",
      ordinal: 5,
      epoch: "future",
      summary: "星图学会发现天穹缺了一角",
      participantRefs: ["faction-archive"],
      prerequisites: [
        {
          kind: "relation_status",
          sourceRef: "faction-archive",
          targetRef: "god-major-2",
          requiredStatus: ["决裂"],
        },
        { kind: "ordinal_window", notBeforeOrdinal: 2 },
      ],
      blockers: [
        { kind: "custom", description: "若旧神重新沉睡则此事不临" },
      ],
      expectedConsequences: [
        {
          kind: "relation_change",
          sourceRef: "faction-archive",
          targetRef: "faction-court",
          toStatus: "同盟",
        },
      ],
      status: "pending",
      visibility: "author_only",
    },
  ] as Array<Record<string, unknown>>;
}

describe("将临之事（canonEvents）", () => {
  const deckWith = (events: Array<Record<string, unknown>>) => ({
    ...completeDeck(),
    canonEvents: events,
  });
  const issueAt = (result: ReturnType<typeof WorldDeckSchema.safeParse>, path: string) => {
    if (result.success) throw new Error("预期解析失败");
    return result.error.issues.some((issue) => issue.path.join(".") === path);
  };

  it("不携带 canonEvents 的卡组照常解析（兼容旧卡组与既有草稿）", () => {
    const parsed = WorldDeckSchema.parse(completeDeck());
    expect(parsed.canonEvents).toBeUndefined();
  });

  it("解析合法 canonEvents 并补齐 blockers/expectedConsequences 默认值", () => {
    const parsed = WorldDeckSchema.parse(deckWith(canonEventsFixture()));
    expect(parsed.canonEvents).toHaveLength(3);
    expect(parsed.canonEvents![1]).toMatchObject({
      ref: "canon-event-2",
      blockers: [],
      expectedConsequences: [],
      status: "pending",
      visibility: "author_only",
    });
  });

  it("拒绝重复或非递增的 ordinal 并定位到 canonEvents[i].ordinal", () => {
    const duplicated = canonEventsFixture();
    duplicated[1]!.ordinal = 1;
    expect(issueAt(WorldDeckSchema.safeParse(deckWith(duplicated)), "canonEvents.1.ordinal")).toBe(true);

    const descending = canonEventsFixture();
    descending[2]!.ordinal = 1;
    expect(issueAt(WorldDeckSchema.safeParse(deckWith(descending)), "canonEvents.2.ordinal")).toBe(true);
  });

  it("拒绝未解析到任何卡组 ref 的 participantRef 与条件引用", () => {
    const participants = canonEventsFixture();
    participants[0]!.participantRefs = ["missing-card"];
    expect(issueAt(
      WorldDeckSchema.safeParse(deckWith(participants)),
      "canonEvents.0.participantRefs.0",
    )).toBe(true);

    const conditions = canonEventsFixture();
    conditions[0]!.prerequisites = [
      { kind: "entity_status", entityRef: "missing-entity", requiredStatus: ["动摇"] },
    ];
    expect(issueAt(
      WorldDeckSchema.safeParse(deckWith(conditions)),
      "canonEvents.0.prerequisites.0.entityRef",
    )).toBe(true);
  });

  it("拒绝 prior_event_occurred 引用更晚或自身的事件", () => {
    const forward = canonEventsFixture();
    forward[0]!.prerequisites = [
      { kind: "prior_event_occurred", canonEventRef: "canon-event-3" },
    ];
    expect(issueAt(
      WorldDeckSchema.safeParse(deckWith(forward)),
      "canonEvents.0.prerequisites.0.canonEventRef",
    )).toBe(true);

    const self = canonEventsFixture();
    self[1]!.prerequisites = [
      { kind: "prior_event_occurred", canonEventRef: "canon-event-2" },
    ];
    expect(issueAt(
      WorldDeckSchema.safeParse(deckWith(self)),
      "canonEvents.1.prerequisites.0.canonEventRef",
    )).toBe(true);
  });

  it("canonEvent ref 与卡 ref 共用命名空间：与主神撞 ref 被拒", () => {
    const events = canonEventsFixture();
    events[0]!.ref = "god-major-1";
    expect(issueAt(WorldDeckSchema.safeParse(deckWith(events)), "canonEvents.0.ref")).toBe(true);
  });

  it("键存在时少于 3 个或多于 5 个事件都被拒", () => {
    const events = canonEventsFixture();
    expect(WorldDeckSchema.safeParse(deckWith(events.slice(0, 2))).success).toBe(false);

    const six = [
      ...canonEventsFixture(),
      ...canonEventsFixture().map((event, index) => ({
        ...event,
        ref: `canon-extra-${index + 1}`,
        ordinal: 10 + index,
        prerequisites: [{ kind: "custom", description: "备用条件" }],
      })),
    ];
    expect(WorldDeckSchema.safeParse(deckWith(six)).success).toBe(false);
  });
});

function ipTemporalAnchorCard() {
  return {
    source: {
      basis: "single_ip" as const,
      sourceIps: ["测试原作"],
      continuity: "原著小说线",
      continuitySource: "model_inferred" as const,
      ambiguityNotes: [],
    },
    anchor: {
      anchorType: "main_story_opening" as const,
      currentTimeLabel: "裂光元年冬",
      currentEraLabel: "裂光纪",
      anchorEvent: "主线开幕前夜，晨钟尚未鸣响",
      canonCutoff: "原著第一卷开幕之前" as string | null,
      selectionSource: "model_inferred" as const,
      confidence: "high" as const,
      assumptions: ["神谕未指定时期，默认主线前夕"],
    },
    anchorOrdinal: 0,
  };
}

function originalTemporalAnchorCard() {
  return {
    source: { basis: "original" as const, ambiguityNotes: [] },
    anchor: {
      ...ipTemporalAnchorCard().anchor,
      anchorType: "original_present" as const,
      canonCutoff: null as string | null,
      selectionSource: "player_explicit" as const,
      assumptions: [],
    },
    anchorOrdinal: 0,
  };
}

describe("时间锚点（temporalAnchor）与锚点状态", () => {
  const issueAt = (result: ReturnType<typeof WorldDeckSchema.safeParse>, path: string) => {
    if (result.success) throw new Error("预期解析失败");
    return result.error.issues.some((issue) => issue.path.join(".") === path);
  };

  it("不携带 temporalAnchor 的旧卡组照常解析且不注入该键", () => {
    const parsed = WorldDeckSchema.parse(completeDeck());
    expect(parsed.temporalAnchor).toBeUndefined();
    expect(Object.keys(parsed)).not.toContain("temporalAnchor");
  });

  it("旧卡组解析不注入锚点状态与能力时序字段（缺省即 active 等价，字节不变）", () => {
    const parsed = WorldDeckSchema.parse(completeDeck());
    if (parsed.mode !== "pantheon") throw new Error("预期 pantheon 卡组");
    for (const card of [
      parsed.majorCharacters[0]!,
      parsed.majorGods[0]!,
      parsed.playerGod,
      parsed.factions[0]!,
      parsed.races[0]!,
      parsed.places[0]!,
    ]) {
      expect(Object.keys(card)).not.toContain("statusAtAnchor");
      expect(Object.keys(card)).not.toContain("anchorNote");
    }
    expect(Object.keys(parsed.playerGod.abilities[0]!)).not.toContain("timing");
    expect(Object.keys(parsed.majorCharacters[0]!.abilities[0]!)).not.toContain("timing");
  });

  it("解析携带 IP 锚点卡与原创锚点卡的卡组", () => {
    const ip = WorldDeckSchema.parse({ ...completeDeck(), temporalAnchor: ipTemporalAnchorCard() });
    expect(ip.temporalAnchor).toMatchObject({
      anchorOrdinal: 0,
      source: { basis: "single_ip", sourceIps: ["测试原作"] },
      anchor: { anchorType: "main_story_opening", canonCutoff: "原著第一卷开幕之前" },
    });

    const original = WorldDeckSchema.parse({
      ...completeDeck(),
      temporalAnchor: originalTemporalAnchorCard(),
    });
    expect(original.temporalAnchor?.source.basis).toBe("original");
    expect(original.temporalAnchor?.anchor.canonCutoff).toBeNull();
  });

  it("IP 世界缺 canonCutoff 与原创世界带 canonCutoff 都被拒", () => {
    const missingCutoff = ipTemporalAnchorCard();
    missingCutoff.anchor.canonCutoff = null;
    expect(issueAt(
      WorldDeckSchema.safeParse({ ...completeDeck(), temporalAnchor: missingCutoff }),
      "temporalAnchor.anchor.canonCutoff",
    )).toBe(true);

    const extraCutoff = originalTemporalAnchorCard();
    extraCutoff.anchor.canonCutoff = "不应存在的截止点";
    expect(issueAt(
      WorldDeckSchema.safeParse({ ...completeDeck(), temporalAnchor: extraCutoff }),
      "temporalAnchor.anchor.canonCutoff",
    )).toBe(true);

    expect(TemporalAnchorCardSchema.safeParse(ipTemporalAnchorCard()).success).toBe(true);
    expect(TemporalAnchorCardSchema.safeParse(missingCutoff).success).toBe(false);
  });

  it("拒绝各实体的越界 statusAtAnchor 与能力 timing 值", () => {
    const badCharacter = completeDeck() as unknown as {
      majorCharacters: Array<Record<string, unknown>>;
    };
    badCharacter.majorCharacters[0]!.statusAtAnchor = "retired";
    expect(WorldDeckSchema.safeParse(badCharacter).success).toBe(false);

    const badPlace = completeDeck() as unknown as { places: Array<Record<string, unknown>> };
    badPlace.places[0]!.statusAtAnchor = "active";
    expect(WorldDeckSchema.safeParse(badPlace).success).toBe(false);

    const badTiming = completeDeck() as unknown as {
      playerGod: { abilities: Array<Record<string, unknown>> };
    };
    badTiming.playerGod.abilities[0]!.timing = "someday";
    expect(WorldDeckSchema.safeParse(badTiming).success).toBe(false);
  });

  it("接受非 active 状态与 future/lost 时序的显式标注", () => {
    const raw = completeDeck() as unknown as {
      majorCharacters: Array<Record<string, unknown>>;
    };
    raw.majorCharacters[1]!.statusAtAnchor = "dead";
    raw.majorCharacters[1]!.anchorNote = "三年前战死于北境";
    (raw.majorCharacters[1]!.abilities as Array<Record<string, unknown>>)[0]!.timing = "future";
    const parsed = WorldDeckSchema.parse(raw);
    expect(parsed.majorCharacters[1]).toMatchObject({
      statusAtAnchor: "dead",
      anchorNote: "三年前战死于北境",
    });
    expect(parsed.majorCharacters[1]!.abilities[0]!.timing).toBe("future");
  });

  it("携带锚点卡时将临之事 ordinal 必须大于 anchorOrdinal", () => {
    const anchored = {
      ...completeDeck(),
      temporalAnchor: { ...ipTemporalAnchorCard(), anchorOrdinal: 2 },
      canonEvents: canonEventsFixture(),
    };
    const result = WorldDeckSchema.safeParse(anchored);
    expect(issueAt(result, "canonEvents.0.ordinal")).toBe(true);
    expect(issueAt(result, "canonEvents.1.ordinal")).toBe(true);
    if (result.success) throw new Error("预期解析失败");
    expect(result.error.issues.some((issue) => issue.path.join(".") === "canonEvents.2.ordinal")).toBe(false);

    expect(WorldDeckSchema.safeParse({
      ...completeDeck(),
      temporalAnchor: ipTemporalAnchorCard(),
      canonEvents: canonEventsFixture(),
    }).success).toBe(true);
  });

  it("majorCharacters 下限降为 4（小体量原作准确性优先）", () => {
    const four = completeDeck();
    four.majorCharacters = four.majorCharacters.slice(0, 4);
    four.factions[1]!.keyCharacterRefs = [{ ref: "character-1" }];
    expect(WorldDeckSchema.safeParse(four).success).toBe(true);
  });

  it("temporalAnchor 进入重掷粒度键（编辑器 UI 键暂缓）", () => {
    expect(DECK_CARD_KEYS).toContain("temporalAnchor");
  });
});

describe("首章启动约束", () => {
  it("接受结构化 openingChapterBrief 并校验视角人物 ref", () => {
    const valid = WorldDeckSchema.safeParse({
      ...completeDeck(),
      openingChapterBrief: {
        objective: "让见证者确认星海异象的来源",
        viewpointCharacterRef: "character-1",
        openingConstraint: "从一次失败的观测开始",
        endingConstraint: "只推进一个因果节点",
        readerKnows: ["诸神正在争夺信仰"],
        viewpointKnows: ["旧塔昨夜出现异光"],
        mustHide: ["旧神正在苏醒"],
        hintOnly: ["异光与旧神有关"],
        forbiddenDevelopments: ["旧神在首章完全苏醒"],
      },
    });
    expect(valid.success).toBe(true);

    const dangling = completeDeck() as ReturnType<typeof completeDeck> & {
      openingChapterBrief: Record<string, unknown>;
    };
    dangling.openingChapterBrief = {
      objective: "制造悬空视角",
      viewpointCharacterRef: "character-missing",
      openingConstraint: "从行动开始",
      endingConstraint: "留下选择",
      readerKnows: [],
      viewpointKnows: [],
      mustHide: [],
      hintOnly: [],
      forbiddenDevelopments: [],
    };
    const result = WorldDeckSchema.safeParse(dangling);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) =>
        issue.path.join(".") === "openingChapterBrief.viewpointCharacterRef"
      )).toBe(true);
    }
  });
});

function characterStateAtAnchorFixture() {
  return {
    identity: "晨钟议会的年轻执政官",
    locationRef: "place-city" as string | null,
    factionMemberships: [
      { factionRef: "faction-court", role: "执政官", status: "active" as const },
    ],
    currentGoals: ["稳住议会", "查明旧神苏醒的传闻"],
    currentSituation: "正处于抉择之前",
    knowledgeHints: ["知道星图学会藏有禁忌记录"],
  };
}

type StageTwoRawDeck = Record<string, unknown> & {
  majorCharacters: Array<Record<string, unknown>>;
  majorGods: Array<Record<string, unknown>>;
  playerGod: Record<string, unknown>;
  factions: Array<Record<string, unknown>>;
  races: Array<Record<string, unknown>>;
  places: Array<Record<string, unknown>>;
};

describe("阶段 2 锚点快照、锚点关系与卡级溯源", () => {
  const issueAt = (result: ReturnType<typeof WorldDeckSchema.safeParse>, path: string) => {
    if (result.success) throw new Error("预期解析失败");
    return result.error.issues.some((issue) => issue.path.join(".") === path);
  };
  const stageTwoRaw = (): StageTwoRawDeck => {
    const raw = completeDeck() as unknown as StageTwoRawDeck;
    raw.temporalAnchor = ipTemporalAnchorCard();
    return raw;
  };
  const relationFixture = (overrides: Record<string, unknown> = {}) => ({
    sourceRef: "character-1",
    targetRef: "character-2",
    status: "ally",
    publicDescription: "议会中的同僚与盟友",
    ...overrides,
  });

  it("旧卡组解析不注入 stateAtAnchor/provenance/relationsAtAnchor（字节不变）", () => {
    const parsed = WorldDeckSchema.parse(completeDeck());
    expect(Object.keys(parsed)).not.toContain("relationsAtAnchor");
    if (parsed.mode !== "pantheon") throw new Error("预期 pantheon 卡组");
    for (const card of [
      parsed.majorCharacters[0]!,
      parsed.majorGods[0]!,
      parsed.playerGod,
      parsed.factions[0]!,
      parsed.races[0]!,
      parsed.places[0]!,
    ]) {
      expect(Object.keys(card)).not.toContain("stateAtAnchor");
      expect(Object.keys(card)).not.toContain("provenance");
    }
  });

  it("解析携带瘦快照、锚点关系与卡级溯源的完整阶段 2 卡组", () => {
    const raw = stageTwoRaw();
    raw.majorCharacters[0]!.stateAtAnchor = characterStateAtAnchorFixture();
    raw.majorCharacters[0]!.provenance = { canonRelation: "canon", evidence: ["原著第一卷登场"] };
    raw.majorGods[0]!.stateAtAnchor = { currentRank: "ascended", currentDomains: ["潮汐"] };
    raw.majorGods[0]!.provenance = { canonRelation: "canon_inferred" };
    raw.playerGod.stateAtAnchor = { currentRank: "nascent" };
    raw.factions[0]!.stateAtAnchor = {
      leaderRefs: ["character-1"],
      territoryRefs: ["place-city"],
      currentStrength: "尚能维持城内秩序",
    };
    raw.factions[0]!.provenance = { canonRelation: "generated_original" };
    raw.races[0]!.provenance = { canonRelation: "canon" };
    raw.places[0]!.provenance = { canonRelation: "player_override", evidence: ["神谕改写"] };
    raw.relationsAtAnchor = [
      relationFixture(),
      relationFixture({
        targetRef: "god-major-1",
        status: "unknown",
        publicDescription: "对潮汐之神心存敬畏",
        hiddenDescription: "私下研习潮汐禁仪",
      }),
    ];

    const parsed = WorldDeckSchema.parse(raw);
    if (parsed.mode !== "pantheon") throw new Error("预期 pantheon 卡组");
    expect(parsed.majorCharacters[0]!.stateAtAnchor).toMatchObject({
      identity: "晨钟议会的年轻执政官",
      locationRef: "place-city",
      factionMemberships: [{ factionRef: "faction-court", status: "active" }],
      currentGoals: ["稳住议会", "查明旧神苏醒的传闻"],
    });
    expect(parsed.majorGods[0]!.provenance?.canonRelation).toBe("canon_inferred");
    expect(parsed.playerGod.stateAtAnchor?.currentRank).toBe("nascent");
    expect(parsed.factions[0]!.stateAtAnchor?.leaderRefs).toEqual(["character-1"]);
    expect(parsed.relationsAtAnchor).toHaveLength(2);
    expect(parsed.relationsAtAnchor![1]).toMatchObject({
      targetRef: "god-major-1",
      hiddenDescription: "私下研习潮汐禁仪",
    });
  });

  it.each([
    ["人物快照目标超过 3 条", (raw: StageTwoRawDeck) => {
      raw.majorCharacters[0]!.stateAtAnchor = {
        ...characterStateAtAnchorFixture(),
        currentGoals: ["一", "二", "三", "四"],
      };
    }],
    ["人物快照已知提示超过 3 条", (raw: StageTwoRawDeck) => {
      raw.majorCharacters[0]!.stateAtAnchor = {
        ...characterStateAtAnchorFixture(),
        knowledgeHints: ["一", "二", "三", "四"],
      };
    }],
    ["人物快照越界成员状态", (raw: StageTwoRawDeck) => {
      raw.majorCharacters[0]!.stateAtAnchor = {
        ...characterStateAtAnchorFixture(),
        factionMemberships: [{ factionRef: "faction-court", role: "执政官", status: "retired" }],
      };
    }],
    ["溯源证据超过 3 条", (raw: StageTwoRawDeck) => {
      raw.races[0]!.provenance = { canonRelation: "canon", evidence: ["一", "二", "三", "四"] };
    }],
    ["越界 canonRelation", (raw: StageTwoRawDeck) => {
      raw.places[0]!.provenance = { canonRelation: "fanon" };
    }],
    ["神明快照越界位阶", (raw: StageTwoRawDeck) => {
      raw.majorGods[0]!.stateAtAnchor = { currentRank: "supreme" };
    }],
  ])("拒绝%s", (_label, mutate) => {
    const raw = stageTwoRaw();
    mutate(raw);
    expect(WorldDeckSchema.safeParse(raw).success).toBe(false);
  });

  it("拒绝越界关系状态与未解析到卡组 ref 的锚点关系主客体", () => {
    const badStatus = stageTwoRaw();
    badStatus.relationsAtAnchor = [relationFixture({ status: "friend" })];
    expect(WorldDeckSchema.safeParse(badStatus).success).toBe(false);

    const dangling = stageTwoRaw();
    dangling.relationsAtAnchor = [
      relationFixture({ sourceRef: "ghost-source" }),
      relationFixture({ targetRef: "ghost-target", status: "enemy" }),
    ];
    const result = WorldDeckSchema.safeParse(dangling);
    expect(issueAt(result, "relationsAtAnchor.0.sourceRef")).toBe(true);
    expect(issueAt(result, "relationsAtAnchor.1.targetRef")).toBe(true);
  });

  it("active 人物的锚点关系超过 4 条被拒；非 active 主体不受上限约束", () => {
    const fiveRelations = () =>
      ["character-2", "character-3", "character-4", "character-5", "character-6"].map((target) =>
        relationFixture({ targetRef: target, publicDescription: "同侪之谊" }),
      );

    const four = stageTwoRaw();
    four.relationsAtAnchor = fiveRelations().slice(0, 4);
    expect(WorldDeckSchema.safeParse(four).success).toBe(true);

    const capped = stageTwoRaw();
    capped.relationsAtAnchor = fiveRelations();
    expect(issueAt(WorldDeckSchema.safeParse(capped), "relationsAtAnchor.4.sourceRef")).toBe(true);

    const dead = stageTwoRaw();
    dead.majorCharacters[0]!.statusAtAnchor = "dead";
    dead.relationsAtAnchor = fiveRelations().map((relation) =>
      relationFixture({ ...relation, memorial: true }),
    );
    expect(WorldDeckSchema.safeParse(dead).success).toBe(true);
  });

  it("追念关系（memorial）解析保留且 relationsAtAnchor 进入重掷粒度键", () => {
    const raw = stageTwoRaw();
    raw.majorCharacters[1]!.statusAtAnchor = "dead";
    raw.relationsAtAnchor = [
      relationFixture({ status: "family", publicDescription: "先王之子", memorial: true }),
    ];
    const parsed = WorldDeckSchema.parse(raw);
    expect(parsed.relationsAtAnchor![0]!.memorial).toBe(true);
    expect(DECK_CARD_KEYS).toContain("relationsAtAnchor");
  });
});

it("为当前能力版旧草稿中缺少 ref 的地点补确定性引用", () => {
  const raw = completeDeck();
  delete (raw.places[0] as Partial<(typeof raw.places)[number]>).ref;
  const parsed = parsePersistedWorldDeck(raw);
  expect(parsed.places[0]).toMatchObject({ ref: "place-1", name: "晨钟城" });
});
