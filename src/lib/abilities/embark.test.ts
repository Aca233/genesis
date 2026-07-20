import "dotenv/config";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { WorldDeckSchema, type WorldDeck } from "@/lib/cards/schemas";
import { materializeDeckAbilities } from "./embark";
import {
  EmbarkConflictError,
  materializeEmbarkDeck,
  runClaimedEmbarkTransaction,
  runEmbarkTransaction,
} from "@/app/api/worlds/[id]/embark/route";
import { prisma } from "@/lib/db";

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

function completeDeck(): WorldDeck {
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

  return WorldDeckSchema.parse({
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
    places: [{ name: "晨钟城", aliases: [], kind: "城市", overview: "初启之城", allegiance: "晨钟议会" }],
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

type StoredAbility = {
  id: string;
  timelineId: string;
  entityId: string | null;
  godId: string | null;
  sourceAbilityId: string | null;
  kind: string;
  name: string;
  bloodlineJustification?: string | null;
};

function fakeTransaction() {
  const entities = new Map<string, { id: string; timelineId: string; type: string; raceId: string | null }>([
    ["race-db-human", { id: "race-db-human", timelineId: "timeline-1", type: "race", raceId: null }],
    ...Array.from({ length: 6 }, (_, index) => [
      `character-db-${index + 1}`,
      { id: `character-db-${index + 1}`, timelineId: "timeline-1", type: "character", raceId: "race-db-human" },
    ] as const),
  ]);
  const gods = new Map<string, { id: string; timelineId: string }>([
    ["god-db-player", { id: "god-db-player", timelineId: "timeline-1" }],
    ...Array.from({ length: 4 }, (_, index) => [
      `god-db-major-${index + 1}`,
      { id: `god-db-major-${index + 1}`, timelineId: "timeline-1" },
    ] as const),
  ]);
  const abilities: StoredAbility[] = [];
  const memberships: Array<{ characterId: string; factionId: string; role: string; isPrimary: boolean }> = [];

  return {
    abilities,
    memberships,
    tx: {
      entity: { findUnique: async ({ where }: { where: { id: string } }) => entities.get(where.id) ?? null },
      god: { findUnique: async ({ where }: { where: { id: string } }) => gods.get(where.id) ?? null },
      ability: {
        findUnique: async ({ where }: { where: { id: string } }) => abilities.find((ability) => ability.id === where.id) ?? null,
        create: async ({ data }: { data: Omit<StoredAbility, "id"> }) => {
          const created = { ...data, id: `ability-db-${abilities.length + 1}` };
          abilities.push(created);
          return created;
        },
      },
      entityMembership: {
        create: async ({ data }: { data: { characterId: string; factionId: string; role: string; isPrimary: boolean } }) => {
          memberships.push(data);
          return { id: `membership-${memberships.length}`, ...data };
        },
      },
    },
  };
}

describe("materializeDeckAbilities", () => {
  it("物化完整卡组的能力、来源映射与人物势力关系", async () => {
    const deck = completeDeck();
    const fake = fakeTransaction();
    const ids = {
      raceByRef: new Map([["race-human", "race-db-human"]]),
      factionByRef: new Map([
        ["faction-court", "faction-db-court"],
        ["faction-archive", "faction-db-archive"],
      ]),
      characterByRef: new Map(Array.from({ length: 6 }, (_, index) => [`character-${index + 1}`, `character-db-${index + 1}`])),
      godByRef: new Map<string, string>([
        ["god-player", "god-db-player"],
        ...Array.from({ length: 4 }, (_, index) =>
          [`god-major-${index + 1}`, `god-db-major-${index + 1}`] as [string, string],
        ),
      ]),
      abilityByRef: new Map<string, string>(),
    };

    await materializeDeckAbilities(fake.tx, "timeline-1", deck, ids);

    expect(ids.abilityByRef.get("ability-human-sight")).toBe("ability-db-1");
    expect(fake.memberships).toContainEqual({
      characterId: "character-db-1",
      factionId: "faction-db-court",
      role: "执政官",
      isPrimary: true,
    });
    expect(fake.abilities.filter((ability) => ability.entityId === "race-db-human")).toHaveLength(2);
    expect(fake.abilities.filter((ability) => ability.godId !== null)).toHaveLength(15);
    expect(fake.abilities.filter((ability) => ability.kind === "personal")).toHaveLength(12);

    const learned = fake.abilities.find(
      (ability) => ability.name === "ability-human-ritual之能" && ability.entityId === "character-db-1",
    );
    expect(learned?.entityId).toBe("character-db-1");
    expect(learned?.sourceAbilityId).toBe(ids.abilityByRef.get("ability-human-ritual"));
    expect(fake.abilities.find((ability) => ability.name === "ability-character-1-override之能")?.sourceAbilityId)
      .toBe(ids.abilityByRef.get("ability-human-sight"));
  });

  it("在同一事务中创建种族、势力、地点、人物、神与第一章", async () => {
    const deck = completeDeck();
    const entities = new Map<string, { id: string; timelineId: string; type: string; raceId: string | null }>();
    const gods = new Map<string, { id: string; timelineId: string }>();
    const abilities: StoredAbility[] = [];
    const entityCreates: Array<Record<string, unknown>> = [];
    const memberships: Array<{ characterId: string; factionId: string; role: string; isPrimary: boolean }> = [];
    let entityIndex = 0;
    let godIndex = 0;

    const tx = {
      timeline: { create: async () => ({ id: "timeline-1" }) },
      god: {
        create: async ({ data }: { data: { timelineId: string } }) => {
          const god = { id: `god-db-${++godIndex}`, timelineId: data.timelineId };
          gods.set(god.id, god);
          return god;
        },
        findUnique: async ({ where }: { where: { id: string } }) => gods.get(where.id) ?? null,
      },
      entity: {
        create: async ({ data }: { data: { timelineId: string; type: string; raceId?: string | null } }) => {
          const entity = {
            id: `entity-db-${++entityIndex}`,
            timelineId: data.timelineId,
            type: data.type,
            raceId: data.raceId ?? null,
          };
          entities.set(entity.id, entity);
          entityCreates.push(data as unknown as Record<string, unknown>);
          return entity;
        },
        findUnique: async ({ where }: { where: { id: string } }) => entities.get(where.id) ?? null,
      },
      ability: {
        findUnique: async ({ where }: { where: { id: string } }) => abilities.find((ability) => ability.id === where.id) ?? null,
        create: async ({ data }: { data: Omit<StoredAbility, "id"> }) => {
          const ability = { ...data, id: `ability-db-${abilities.length + 1}` };
          abilities.push(ability);
          return ability;
        },
      },
      entityMembership: {
        create: async ({ data }: { data: { characterId: string; factionId: string; role: string; isPrimary: boolean } }) => {
          memberships.push(data);
          return { id: `membership-${memberships.length}`, ...data };
        },
      },
      chapter: { create: async () => ({ id: "chapter-1" }) },
      world: { update: async () => ({ id: "world-1" }) },
    } as unknown as Prisma.TransactionClient;

    await expect(materializeEmbarkDeck(tx, "world-1", deck)).resolves.toEqual({
      timelineId: "timeline-1",
      chapterId: "chapter-1",
    });

    expect(entityCreates.map(({ type }) => type)).toEqual([
      "race",
      "faction",
      "faction",
      "place",
      "character",
      "character",
      "character",
      "character",
      "character",
      "character",
    ]);
    expect([...entities.values()].filter((entity) => entity.type === "character").every(
      (character) => character.raceId === "entity-db-1",
    )).toBe(true);
    expect(entityCreates[1]?.sections).toEqual({
      create: expect.arrayContaining([
        expect.objectContaining({ key: "keyFigures", content: { names: ["人物1", "人物2"] } }),
      ]),
    });
    expect(memberships).toContainEqual(expect.objectContaining({ role: "执政官", isPrimary: true }));
    expect(abilities.filter((ability) => ability.godId !== null)).toHaveLength(15);
  });

  it("引用物化失败时事务不提交任何已暂存写入", async () => {
    const deck = completeDeck();
    deck.majorCharacters[0]!.learnedTraditionRefs = [{ sourceAbilityRef: "missing-tradition" }];
    const committedWrites: string[] = [];

    const transactionRunner = {
      $transaction: async <T,>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
        const stagedWrites: string[] = [];
        const entities = new Map<string, { id: string; timelineId: string; type: string; raceId: string | null }>();
        const gods = new Map<string, { id: string; timelineId: string }>();
        const abilities: StoredAbility[] = [];
        let entityIndex = 0;
        let godIndex = 0;

        const tx = {
          timeline: {
            create: async () => {
              stagedWrites.push("timeline");
              return { id: "timeline-rollback" };
            },
          },
          god: {
            create: async ({ data }: { data: { timelineId: string } }) => {
              const god = { id: `god-rollback-${++godIndex}`, timelineId: data.timelineId };
              gods.set(god.id, god);
              stagedWrites.push("god");
              return god;
            },
            findUnique: async ({ where }: { where: { id: string } }) => gods.get(where.id) ?? null,
          },
          entity: {
            create: async ({ data }: { data: { timelineId: string; type: string; raceId?: string | null } }) => {
              const entity = {
                id: `entity-rollback-${++entityIndex}`,
                timelineId: data.timelineId,
                type: data.type,
                raceId: data.raceId ?? null,
              };
              entities.set(entity.id, entity);
              stagedWrites.push(entity.type);
              return entity;
            },
            findUnique: async ({ where }: { where: { id: string } }) => entities.get(where.id) ?? null,
          },
          ability: {
            findUnique: async ({ where }: { where: { id: string } }) =>
              abilities.find((ability) => ability.id === where.id) ?? null,
            create: async ({ data }: { data: Omit<StoredAbility, "id"> }) => {
              const ability = { ...data, id: `ability-rollback-${abilities.length + 1}` };
              abilities.push(ability);
              stagedWrites.push("ability");
              return ability;
            },
          },
          entityMembership: {
            create: async () => {
              stagedWrites.push("membership");
              return { id: "membership-rollback" };
            },
          },
          chapter: {
            create: async () => {
              stagedWrites.push("chapter");
              return { id: "chapter-rollback" };
            },
          },
          world: {
            update: async () => {
              stagedWrites.push("world-update");
              return { id: "world-rollback" };
            },
          },
        } as unknown as Prisma.TransactionClient;

        const result = await callback(tx);
        committedWrites.push(...stagedWrites);
        return result;
      },
    };

    await expect(runEmbarkTransaction(transactionRunner, "world-rollback", deck)).rejects.toThrow(
      '无法解析能力引用 "missing-tradition"',
    );
    expect(committedWrites).toEqual([]);
  });

  it("PostgreSQL 在多项物化写入后因未解析引用回滚且世界仍为草稿", async () => {
    const deck = completeDeck();
    deck.majorCharacters[0]!.learnedTraditionRefs = [{ sourceAbilityRef: "missing-tradition" }];
    const world = await prisma.world.create({
      data: {
        name: `embark-rollback-${crypto.randomUUID()}`,
        genesisInput: "集成测试用原初神谕",
        draftDeck: deck,
        lockedPaths: [],
      },
    });

    try {
      await expect(
        runClaimedEmbarkTransaction(prisma, world.id, async () => deck),
      ).rejects.toThrow('无法解析能力引用 "missing-tradition"');

      const [worldAfter, timelineCount, entityCount, abilityCount, membershipCount, chapterCount] = await Promise.all([
        prisma.world.findUnique({ where: { id: world.id } }),
        prisma.timeline.count({ where: { worldId: world.id } }),
        prisma.entity.count({ where: { timeline: { worldId: world.id } } }),
        prisma.ability.count({ where: { timeline: { worldId: world.id } } }),
        prisma.entityMembership.count({
          where: { character: { timeline: { worldId: world.id } } },
        }),
        prisma.chapter.count({ where: { timeline: { worldId: world.id } } }),
      ]);

      expect(worldAfter).toMatchObject({ status: "draft", activeTimelineId: null });
      expect([timelineCount, entityCount, abilityCount, membershipCount, chapterCount]).toEqual(
        [0, 0, 0, 0, 0],
      );
    } finally {
      await prisma.world.delete({ where: { id: world.id } });
    }
  });

  it("PostgreSQL 并发开局只允许一个 draft 声明并且不留下第二条时间线", async () => {
    const deck = completeDeck();
    const world = await prisma.world.create({
      data: {
        name: `embark-concurrent-${crypto.randomUUID()}`,
        genesisInput: "并发开局集成测试用原初神谕",
        draftDeck: deck,
        lockedPaths: [],
      },
    });
    let markClaimed!: () => void;
    let releaseFirst!: () => void;
    const claimed = new Promise<void>((resolve) => { markClaimed = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });

    try {
      const first = runClaimedEmbarkTransaction(prisma, world.id, async () => {
        markClaimed();
        await release;
        return deck;
      });
      await claimed;

      const second = runClaimedEmbarkTransaction(prisma, world.id, async () => deck);
      releaseFirst();

      await expect(first).resolves.toMatchObject({ timelineId: expect.any(String) });
      await expect(second).rejects.toBeInstanceOf(EmbarkConflictError);

      const [worldAfter, timelineCount, chapterCount] = await Promise.all([
        prisma.world.findUnique({ where: { id: world.id } }),
        prisma.timeline.count({ where: { worldId: world.id } }),
        prisma.chapter.count({ where: { timeline: { worldId: world.id } } }),
      ]);
      expect(worldAfter).toMatchObject({ status: "playing" });
      expect([timelineCount, chapterCount]).toEqual([1, 1]);
    } finally {
      await prisma.world.delete({ where: { id: world.id } });
    }
  });
});
