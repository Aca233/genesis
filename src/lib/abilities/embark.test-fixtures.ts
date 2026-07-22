import { CreatorWorldDeckSchema, PantheonWorldDeckSchema, type CreatorWorldDeck, type PantheonWorldDeck } from "@/lib/cards/schemas";

function ability(
  ref: string,
  kind: "racial_innate" | "racial_tradition" | "personal" | "divine",
) {
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
    lockedFields: [],
  };
}

export function completeDeck(): PantheonWorldDeck {
  const characters = Array.from({ length: 6 }, (_, index) => ({
    ref: `character-${index + 1}`,
    name: `人物${index + 1}`,
    aliases: [],
    identity: "关键见证者",
    ageStage: "成年",
    raceRef: "race-human",
    factionMemberships: [{ factionRef: "faction-court", role: index === 0 ? "执政官" : "成员", isPrimary: true }],
    personality: "谨慎而坚定",
    goals: "改变时代的裂隙",
    situation: "正处于抉择之前",
    divineTies: "受玩家神注视",
    conflictTies: "卷入当前纪元冲突",
    learnedTraditionRefs: [{ sourceAbilityRef: "ability-human-ritual" }],
    racialOverrides: index === 0
      ? [{
        ...ability("ability-character-1-override", "racial_innate"),
        sourceAbilityRef: "ability-human-sight",
        bloodlineJustification: null,
      }]
      : [],
    abilities: Array.from({ length: 2 }, (_, abilityIndex) =>
      ability(`ability-character-${index + 1}-${abilityIndex + 1}`, "personal"),
    ),
  }));

  return PantheonWorldDeckSchema.parse({
    mode: "pantheon",
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
        keyFigures: [],
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
        keyFigures: [],
      },
    ],
    races: [{
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
    }],
    majorCharacters: characters,
    places: [{ ref: "place-city", name: "晨钟城", aliases: [], kind: "城市", overview: "初启之城", allegiance: "晨钟议会" }],
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
  });
}

/** Strict Creator-mode fixture derived from the complete shared world graph. */
export function completeCreatorDeck(): CreatorWorldDeck {
  const { playerGod: _playerGod, ...shared } = completeDeck();
  void _playerGod;
  return CreatorWorldDeckSchema.parse({
    ...shared,
    mode: "creator",
    majorGods: shared.majorGods.map(({
      agenda,
      initialRelationToPlayer: _initialRelationToPlayer,
      ...god
    }, index, gods) => {
      void _initialRelationToPlayer;
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
          label: "rival",
          note: "世界内诸神竞争",
        }],
      };
    }),
  });
}
