import { afterAll, describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
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
});
afterAll(() => prisma.$disconnect());
