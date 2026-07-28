import { afterAll, describe, expect, it } from "vitest";
import { completeCreatorDeck, completeDeck } from "./embark.test-fixtures";
import {
  EmbarkConflictError,
  EmbarkModeMismatchError,
  runClaimedEmbarkTransaction,
} from "@/lib/embark/mutations";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === "") {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}
process.env.DATABASE_URL = testDatabaseUrl;

const { prisma } = await import("@/lib/db");

describe("PostgreSQL embark transaction safety", () => {
  it("物化 Creator 根现实且不创建玩家神，并把神际 ref 映射成真实神 ID", async () => {
    const deck = completeCreatorDeck();
    const world = await prisma.world.create({
      data: {
        userId: "test-user", name: `embark-creator-${crypto.randomUUID()}`,
        genesisInput: "Creator 开局集成测试用原初神谕",
        mode: "creator",
        draftDeck: deck,
        lockedPaths: [],
      },
    });

    try {
      const result = await runClaimedEmbarkTransaction(prisma, world.id, async () => deck);
      const [worldAfter, timeline, gods, divineAbilities] = await Promise.all([
        prisma.world.findUniqueOrThrow({ where: { id: world.id } }),
        prisma.timeline.findUniqueOrThrow({ where: { id: result.timelineId } }),
        prisma.god.findMany({ where: { timelineId: result.timelineId }, orderBy: { materialRef: "asc" } }),
        prisma.ability.findMany({
          where: { timelineId: result.timelineId, kind: "divine" },
          orderBy: { materialRef: "asc" },
        }),
      ]);

      expect(worldAfter).toMatchObject({
        status: "playing",
        activeTimelineId: result.timelineId,
        mode: "creator",
      });
      expect(timeline).toMatchObject({
        branchName: "原初现实",
        branchSummary: "裂光纪 · 裂光元年：诸神争夺信仰",
        realityState: {
          theme: deck.theme,
          style: deck.style,
          cosmology: deck.cosmology,
          fusionAxiom: null,
          currentEra: "裂光纪",
          establishedFacts: [],
        },
        observerState: {
          focusType: "world",
          focusId: null,
          timeLabel: "裂光元年",
          viewpoint: "omniscient",
          activeAvatarId: null,
        },
      });
      expect(gods).toHaveLength(deck.majorGods.length);
      expect(gods.some((god) => god.isPlayer || god.tier === "player")).toBe(false);
      expect(divineAbilities).toHaveLength(
        deck.majorGods.reduce((count, god) => count + god.abilities.length, 0),
      );

      const idByRef = new Map(gods.map((god) => [god.materialRef, god.id]));
      for (const source of deck.majorGods) {
        const stored = gods.find((god) => god.materialRef === source.ref)!;
        const expectedRelations = Object.fromEntries(source.relations.map((relation) => [
          idByRef.get(relation.targetGodRef),
          { label: relation.label, note: relation.note },
        ]));
        expect(stored.relations).toEqual(expectedRelations);
        expect(stored.agenda).toEqual(source.agenda);
        expect(stored.agenda).not.toHaveProperty("stanceToPlayer");
      }
    } finally {
      await prisma.world.delete({ where: { id: world.id } });
    }
  });

  it("Pantheon 开局仍恰好创建一个玩家神", async () => {
    const deck = completeDeck();
    const world = await prisma.world.create({
      data: {
        userId: "test-user", name: `embark-pantheon-${crypto.randomUUID()}`,
        genesisInput: "Pantheon 开局回归测试用原初神谕",
        mode: "pantheon",
        draftDeck: deck,
        lockedPaths: [],
      },
    });

    try {
      const result = await runClaimedEmbarkTransaction(prisma, world.id, async () => deck);
      const playerGods = await prisma.god.findMany({
        where: { timelineId: result.timelineId, isPlayer: true },
      });
      expect(playerGods).toHaveLength(1);
      expect(playerGods[0]).toMatchObject({ tier: "player", materialRef: deck.playerGod.ref });
    } finally {
      await prisma.world.delete({ where: { id: world.id } });
    }
  });

  it("核心事务拒绝持久化模式与回调卡组不一致并完整回滚 claim", async () => {
    const creatorDeck = completeCreatorDeck();
    const world = await prisma.world.create({
      data: {
        userId: "test-user", name: `embark-mode-mismatch-${crypto.randomUUID()}`,
        genesisInput: "模式不一致回滚测试",
        mode: "creator",
        draftDeck: creatorDeck,
        lockedPaths: [],
      },
    });

    try {
      await expect(
        runClaimedEmbarkTransaction(prisma, world.id, async () => completeDeck()),
      ).rejects.toBeInstanceOf(EmbarkModeMismatchError);

      const [worldAfter, timelineCount] = await Promise.all([
        prisma.world.findUniqueOrThrow({ where: { id: world.id } }),
        prisma.timeline.count({ where: { worldId: world.id } }),
      ]);
      expect(worldAfter).toMatchObject({ status: "draft", activeTimelineId: null, mode: "creator" });
      expect(timelineCount).toBe(0);
    } finally {
      await prisma.world.delete({ where: { id: world.id } });
    }
  });

  it("在多项物化写入后因未解析引用回滚且世界仍为草稿", async () => {
    const deck = completeDeck();
    deck.majorCharacters[0]!.learnedTraditionRefs = [{ sourceAbilityRef: "missing-tradition" }];
    const world = await prisma.world.create({
      data: {
        userId: "test-user", name: `embark-rollback-${crypto.randomUUID()}`,
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

  it("并发开局只允许一个 draft 声明并且不留下第二条时间线", async () => {
    const deck = completeDeck();
    const world = await prisma.world.create({
      data: {
        userId: "test-user", name: `embark-concurrent-${crypto.randomUUID()}`,
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

afterAll(async () => {
  await prisma.$disconnect();
});
