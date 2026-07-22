import { afterAll, describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { runClaimedEmbarkTransaction } from "@/lib/embark/mutations";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === "") {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}
process.env.DATABASE_URL = testDatabaseUrl;

const { prisma } = await import("@/lib/db");
const { GET: exportWorld } = await import("@/app/api/worlds/[id]/export/route");
const { POST: importWorld } = await import("./route");
const { GET: getWorldState } = await import("@/app/api/worlds/[id]/state/route");
const { GET: getCodex } = await import("@/app/api/codex/[id]/route");

function importRequest(payload: unknown) {
  return new Request("http://localhost/api/worlds/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("存档导出导入 PostgreSQL 往返", () => {
  it("真实 embark v2 往返保留 player 关系、来源与历史，同时普通 API 隐藏私有能力", async () => {
    const deck = completeDeck();
    const originalWorld = await prisma.world.create({
      data: {
        name: `archive-roundtrip-${crypto.randomUUID()}`,
        genesisInput: "真实存档往返集成测试",
        draftDeck: deck,
        lockedPaths: [],
      },
    });
    let importedWorldId: string | undefined;

    try {
      const { timelineId, chapterId } = await runClaimedEmbarkTransaction(
        prisma,
        originalWorld.id,
        async () => deck,
      );
      const [majorGod, character, derivedAbility] = await Promise.all([
        prisma.god.findFirstOrThrow({ where: { timelineId, tier: "major" } }),
        prisma.entity.findFirstOrThrow({ where: { timelineId, type: "character" } }),
        prisma.ability.findFirstOrThrow({
          where: { timelineId, sourceAbilityId: { not: null } },
          include: { sourceAbility: true, entity: true },
        }),
      ]);
      const hiddenGodAbility = await prisma.ability.findFirstOrThrow({
        where: { timelineId, godId: majorGod.id },
      });
      await prisma.ability.update({
        where: { id: hiddenGodAbility.id },
        data: { visibility: "hidden" },
      });
      const hiddenCharacterAbility = await prisma.ability.create({
        data: {
          timelineId,
          entityId: character.id,
          name: "未揭示的影技",
          kind: "personal",
          effect: "隐藏效果",
          trigger: "秘密条件",
          cost: "未知",
          limitations: "未知",
          mastery: "novice",
          visibility: "hidden",
          lockedFields: [],
        },
      });
      const message = await prisma.message.create({
        data: {
          chapterId,
          index: 0,
          role: "narrator",
          content: "人物在晨光中掌握了族群技艺。",
          scale: "scene",
        },
      });
      await prisma.abilityEvent.createMany({
        data: [
          {
            abilityId: derivedAbility.id,
            chapterId,
            messageId: message.id,
            type: "improved",
            before: { mastery: "novice" },
            after: { mastery: "adept" },
            evidence: "roundtrip-derived-history",
            scale: "scene",
            dedupeKey: `${chapterId}:${derivedAbility.id}:improved:${message.id}`,
          },
          {
            abilityId: hiddenCharacterAbility.id,
            chapterId,
            messageId: message.id,
            type: "learned",
            before: undefined,
            after: { mastery: "novice" },
            evidence: "roundtrip-hidden-history",
            scale: "scene",
            dedupeKey: `${chapterId}:${hiddenCharacterAbility.id}:learned:${message.id}`,
          },
        ],
      });

      const exportResponse = await exportWorld(
        new Request(`http://localhost/api/worlds/${originalWorld.id}/export`),
        { params: Promise.resolve({ id: originalWorld.id }) },
      );
      const archive = await exportResponse.json();
      expect(archive.version).toBe(2);
      expect(
        archive.world.timelines[0].gods.find((god: { id: string }) => god.id === majorGod.id)
          .relations.player,
      ).toMatchObject({ label: deck.majorGods[0]!.initialRelationToPlayer.label });
      expect(
        archive.world.timelines[0].abilities.some(
          (ability: { id: string; visibility: string }) =>
            ability.id === hiddenCharacterAbility.id && ability.visibility === "hidden",
        ),
      ).toBe(true);

      const importResponse = await importWorld(importRequest(archive));
      expect(importResponse.status).toBe(200);
      importedWorldId = (await importResponse.json()).worldId;
      const importedId = importedWorldId!;

      const importedWorld = await prisma.world.findUniqueOrThrow({
        where: { id: importedId },
        include: {
          timelines: {
            include: {
              gods: true,
              entities: true,
              abilities: { include: { events: true, sourceAbility: true } },
            },
          },
        },
      });
      const importedTimeline = importedWorld.timelines[0]!;
      const importedMajorGod = importedTimeline.gods.find((god) => god.name === majorGod.name)!;
      const importedDerived = importedTimeline.abilities.find(
        (ability) => ability.name === derivedAbility.name && ability.sourceAbilityId !== null,
      )!;
      const importedCharacter = importedTimeline.entities.find(
        (entity) => entity.name === character.name,
      )!;
      expect(importedMajorGod.relations).toMatchObject({
        player: { label: deck.majorGods[0]!.initialRelationToPlayer.label },
      });
      expect(importedDerived.sourceAbility).toMatchObject({
        name: derivedAbility.sourceAbility!.name,
      });
      expect(importedDerived.events).toContainEqual(
        expect.objectContaining({ evidence: "roundtrip-derived-history" }),
      );

      const stateResponse = await getWorldState(
        new Request(`http://localhost/api/worlds/${importedId}/state`),
        { params: Promise.resolve({ id: importedId }) },
      );
      const stateText = JSON.stringify(await stateResponse.json());
      expect(stateText).not.toContain(hiddenGodAbility.name);

      const codexResponse = await getCodex(
        new Request(`http://localhost/api/codex/${importedCharacter.id}`),
        { params: Promise.resolve({ id: importedCharacter.id }) },
      );
      const codexText = JSON.stringify(await codexResponse.json());
      expect(codexText).not.toContain("未揭示的影技");
      expect(codexText).not.toContain("roundtrip-hidden-history");
    } finally {
      if (importedWorldId !== undefined) {
        await prisma.world.delete({ where: { id: importedWorldId } });
      }
      await prisma.world.delete({ where: { id: originalWorld.id } });
    }
  });

  it("version 2 草稿世界往返保留 creator mode 且不导出操作凭证", async () => {
    const source = await prisma.world.create({
      data: {
        name: `creator-archive-${crypto.randomUUID()}`,
        genesisInput: "创造自行运转的宇宙",
        mode: "creator",
        operationKind: "rewrite",
        operationToken: "integration-secret-token",
        operationLeaseExpiresAt: new Date(Date.now() + 60_000),
        lockedPaths: [],
      },
    });
    let importedWorldId: string | undefined;

    try {
      const exported = await exportWorld(
        new Request(`http://localhost/api/worlds/${source.id}/export`),
        { params: Promise.resolve({ id: source.id }) },
      );
      const archive = await exported.json();
      expect(archive.world.mode).toBe("creator");
      expect(JSON.stringify(archive)).not.toContain("integration-secret-token");
      expect(archive.world).not.toHaveProperty("operationKind");

      const imported = await importWorld(importRequest(archive));
      expect(imported.status).toBe(200);
      importedWorldId = (await imported.json()).worldId;
      await expect(prisma.world.findUniqueOrThrow({ where: { id: importedWorldId } }))
        .resolves.toMatchObject({ mode: "creator" });
    } finally {
      if (importedWorldId) await prisma.world.delete({ where: { id: importedWorldId } });
      await prisma.world.delete({ where: { id: source.id } });
    }
  });

  it("真实 version 1 结构可导入并重建章节消息", async () => {
    const oldWorldId = `v1-world-${crypto.randomUUID()}`;
    const oldTimelineId = `v1-timeline-${crypto.randomUUID()}`;
    const oldChapterId = `v1-chapter-${crypto.randomUUID()}`;
    const oldMessageId = `v1-message-${crypto.randomUUID()}`;
    const response = await importWorld(importRequest({
      version: 1,
      exportedAt: new Date().toISOString(),
      world: {
        id: oldWorldId,
        userId: "local",
        name: "旧版真实存档",
        genesisInput: "旧版神谕",
        status: "playing",
        lockedPaths: [],
        activeTimelineId: oldTimelineId,
        timelines: [{
          id: oldTimelineId,
          worldId: oldWorldId,
          parentId: null,
          forkChapter: null,
          chapters: [{
            id: oldChapterId,
            timelineId: oldTimelineId,
            index: 1,
            title: "创世",
            summary: null,
            settleState: "open",
            messages: [{
              id: oldMessageId,
              chapterId: oldChapterId,
              index: 0,
              role: "narrator",
              content: "旧世界仍在讲述。",
              scale: "scene",
            }],
          }],
          gods: [],
          entities: [],
          chronicles: [],
          omens: [],
        }],
        lorebookEntries: [],
      },
    }));
    expect(response.status).toBe(200);
    const { worldId } = await response.json();
    try {
      const imported = await prisma.world.findUniqueOrThrow({
        where: { id: worldId },
        include: { timelines: { include: { chapters: { include: { messages: true } } } } },
      });
      expect(imported.timelines[0]!.chapters[0]!.messages[0]).toMatchObject({
        content: "旧世界仍在讲述。",
      });
    } finally {
      await prisma.world.delete({ where: { id: worldId } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
