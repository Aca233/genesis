import { afterAll, describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = testDatabaseUrl;
const { prisma } = await import("@/lib/db");
const { archiveInitialDeck, createMaterialVersion, deleteMaterialVersion } = await import("@/lib/materials/repository");

describe("material deletion lifecycle", () => {
  it("preserves cards, immutable versions and frozen task snapshots after source world deletion", async () => {
    const world = await prisma.world.create({ data: { name: `delete-source-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [] } });
    let cardId = "";
    try {
      await prisma.$transaction((tx) => archiveInitialDeck(tx, { worldId: world.id, worldName: world.name, deck: completeDeck() }));
      const card = await prisma.materialCard.findFirstOrThrow({ where: { sourceWorldId: world.id, kind: "character" }, include: { versions: true } });
      cardId = card.id;
      const frozen = { schemaVersion: 1, items: [{ card: { id: card.id }, version: { id: card.versions[0]!.id, content: card.versions[0]!.content } }], estimatedChars: 1 };
      const task = await prisma.genesisTask.create({ data: { decree: "冻结素材测试", completedKeys: [], materialSelection: frozen } });
      await prisma.world.delete({ where: { id: world.id } });
      const preserved = await prisma.materialCard.findUniqueOrThrow({ where: { id: card.id }, include: { versions: true } });
      expect(preserved).toMatchObject({ sourceWorldId: null, sourceWorldName: world.name });
      expect(preserved.versions).toHaveLength(1);
      expect((await prisma.genesisTask.findUniqueOrThrow({ where: { id: task.id } })).materialSelection).toEqual(frozen);
      await prisma.genesisTask.delete({ where: { id: task.id } });
    } finally {
      if (cardId) await prisma.materialCard.deleteMany({ where: { id: cardId } });
      await prisma.world.deleteMany({ where: { id: world.id } });
    }
  });

  it("rejects deleting the default or final version and never mutates old JSON", async () => {
    const world = await prisma.world.create({ data: { name: `delete-version-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [] } });
    try {
      await prisma.$transaction((tx) => archiveInitialDeck(tx, { worldId: world.id, worldName: world.name, deck: completeDeck() }));
      const card = await prisma.materialCard.findFirstOrThrow({ where: { sourceWorldId: world.id, kind: "place" }, include: { versions: true } });
      const initial = card.versions[0]!;
      await expect(deleteMaterialVersion(initial.id)).rejects.toThrow("默认版本不可删除");
      const copy = await createMaterialVersion({ cardId: card.id, name: "复制版", parentVersionId: initial.id, content: initial.content as never, dependencies: initial.dependencies as never });
      await expect(deleteMaterialVersion(initial.id)).rejects.toThrow("默认版本不可删除");
      await expect(deleteMaterialVersion(copy.id)).resolves.toMatchObject({ id: copy.id });
      expect((await prisma.materialVersion.findUniqueOrThrow({ where: { id: initial.id } })).content).toEqual(initial.content);
    } finally { await prisma.world.delete({ where: { id: world.id } }); }
  });
});
afterAll(() => prisma.$disconnect());
