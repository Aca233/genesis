import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DELETE } from "./route";

const abilityFields = {
  name: "晨光之血",
  kind: "racial_innate",
  effect: "感知曙光",
  trigger: "日出时",
  cost: "无",
  limitations: "浓雾会遮蔽感知",
  mastery: "adept",
  state: "normal",
  visibility: "known",
  rumorText: null,
  bloodlineJustification: null,
  lockedFields: [],
};

async function createLineageFixture() {
  const world = await prisma.world.create({
    data: {
      name: `ability-delete-lineage-${crypto.randomUUID()}`,
      genesisInput: "能力删除并发集成测试",
      lockedPaths: [],
    },
  });
  const timeline = await prisma.timeline.create({ data: { worldId: world.id } });
  await prisma.world.update({
    where: { id: world.id },
    data: { activeTimelineId: timeline.id, status: "playing" },
  });
  const race = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "race",
      name: "晨裔",
      aliases: [],
      emblemSeed: "race-seed",
      summary: "亲近晨光的种族",
      lockedPaths: [],
    },
  });
  const character = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "character",
      name: "试验继承者",
      aliases: [],
      emblemSeed: "character-seed",
      summary: "承继种族能力的人物",
      lockedPaths: [],
      raceId: race.id,
    },
  });
  const chapter = await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 1, title: "并发删除" },
  });
  const source = await prisma.ability.create({
    data: {
      ...abilityFields,
      timelineId: timeline.id,
      entityId: race.id,
      godId: null,
      sourceAbilityId: null,
    },
  });

  return { world, timeline, character, chapter, source };
}

describe("PostgreSQL ability deletion lineage safety", () => {
  it("并发创建派生能力时，可串行化删除不会破坏来源血缘", async () => {
    const fixture = await createLineageFixture();
    let allowDeleteToContinue!: () => void;
    let descendantCheckReached!: () => void;
    const allowDelete = new Promise<void>((resolve) => { allowDeleteToContinue = resolve; });
    const descendantCheck = new Promise<void>((resolve) => { descendantCheckReached = resolve; });
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) => Promise<unknown>;
    const transactionSpy = vi.spyOn(prisma, "$transaction");
    let transactionOptions: unknown;

    transactionSpy.mockImplementation((async (callback: unknown, options?: unknown) => {
      transactionOptions = options;
      if (typeof callback !== "function") {
        throw new Error("测试仅包装交互式事务");
      }
      return originalTransaction(async (tx) => {
        const ability = new Proxy(tx.ability, {
          get(target, property, receiver) {
            if (property !== "findFirst") return Reflect.get(target, property, receiver);
            return async (...args: Parameters<typeof tx.ability.findFirst>) => {
              const result = await target.findFirst(...args);
              descendantCheckReached();
              await allowDelete;
              return result;
            };
          },
        });
        const wrapped = new Proxy(tx, {
          get(target, property, receiver) {
            return property === "ability" ? ability : Reflect.get(target, property, receiver);
          },
        });
        return callback(wrapped);
      }, options as { isolationLevel?: Prisma.TransactionIsolationLevel } | undefined);
    }) as never);

    let deleting: Promise<Response> | undefined;
    let derivedCreation: Promise<{ id: string }> | undefined;
    try {
      deleting = DELETE(
        new Request(`http://localhost/api/abilities/${fixture.source.id}`, {
          method: "DELETE",
          body: JSON.stringify({
            expectedVersion: fixture.source.version,
            event: {
              type: "mutated",
              chapterId: fixture.chapter.id,
              evidence: "来源能力被废弃",
              scale: "scene",
              dedupeKey: `delete-source-${fixture.source.id}`,
            },
          }),
        }),
        { params: Promise.resolve({ id: fixture.source.id }) },
      );
      await descendantCheck;

      derivedCreation = prisma.ability.create({
        data: {
          ...abilityFields,
          name: "晨光之血的继承",
          timelineId: fixture.timeline.id,
          entityId: fixture.character.id,
          godId: null,
          sourceAbilityId: fixture.source.id,
        },
      });
      const derived = await Promise.race([
        derivedCreation,
        new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error("派生创建不应被删除事务的前置检查锁阻塞")),
          1_500,
        )),
      ]);
      allowDeleteToContinue();
      const response = await deleting;
      const [sourceAfter, derivedAfter] = await Promise.all([
        prisma.ability.findUnique({ where: { id: fixture.source.id } }),
        prisma.ability.findUnique({ where: { id: derived.id } }),
      ]);

      expect(transactionOptions).toMatchObject({ isolationLevel: "Serializable" });
      expect(response.status).toBeOneOf([200, 409]);
      expect(sourceAfter).not.toBeNull();
      expect(derivedAfter?.sourceAbilityId).toBe(fixture.source.id);
      if (response.status === 200) {
        expect(sourceAfter).toMatchObject({ state: "deprecated" });
      }
    } finally {
      allowDeleteToContinue?.();
      await Promise.allSettled([deleting, derivedCreation].filter(Boolean));
      transactionSpy.mockRestore();
      await prisma.world.delete({ where: { id: fixture.world.id } });
    }
  }, 15_000);
});
