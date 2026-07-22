import { afterAll, describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { runEmbarkTransaction } from "@/lib/embark/mutations";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = testDatabaseUrl;
const { prisma } = await import("@/lib/db");
const { snapshotRuntimeMaterial } = await import("./runtime-snapshot");

describe("runtime material snapshot", () => {
  it("captures complete backstage god, entity and ability state", async () => {
    const deck = completeDeck();
    deck.majorGods[0]!.abilities[0]!.visibility = "hidden";
    const world = await prisma.world.create({ data: { name: `runtime-${crypto.randomUUID()}`, genesisInput: "test", draftDeck: deck, lockedPaths: [] } });
    try {
      const { timelineId } = await runEmbarkTransaction(prisma, world.id, deck, "pantheon");
      const god = await prisma.god.findFirstOrThrow({ where: { timelineId, materialRef: deck.majorGods[0]!.ref } });
      const character = await prisma.entity.findFirstOrThrow({ where: { timelineId, materialRef: deck.majorCharacters[0]!.ref } });
      const ability = await prisma.ability.findFirstOrThrow({ where: { timelineId, materialRef: deck.majorGods[0]!.abilities[0]!.ref } });

      const godSnapshot = await snapshotRuntimeMaterial({ sourceType: "god", sourceId: god.id });
      expect(godSnapshot.content).toMatchObject({ origin: "runtime", kind: "major_god", card: { agenda: expect.anything(), relations: expect.anything() } });
      expect((godSnapshot.content as { card: { abilities: Array<{ visibility: string }> } }).card.abilities)
        .toEqual(expect.arrayContaining([expect.objectContaining({ visibility: "hidden" })]));

      const entitySnapshot = await snapshotRuntimeMaterial({ sourceType: "entity", sourceId: character.id });
      expect(entitySnapshot.content).toMatchObject({ origin: "runtime", kind: "character", card: { sections: expect.any(Array), race: expect.anything(), memberships: expect.any(Array), abilities: expect.any(Array) } });
      expect(entitySnapshot.dependencies).toEqual(expect.arrayContaining([
        expect.objectContaining({ relation: "race" }), expect.objectContaining({ relation: "faction" }),
      ]));

      const abilitySnapshot = await snapshotRuntimeMaterial({ sourceType: "ability", sourceId: ability.id });
      expect(abilitySnapshot.content).toMatchObject({ origin: "runtime", kind: "ability", card: { visibility: "hidden", version: expect.any(Number) }, owner: { kind: "god" } });
      expect(abilitySnapshot.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ relation: "owner" })]));
      expect(abilitySnapshot.cardIdentity.sourceRef).toContain(world.id);
    } finally {
      await prisma.world.delete({ where: { id: world.id } });
    }
  });

  it("uses a stable runtime identity when a story-created object has no materialRef", async () => {
    const world = await prisma.world.create({ data: { name: `runtime-new-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [], timelines: { create: {} } } });
    try {
      const timeline = await prisma.timeline.findFirstOrThrow({ where: { worldId: world.id } });
      const entity = await prisma.entity.create({ data: { timelineId: timeline.id, type: "place", name: "新地点", aliases: [], emblemSeed: "new", summary: "剧情中发现", lockedPaths: [] } });
      const snapshot = await snapshotRuntimeMaterial({ sourceType: "entity", sourceId: entity.id });
      expect(snapshot.cardIdentity.sourceRef).toBe(`${world.id}:runtime:entity:${entity.id}`);
      expect((snapshot.content as { card: { ref: string } }).card.ref).toBe(snapshot.cardIdentity.sourceRef);
    } finally { await prisma.world.delete({ where: { id: world.id } }); }
  });
});
afterAll(() => prisma.$disconnect());
