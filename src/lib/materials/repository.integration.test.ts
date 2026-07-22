import { afterAll, describe, expect, it } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
const { prisma } = await import("@/lib/db");
const { archiveInitialDeck, createMaterialVersion } = await import("./repository");

describe("material repository", () => {
  it("archives initial cards idempotently and appends immutable copies", async () => {
    const world = await prisma.world.create({ data: { name: `materials-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [] } });
    try {
      const deck = completeDeck();
      await prisma.$transaction((tx) => archiveInitialDeck(tx, { worldId: world.id, worldName: world.name, deck }));
      await prisma.$transaction((tx) => archiveInitialDeck(tx, { worldId: world.id, worldName: world.name, deck }));
      const card = await prisma.materialCard.findFirstOrThrow({ where: { sourceWorldId: world.id, kind: "character" }, include: { versions: true } });
      expect(card.versions).toHaveLength(1);
      const original = structuredClone(card.versions[0]!.content);
      const copy = await createMaterialVersion({
        cardId: card.id, parentVersionId: card.versions[0]!.id, name: "剧情版",
        content: card.versions[0]!.content as never,
        dependencies: card.versions[0]!.dependencies as never,
      });
      expect(copy.version).toBe(2);
      expect((await prisma.materialVersion.findUniqueOrThrow({ where: { id: card.versions[0]!.id } })).content).toEqual(original);
    } finally { await prisma.world.delete({ where: { id: world.id } }); }
  });

  it("Creator 归档不创建玩家神素材并保留全部主神能力", async () => {
    const world = await prisma.world.create({ data: { name: `creator-materials-${crypto.randomUUID()}`, genesisInput: "test", mode: "creator", lockedPaths: [] } });
    try {
      const deck = completeCreatorDeck();
      await prisma.$transaction((tx) => archiveInitialDeck(tx, { worldId: world.id, worldName: world.name, deck }));
      const cards = await prisma.materialCard.findMany({ where: { sourceWorldId: world.id } });
      expect(cards.some((card) => card.kind === "player_god")).toBe(false);
      expect(cards.filter((card) => card.kind === "major_god")).toHaveLength(deck.majorGods.length);
      expect(cards.filter((card) => card.kind === "ability")).toHaveLength(
        deck.majorGods.flatMap((god) => god.abilities).length
          + deck.races.flatMap((race) => race.abilities).length
          + deck.majorCharacters.flatMap((character) => [...character.abilities, ...character.racialOverrides]).length,
      );
    } finally { await prisma.world.delete({ where: { id: world.id } }); }
  });
});
afterAll(() => prisma.$disconnect());
