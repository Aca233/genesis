import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { applyWorldActivityInTransaction } from "./apply";

describe("world activity transaction rollback", () => {
  const suffix = crypto.randomUUID();
  const worldId = `activity-world-${suffix}`;
  const timelineId = `activity-timeline-${suffix}`;
  const chapterId = `activity-chapter-${suffix}`;
  const godId = `activity-god-${suffix}`;
  const generationId = `activity-generation-${suffix}`;

  beforeAll(async () => {
    await prisma.world.create({
      data: {
        userId: "test-user", id: worldId,
        name: "动态事务测试界",
        genesisInput: "测试",
        status: "playing",
        activeTimelineId: timelineId,
        timelines: {
          create: {
            id: timelineId,
            realityState: { currentEra: "旧纪元" },
            observerState: { timeLabel: "旧时刻" },
            gods: {
              create: {
                id: godId,
                name: "潮神",
                aliases: [],
                tier: "major",
                domains: ["潮汐"],
              },
            },
            chapters: {
              create: { id: chapterId, index: 0 },
            },
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.world.deleteMany({ where: { id: worldId } });
  });

  it("动态写入后数据库报错会回滚正文、时间和全部动态", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          id: generationId,
          chapterId,
          index: 0,
          role: "narrator",
          content: "潮水淹过旧堤。",
          scale: "scene",
        },
      });
      await tx.timeline.update({
        where: { id: timelineId },
        data: {
          realityState: { currentEra: "新纪元" },
          observerState: { timeLabel: "新时刻" },
        },
      });

      const failingTx = {
        timeline: tx.timeline,
        worldEvent: tx.worldEvent,
        worldActivity: {
          findUnique: tx.worldActivity.findUnique.bind(tx.worldActivity),
          create: async (args: Parameters<typeof tx.worldActivity.create>[0]) => {
            await tx.worldActivity.create(args);
            throw new Error("forced activity write failure");
          },
        },
      };
      await applyWorldActivityInTransaction(failingTx, {
        timelineId,
        generationId,
        sourceMessageId: generationId,
        meta: {
          worldActions: [{
            actorType: "god",
            actorId: godId,
            action: "掀起越堤潮",
            targetIds: [],
            visibility: "public",
            consequence: "旧堤被淹",
          }],
          activityEntries: [],
        },
      });
    })).rejects.toThrow("forced activity write failure");

    expect(await prisma.message.findUnique({ where: { id: generationId } })).toBeNull();
    expect(await prisma.worldActivity.count({
      where: { sourceMessageId: generationId },
    })).toBe(0);
    expect(await prisma.timeline.findUniqueOrThrow({
      where: { id: timelineId },
      select: { realityState: true, observerState: true },
    })).toMatchObject({
      realityState: { currentEra: "旧纪元" },
      observerState: { timeLabel: "旧时刻" },
    });
  });
});
