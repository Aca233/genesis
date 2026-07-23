import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  initialObserverState,
  initialRealityState,
} from "@/lib/reality/schemas";
import { completeCreatorDeck } from "@/lib/abilities/embark.test-fixtures";
import { applyContinuousState } from "./continuous-state";

describe("applyContinuousState", () => {
  const suffix = crypto.randomUUID();
  const worldId = `continuous-state-world-${suffix}`;
  const activeTimelineId = `continuous-state-active-${suffix}`;
  const foreignTimelineId = `continuous-state-foreign-${suffix}`;
  const activeEntityId = `continuous-state-entity-${suffix}`;
  const foreignEntityId = `continuous-state-foreign-entity-${suffix}`;
  const deck = completeCreatorDeck();

  beforeAll(async () => {
    await prisma.world.create({
      data: {
        id: worldId,
        name: "连续状态测试界",
        genesisInput: "测试",
        mode: "creator",
        status: "playing",
        activeTimelineId,
        timelines: {
          create: [{
            id: activeTimelineId,
            realityState: initialRealityState(deck),
            observerState: initialObserverState(deck),
            entities: {
              create: [{
                id: activeEntityId,
                type: "character",
                name: "守门人",
                aliases: [],
                emblemSeed: activeEntityId,
                summary: "守在门前",
                scenePresence: false,
                lockedPaths: [],
              }],
            },
          }, {
            id: foreignTimelineId,
            realityState: initialRealityState(deck),
            observerState: initialObserverState(deck),
            entities: {
              create: [{
                id: foreignEntityId,
                type: "character",
                name: "旧现实守门人",
                aliases: [],
                emblemSeed: foreignEntityId,
                summary: "留在旧现实",
                scenePresence: false,
                lockedPaths: [],
              }],
            },
          }],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.world.deleteMany({ where: { id: worldId } });
  });

  it("在同一活动现实内更新时间和场景状态", async () => {
    await applyContinuousState(prisma, {
      worldId,
      timelineId: activeTimelineId,
      temporalPatch: { time: "双月重合之夜" },
      changes: [{
        kind: "set_scene_presence",
        entityId: activeEntityId,
        present: true,
      }],
    });

    const [timeline, entity] = await Promise.all([
      prisma.timeline.findUniqueOrThrow({ where: { id: activeTimelineId } }),
      prisma.entity.findUniqueOrThrow({ where: { id: activeEntityId } }),
    ]);
    expect(timeline.observerState).toMatchObject({ timeLabel: "双月重合之夜" });
    expect(entity.scenePresence).toBe(true);
  });

  it("拒绝修改其他现实实体且不产生写入", async () => {
    await expect(applyContinuousState(prisma, {
      worldId,
      timelineId: activeTimelineId,
      changes: [{
        kind: "set_scene_presence",
        entityId: foreignEntityId,
        present: true,
      }],
    })).rejects.toThrow("轻变化目标不属于当前现实");

    const entity = await prisma.entity.findUniqueOrThrow({
      where: { id: foreignEntityId },
    });
    expect(entity.scenePresence).toBe(false);
  });
});
