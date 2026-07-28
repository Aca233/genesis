import { afterAll, describe, expect, it } from "vitest";
import { applyAbilityChange } from "./mutations";
import type { AbilityMutationClient } from "./mutations";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
const { prisma } = await import("@/lib/db");

async function fixture() {
  const world = await prisma.world.create({
    data: { userId: "test-user", name: `mutation-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [] },
  });
  const timeline = await prisma.timeline.create({ data: { worldId: world.id } });
  const character = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "character",
      name: "阿岚",
      aliases: [],
      emblemSeed: "alan",
      summary: "石匠",
      lockedPaths: [],
    },
  });
  const chapter = await prisma.chapter.create({ data: { timelineId: timeline.id, index: 1 } });
  const message = await prisma.message.create({
    data: {
      chapterId: chapter.id,
      index: 1,
      role: "narrator",
      content: "阿岚反复演练凿阵术，终于将凿阵术由生涩磨炼至纯熟。",
      scale: "years",
    },
  });
  const ability = await prisma.ability.create({
    data: {
      timelineId: timeline.id,
      entityId: character.id,
      name: "凿阵术",
      kind: "personal",
      effect: "开凿阵基",
      trigger: "施工时",
      cost: "体力",
      limitations: "需要石材",
      mastery: "novice",
      state: "normal",
      visibility: "known",
      lockedFields: [],
    },
  });
  return { world, chapter, message, ability };
}

describe("真实 Prisma 能力乐观更新", () => {
  it("以 id+version 更新 improved 并原子写入事件", async () => {
    const data = await fixture();
    try {
      const result = await applyAbilityChange(prisma as unknown as AbilityMutationClient, {
        abilityId: data.ability.id,
        version: data.ability.version,
        patch: { mastery: "adept" },
        event: {
          type: "improved",
          chapterId: data.chapter.id,
          messageId: data.message.id,
          evidence: "阿岚反复演练凿阵术，终于将凿阵术由生涩磨炼至纯熟",
          scale: "years",
          dedupeKey: `improved:${data.ability.id}`,
        },
      });
      const [ability, event] = await Promise.all([
        prisma.ability.findUnique({ where: { id: data.ability.id } }),
        prisma.abilityEvent.findUnique({ where: { dedupeKey: `improved:${data.ability.id}` } }),
      ]);
      expect(result.applied).toBe(true);
      expect(ability).toMatchObject({ mastery: "adept", version: 2 });
      expect(event).toMatchObject({
        abilityId: data.ability.id,
        chapterId: data.chapter.id,
        messageId: data.message.id,
        scale: "years",
      });
    } finally {
      await prisma.world.delete({ where: { id: data.world.id } });
    }
  });
});

afterAll(async () => prisma.$disconnect());

it("真实 PG 并发相同 dedupe 操作返回一次 applied 与一次幂等，不同操作冲突", async () => {
  const data = await fixture();
  const base = {
    abilityId: data.ability.id,
    version: 1,
    patch: { mastery: "adept" },
    event: {
      type: "improved",
      chapterId: data.chapter.id,
      messageId: data.message.id,
      evidence: "阿岚反复演练凿阵术，终于将凿阵术由生涩磨炼至纯熟",
      scale: "years",
      dedupeKey: `concurrent:${data.ability.id}`,
    },
  };
  try {
    const same = await Promise.all([
      applyAbilityChange(prisma as unknown as AbilityMutationClient, base),
      applyAbilityChange(prisma as unknown as AbilityMutationClient, base),
    ]);
    expect(same.map((result) => result.applied).sort()).toEqual([false, true]);
    expect(await prisma.abilityEvent.count({ where: { abilityId: data.ability.id } })).toBe(1);

  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }

  const different = await fixture();
  const operation = {
    abilityId: different.ability.id,
    version: 1,
    patch: { mastery: "adept" },
    event: {
      type: "improved",
      chapterId: different.chapter.id,
      messageId: different.message.id,
      evidence: "阿岚反复演练凿阵术，终于将凿阵术由生涩磨炼至纯熟",
      scale: "years",
      dedupeKey: `different:${different.ability.id}`,
    },
  };
  try {
    const raced = await Promise.allSettled([
      applyAbilityChange(prisma as unknown as AbilityMutationClient, operation),
      applyAbilityChange(prisma as unknown as AbilityMutationClient, {
        ...operation,
        event: { ...operation.event, evidence: "另一段不同证据" },
      }),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(raced.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringMatching(/刷新|冲突/) }),
    });
    expect(await prisma.abilityEvent.count({ where: { abilityId: different.ability.id } })).toBe(1);
  } finally {
    await prisma.world.delete({ where: { id: different.world.id } });
  }
});
