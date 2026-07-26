import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  CheckpointForkConflictError,
  CheckpointForkNotFoundError,
  forkPantheonCheckpoint,
} from "./checkpoint-fork";
import { loadRealityTree } from "./tree";

const { prisma } = await import("@/lib/db");
const worldIds: string[] = [];

/** 与结算流水线快照步骤同构的 v2 快照采集（JSON 圆整以固化日期序列化）。 */
async function captureSnapshotV2(timelineId: string): Promise<Prisma.InputJsonValue> {
  const [gods, entities, abilities, entityRelations, worldEvents, omens, timelineState] = await Promise.all([
    prisma.god.findMany({ where: { timelineId } }),
    prisma.entity.findMany({ where: { timelineId }, include: { sections: true } }),
    prisma.ability.findMany({ where: { timelineId } }),
    prisma.entityRelation.findMany({ where: { timelineId } }),
    prisma.worldEvent.findMany({ where: { timelineId } }),
    prisma.omenQueue.findMany({
      where: { timelineId },
      select: { godId: true, text: true, consumed: true, createdAt: true },
    }),
    prisma.timeline.findUniqueOrThrow({
      where: { id: timelineId },
      select: { realityState: true, observerState: true },
    }),
  ]);
  return JSON.parse(JSON.stringify({
    snapshotVersion: 2,
    gods,
    entities,
    abilities,
    entityRelations,
    worldEvents,
    omens,
    temporal: {
      realityState: timelineState.realityState,
      observerState: timelineState.observerState,
    },
    pendingSettlement: { recorded: true },
  })) as Prisma.InputJsonValue;
}

async function fixture() {
  const world = await prisma.world.create({
    data: {
      name: `checkpoint-fork-${crypto.randomUUID()}`,
      genesisInput: "检查点回溯测试",
      mode: "pantheon",
      status: "playing",
      lockedPaths: [],
    },
  });
  worldIds.push(world.id);
  const timeline = await prisma.timeline.create({
    data: {
      worldId: world.id,
      branchName: "原初现实",
      realityState: { currentEra: "洪典二年" },
      observerState: { timeLabel: "洪典二年" },
    },
  });
  await prisma.world.update({
    where: { id: world.id },
    data: { activeTimelineId: timeline.id },
  });

  const chapterOne = await prisma.chapter.create({
    data: {
      timelineId: timeline.id,
      index: 1,
      settleState: "settled",
      // 旧版 v1 快照：不可回溯
      snapshot: { gods: [], entities: [], pendingSettlement: { recorded: true } },
    },
  });
  const chapterTwo = await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 2, settleState: "settled" },
  });
  const messageTwo = await prisma.message.create({
    data: { chapterId: chapterTwo.id, index: 0, role: "narrator", content: "潮起之前。" },
  });

  // ── 检查点（第 2 卷结算）时刻的世界状态 ──
  const playerGod = await prisma.god.create({
    data: {
      timelineId: timeline.id,
      name: "观澜",
      aliases: [],
      tier: "player",
      isPlayer: true,
      rank: "nascent",
      domains: ["潮汐"],
    },
  });
  const npcGod = await prisma.god.create({
    data: {
      timelineId: timeline.id,
      name: "潮神",
      aliases: ["北海主"],
      tier: "major",
      rank: "nascent",
      domains: ["海"],
      persona: { temper: "cold" },
    },
  });
  const heroine = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "character",
      name: "沉睡者",
      aliases: [],
      emblemSeed: "sleeper",
      summary: "雪夜里她仍未睁眼。",
      lockedPaths: [],
    },
  });
  await prisma.entitySection.create({
    data: {
      entityId: heroine.id,
      key: "overview",
      content: { text: "旧貌" },
      revealed: true,
    },
  });
  const oldGuild = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "faction",
      name: "守夜人",
      aliases: [],
      emblemSeed: "watchers",
      summary: "看守沉睡者。",
      lockedPaths: [],
    },
  });
  await prisma.entityRelation.create({
    data: {
      timelineId: timeline.id,
      sourceEntityId: heroine.id,
      targetEntityId: oldGuild.id,
      label: "盟友",
      note: "旧誓仍在。",
    },
  });
  const ability = await prisma.ability.create({
    data: {
      timelineId: timeline.id,
      entityId: heroine.id,
      name: "听潮",
      kind: "personal",
      effect: "听见远方潮声",
      trigger: "静夜",
      cost: "无",
      limitations: "仅限夜间",
      mastery: "novice",
      lockedFields: [],
    },
  });
  const omenCreatedAt = new Date("2026-07-18T00:00:00.000Z");
  await prisma.omenQueue.create({
    data: {
      timelineId: timeline.id,
      godId: npcGod.id,
      text: "潮声自北而来",
      consumed: false,
      createdAt: omenCreatedAt,
    },
  });
  const originActivity = await prisma.worldActivity.create({
    data: {
      id: `activity-${crypto.randomUUID()}`,
      timelineId: timeline.id,
      recordType: "activity",
      kind: "faith",
      text: "北疆潮汐失序。",
      visibility: "public",
      targetIds: [],
      subjectIds: [npcGod.id],
      sourceMessageId: messageTwo.id,
      eraLabel: "洪典二年",
      timeLabel: "冬",
    },
  });
  const parentEvent = await prisma.worldEvent.create({
    data: {
      id: `event-${crypto.randomUUID()}`,
      timelineId: timeline.id,
      kind: "war",
      title: "北疆之乱",
      summary: "潮汐失序引发边乱。",
      phase: "emerging",
      visibility: "public",
      participantIds: [npcGod.id],
      originMessageId: messageTwo.id,
      latestMessageId: messageTwo.id,
    },
  });
  const trackedEvent = await prisma.worldEvent.create({
    data: {
      id: `event-${crypto.randomUUID()}`,
      timelineId: timeline.id,
      kind: "conspiracy",
      title: "潮下密谋",
      summary: "有人借乱行事。",
      phase: "emerging",
      visibility: "player_known",
      participantIds: [heroine.id],
      originMessageId: messageTwo.id,
      originActivityId: originActivity.id,
      latestMessageId: messageTwo.id,
      parentEventId: parentEvent.id,
    },
  });
  await prisma.chronicleEntry.create({
    data: {
      timelineId: timeline.id,
      chapterIndex: 1,
      yearLabel: "洪典元年",
      text: "潮汐初定。",
      entityIds: [],
      godIds: [],
    },
  });
  await prisma.chronicleEntry.create({
    data: {
      timelineId: timeline.id,
      chapterIndex: 2,
      yearLabel: "洪典二年",
      text: "北疆潮乱。",
      entityIds: [],
      godIds: [npcGod.id],
    },
  });
  const darkEntry = await prisma.chronicleEntry.create({
    data: {
      timelineId: timeline.id,
      chapterIndex: 2,
      yearLabel: "",
      text: "潮神在暗中挪动了界碑。",
      entityIds: [],
      godIds: [npcGod.id],
      revealed: false,
    },
  });

  // 检查点快照落到第 2 卷
  await prisma.chapter.update({
    where: { id: chapterTwo.id },
    data: { snapshot: await captureSnapshotV2(timeline.id) },
  });

  // ── 检查点之后的世界演进（第 3 卷） ──
  const chapterThree = await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 3, settleState: "settled" },
  });
  const messageThree = await prisma.message.create({
    data: { chapterId: chapterThree.id, index: 0, role: "narrator", content: "她醒了。" },
  });
  await prisma.god.update({ where: { id: npcGod.id }, data: { rank: "ascendant" } });
  await prisma.entity.update({
    where: { id: heroine.id },
    data: { summary: "她已然醒来。" },
  });
  await prisma.entitySection.update({
    where: { entityId_key: { entityId: heroine.id, key: "overview" } },
    data: { content: { text: "新貌" } },
  });
  await prisma.entitySection.create({
    data: { entityId: heroine.id, key: "whispers", content: { text: "醒后呓语" }, revealed: true },
  });
  await prisma.ability.update({ where: { id: ability.id }, data: { mastery: "adept" } });
  const newCult = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "cult",
      name: "新潮会",
      aliases: [],
      emblemSeed: "new-tide",
      summary: "检查点之后才出现的组织。",
      lockedPaths: [],
    },
  });
  await prisma.iconAssignment.create({
    data: {
      timelineId: timeline.id,
      subjectType: "entity",
      subjectId: newCult.id,
      token: "faction.cult",
      source: "derived",
    },
  });
  await prisma.entityRelation.create({
    data: {
      timelineId: timeline.id,
      sourceEntityId: heroine.id,
      targetEntityId: newCult.id,
      label: "仇敌",
      note: "醒来后结怨。",
    },
  });
  await prisma.omenQueue.updateMany({
    where: { timelineId: timeline.id, godId: npcGod.id },
    data: { consumed: true },
  });
  await prisma.omenQueue.create({
    data: {
      timelineId: timeline.id,
      godId: playerGod.id,
      text: "检查点之后的新征兆",
      consumed: false,
    },
  });
  await prisma.worldEvent.update({
    where: { id: trackedEvent.id },
    data: { phase: "escalating" },
  });
  await prisma.worldEvent.create({
    data: {
      id: `event-${crypto.randomUUID()}`,
      timelineId: timeline.id,
      kind: "mystery",
      title: "醒者之谜",
      summary: "检查点之后才浮现的事件。",
      phase: "emerging",
      visibility: "public",
      participantIds: [heroine.id],
      originMessageId: messageThree.id,
      latestMessageId: messageThree.id,
    },
  });
  await prisma.worldActivity.create({
    data: {
      id: `activity-${crypto.randomUUID()}`,
      timelineId: timeline.id,
      recordType: "activity",
      kind: "mystery",
      text: "醒者行迹成谜。",
      visibility: "public",
      targetIds: [],
      subjectIds: [heroine.id],
      sourceMessageId: messageThree.id,
      eraLabel: "洪典三年",
      timeLabel: "春",
    },
  });
  await prisma.chronicleEntry.create({
    data: {
      timelineId: timeline.id,
      chapterIndex: 3,
      yearLabel: "洪典三年",
      text: "沉睡者醒转。",
      entityIds: [heroine.id],
      godIds: [],
    },
  });
  await prisma.chronicleEntry.update({
    where: { id: darkEntry.id },
    data: { revealed: true, revealedAtChapter: 3 },
  });
  await prisma.timeline.update({
    where: { id: timeline.id },
    data: {
      realityState: { currentEra: "洪典三年" },
      observerState: { timeLabel: "洪典三年" },
    },
  });
  await prisma.chapter.update({
    where: { id: chapterThree.id },
    data: { snapshot: await captureSnapshotV2(timeline.id) },
  });
  await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 4, settleState: "open" },
  });

  return {
    world,
    timeline,
    chapterOne,
    chapterTwo,
    chapterThree,
    playerGod,
    npcGod,
    heroine,
    oldGuild,
    newCult,
    ability,
    originActivity,
    parentEvent,
    trackedEvent,
  };
}

describe("forkPantheonCheckpoint", () => {
  it("克隆冻结原现实并把新现实还原到检查点时刻，随后可幂等重放", async () => {
    const data = await fixture();
    const idempotencyKey = `checkpoint-${crypto.randomUUID()}`;

    const result = await forkPantheonCheckpoint(prisma, {
      worldId: data.world.id,
      sourceChapterId: data.chapterTwo.id,
      expectedActiveId: data.timeline.id,
      idempotencyKey,
    });
    expect(result.timelineId).not.toBe(data.timeline.id);
    expect(result.activeId).toBe(result.timelineId);

    // 世界已切换到新现实，操作租约已释放
    const worldAfter = await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } });
    expect(worldAfter.activeTimelineId).toBe(result.timelineId);
    expect(worldAfter.operationKind).toBeNull();
    expect(worldAfter.operationToken).toBeNull();

    // 原现实原封未动（章节数、活动实体、编年史都保持演进后的状态）
    expect(await prisma.chapter.count({ where: { timelineId: data.timeline.id } })).toBe(4);
    expect(await prisma.entity.count({ where: { timelineId: data.timeline.id } })).toBe(3);
    expect((await prisma.god.findUniqueOrThrow({ where: { id: data.npcGod.id } })).rank).toBe("ascendant");

    const clonedId = result.timelineId;
    // 章节止于新的续写章 k+1（open），此后的历史被截断
    const clonedChapters = await prisma.chapter.findMany({
      where: { timelineId: clonedId },
      orderBy: { index: "asc" },
      select: { index: true, settleState: true },
    });
    expect(clonedChapters).toEqual([
      { index: 1, settleState: "settled" },
      { index: 2, settleState: "settled" },
      { index: 3, settleState: "open" },
    ]);
    expect(await prisma.message.count({
      where: { chapter: { timelineId: clonedId, index: 3 } },
    })).toBe(0);

    // 众神/众生/能力/栏目回到快照值
    const clonedGods = await prisma.god.findMany({ where: { timelineId: clonedId } });
    expect(clonedGods).toHaveLength(2);
    expect(clonedGods.find((god) => god.name === "潮神")?.rank).toBe("nascent");
    expect(clonedGods.find((god) => god.name === "观澜")?.isPlayer).toBe(true);

    const clonedEntities = await prisma.entity.findMany({
      where: { timelineId: clonedId },
      include: { sections: { orderBy: { key: "asc" } } },
    });
    expect(clonedEntities.map((entity) => entity.name).sort()).toEqual(["守夜人", "沉睡者"]);
    const clonedHeroine = clonedEntities.find((entity) => entity.name === "沉睡者")!;
    expect(clonedHeroine.summary).toBe("雪夜里她仍未睁眼。");
    expect(clonedHeroine.sections).toHaveLength(1);
    expect(clonedHeroine.sections[0]).toMatchObject({
      key: "overview",
      content: { text: "旧貌" },
      revealed: true,
    });

    const clonedAbilities = await prisma.ability.findMany({ where: { timelineId: clonedId } });
    expect(clonedAbilities).toHaveLength(1);
    expect(clonedAbilities[0]).toMatchObject({ name: "听潮", mastery: "novice" });

    // 检查点之后诞生的实体连同图标分配与关系一并消失
    expect(await prisma.iconAssignment.count({
      where: { timelineId: clonedId, subjectType: "entity" },
    })).toBe(0);
    const clonedRelations = await prisma.entityRelation.findMany({ where: { timelineId: clonedId } });
    expect(clonedRelations).toHaveLength(1);
    expect(clonedRelations[0]).toMatchObject({ label: "盟友", note: "旧誓仍在。" });
    expect(clonedRelations[0].sourceEntityId).toBe(clonedHeroine.id);

    // 编年史：> k 删除；此后才揭示的暗记重新隐藏
    const clonedChronicles = await prisma.chronicleEntry.findMany({
      where: { timelineId: clonedId },
      orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
    });
    expect(clonedChronicles.map((entry) => entry.chapterIndex)).toEqual([1, 2, 2]);
    const clonedDark = clonedChronicles.find((entry) => entry.text === "潮神在暗中挪动了界碑。")!;
    expect(clonedDark.revealed).toBe(false);
    expect(clonedDark.revealedAtChapter).toBeNull();
    expect(clonedChronicles.find((entry) => entry.text === "北疆潮乱。")?.revealed).toBe(true);

    // 征兆：consumed 回拨；检查点之后的新征兆删除
    const clonedOmens = await prisma.omenQueue.findMany({ where: { timelineId: clonedId } });
    expect(clonedOmens).toHaveLength(1);
    expect(clonedOmens[0]).toMatchObject({ text: "潮声自北而来", consumed: false });

    // 世界事件：阶段回拨，父事件与源动态边保持完好；此后的事件与动态删除
    const clonedEvents = await prisma.worldEvent.findMany({ where: { timelineId: clonedId } });
    expect(clonedEvents).toHaveLength(2);
    const clonedTracked = clonedEvents.find((event) => event.title === "潮下密谋")!;
    const clonedParent = clonedEvents.find((event) => event.title === "北疆之乱")!;
    expect(clonedTracked.phase).toBe("emerging");
    expect(clonedTracked.parentEventId).toBe(clonedParent.id);
    const clonedActivities = await prisma.worldActivity.findMany({ where: { timelineId: clonedId } });
    expect(clonedActivities).toHaveLength(1);
    expect(clonedActivities[0].text).toBe("北疆潮汐失序。");
    expect(clonedTracked.originActivityId).toBe(clonedActivities[0].id);

    // 时间态回拨到检查点纪元
    const clonedTimeline = await prisma.timeline.findUniqueOrThrow({ where: { id: clonedId } });
    expect(clonedTimeline.realityState).toEqual({ currentEra: "洪典二年" });
    expect(clonedTimeline.observerState).toEqual({ timeLabel: "洪典二年" });
    expect(clonedTimeline.parentId).toBe(data.timeline.id);
    expect(clonedTimeline.forkChapter).toBe(2);
    expect(clonedTimeline.branchName).toBe("回溯 · 洪典二年");

    // 合成改写行已绑定，且现实树校验通过并推导出分叉时刻
    const rewrite = await prisma.realityRewrite.findUniqueOrThrow({ where: { idempotencyKey } });
    expect(rewrite).toMatchObject({
      worldId: data.world.id,
      sourceTimelineId: data.timeline.id,
      sourceChapterId: data.chapterTwo.id,
      resultTimelineId: clonedId,
      scope: "prospective",
      status: "completed",
    });
    expect(rewrite.decree).toContain("洪典二年");
    const tree = await loadRealityTree(prisma, data.world.id);
    expect(tree.activeId).toBe(clonedId);
    expect(tree.nodes.find((node) => node.id === clonedId)).toMatchObject({
      parentId: data.timeline.id,
      forkChapter: 2,
      forkTimeLabel: "洪典二年",
    });

    // 幂等重放：同键返回同一现实，不再新建任何行
    const replay = await forkPantheonCheckpoint(prisma, {
      worldId: data.world.id,
      sourceChapterId: data.chapterTwo.id,
      expectedActiveId: data.timeline.id,
      idempotencyKey,
    });
    expect(replay).toEqual({ activeId: clonedId, timelineId: clonedId });
    expect(await prisma.timeline.count({ where: { worldId: data.world.id } })).toBe(2);
    expect(await prisma.realityRewrite.count({ where: { worldId: data.world.id } })).toBe(1);
  });

  it("拒绝旧版快照、过期的 expectedActiveId、缺失章节与创世主模式", async () => {
    const data = await fixture();

    // 旧版 v1 快照 → 冲突
    await expect(forkPantheonCheckpoint(prisma, {
      worldId: data.world.id,
      sourceChapterId: data.chapterOne.id,
      expectedActiveId: data.timeline.id,
      idempotencyKey: `legacy-${crypto.randomUUID()}`,
    })).rejects.toThrow(CheckpointForkConflictError);
    await expect(forkPantheonCheckpoint(prisma, {
      worldId: data.world.id,
      sourceChapterId: data.chapterOne.id,
      expectedActiveId: data.timeline.id,
      idempotencyKey: `legacy-${crypto.randomUUID()}`,
    })).rejects.toThrow("该检查点是旧版存档快照，尚不支持回溯");

    // 活动现实与期望不符 → 冲突
    await expect(forkPantheonCheckpoint(prisma, {
      worldId: data.world.id,
      sourceChapterId: data.chapterTwo.id,
      expectedActiveId: "stale-timeline-id",
      idempotencyKey: `stale-${crypto.randomUUID()}`,
    })).rejects.toThrow("当前现实已变化，请刷新后重试");

    // 章节不存在 → 404 语义
    await expect(forkPantheonCheckpoint(prisma, {
      worldId: data.world.id,
      sourceChapterId: "missing-chapter-id",
      expectedActiveId: data.timeline.id,
      idempotencyKey: `missing-${crypto.randomUUID()}`,
    })).rejects.toThrow(CheckpointForkNotFoundError);

    // 失败路径不留下改写行或克隆时间线，租约已释放
    expect(await prisma.realityRewrite.count({ where: { worldId: data.world.id } })).toBe(0);
    expect(await prisma.timeline.count({ where: { worldId: data.world.id } })).toBe(1);
    const worldAfter = await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } });
    expect(worldAfter.operationKind).toBeNull();

    // 创世主世界 → 冲突（路由层另有 403 前置门禁）
    const creatorWorld = await prisma.world.create({
      data: {
        name: `checkpoint-creator-${crypto.randomUUID()}`,
        genesisInput: "创世主不可回溯",
        mode: "creator",
        lockedPaths: [],
      },
    });
    worldIds.push(creatorWorld.id);
    const creatorTimeline = await prisma.timeline.create({ data: { worldId: creatorWorld.id } });
    await prisma.world.update({
      where: { id: creatorWorld.id },
      data: { activeTimelineId: creatorTimeline.id },
    });
    const creatorChapter = await prisma.chapter.create({
      data: { timelineId: creatorTimeline.id, index: 1, settleState: "settled" },
    });
    await expect(forkPantheonCheckpoint(prisma, {
      worldId: creatorWorld.id,
      sourceChapterId: creatorChapter.id,
      expectedActiveId: creatorTimeline.id,
      idempotencyKey: `creator-${crypto.randomUUID()}`,
    })).rejects.toThrow("仅万神殿模式可回溯检查点");
  });
});

afterAll(async () => {
  for (const worldId of worldIds) {
    await prisma.world.delete({ where: { id: worldId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});
