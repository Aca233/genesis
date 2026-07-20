import { afterAll, describe, expect, it } from "vitest";
import { completeDeck } from "./embark.test-fixtures";
import {
  EmbarkConflictError,
  runClaimedEmbarkTransaction,
} from "@/lib/embark/mutations";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === "") {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}
process.env.DATABASE_URL = testDatabaseUrl;

const { prisma } = await import("@/lib/db");

describe("PostgreSQL embark transaction safety", () => {
  it("在多项物化写入后因未解析引用回滚且世界仍为草稿", async () => {
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

  it("并发开局只允许一个 draft 声明并且不留下第二条时间线", async () => {
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

afterAll(async () => {
  await prisma.$disconnect();
});
