import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === "") {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}
process.env.DATABASE_URL = testDatabaseUrl;

const { prisma } = await import("@/lib/db");
const { POST } = await import("./route");

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

async function createDerivedFixture() {
  const world = await prisma.world.create({
    data: {
      userId: "test-user", name: `ability-post-source-unique-${crypto.randomUUID()}`,
      genesisInput: "能力创建并发集成测试",
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
  const source = await prisma.ability.create({
    data: {
      ...abilityFields,
      timelineId: timeline.id,
      entityId: race.id,
      godId: null,
      sourceAbilityId: null,
    },
  });

  return { world, timeline, character, source };
}

function requestForDerived(fixture: Awaited<ReturnType<typeof createDerivedFixture>>) {
  return new Request("http://localhost/api/abilities", {
    method: "POST",
    body: JSON.stringify({
      ...abilityFields,
      timelineId: fixture.timeline.id,
      entityId: fixture.character.id,
      godId: null,
      sourceAbilityId: fixture.source.id,
    }),
  });
}

describe("PostgreSQL derived ability source uniqueness", () => {
  it("并发 POST 同一派生来源时仅创建一条，另一请求返回 409", async () => {
    const fixture = await createDerivedFixture();
    const originalTransaction = prisma.$transaction.bind(prisma) as unknown as (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => Promise<unknown>;
    let releaseCreates!: () => void;
    const bothCreatesReached = new Promise<void>((resolve) => { releaseCreates = resolve; });
    let createCount = 0;
    const transactionSpy = vi.spyOn(prisma, "$transaction");
    transactionSpy.mockImplementation((async (callback: unknown) => {
      if (typeof callback !== "function") throw new Error("测试仅包装交互式事务");
      return originalTransaction(async (tx) => {
        const ability = new Proxy(tx.ability, {
          get(target, property, receiver) {
            if (property !== "create") return Reflect.get(target, property, receiver);
            return async (...args: Parameters<typeof tx.ability.create>) => {
              createCount += 1;
              if (createCount === 2) releaseCreates();
              await bothCreatesReached;
              return Reflect.apply(target.create, target, args);
            };
          },
        });
        const wrapped = new Proxy(tx, {
          get(target, property, receiver) {
            return property === "ability" ? ability : Reflect.get(target, property, receiver);
          },
        });
        return callback(wrapped);
      });
    }) as never);

    try {
      const responses = await Promise.all([
        POST(requestForDerived(fixture)),
        POST(requestForDerived(fixture)),
      ]);
      const statuses = responses.map((response) => response.status).sort();
      const derived = await prisma.ability.findMany({
        where: { entityId: fixture.character.id, sourceAbilityId: fixture.source.id },
      });

      expect(statuses).toEqual([201, 409]);
      expect(derived).toHaveLength(1);
    } finally {
      releaseCreates?.();
      transactionSpy.mockRestore();
      await prisma.world.delete({ where: { id: fixture.world.id } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
