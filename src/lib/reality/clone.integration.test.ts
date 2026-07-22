import { afterAll, describe, expect, it } from "vitest";
import { cloneTimelineGraph } from "./clone";

const { prisma } = await import("@/lib/db");

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function sourceGraph(timelineId: string) {
  const timeline = await prisma.timeline.findUniqueOrThrow({
    where: { id: timelineId },
    include: {
      chapters: {
        orderBy: { index: "asc" },
        include: {
          messages: { orderBy: { index: "asc" } },
          generationRequests: { orderBy: { id: "asc" } },
        },
      },
      gods: { orderBy: { name: "asc" } },
      entities: {
        orderBy: { name: "asc" },
        include: { sections: { orderBy: { key: "asc" } } },
      },
      abilities: {
        orderBy: { name: "asc" },
        include: { events: { orderBy: { evidence: "asc" } } },
      },
      chronicles: { orderBy: [{ chapterIndex: "asc" }, { id: "asc" }] },
      omens: { orderBy: { id: "asc" } },
    },
  });
  const memberships = await prisma.entityMembership.findMany({
    where: { character: { timelineId } },
    orderBy: { id: "asc" },
  });
  return plain({ timeline, memberships });
}

async function fixture() {
  const world = await prisma.world.create({
    data: {
      name: `clone-graph-${crypto.randomUUID()}`,
      genesisInput: "完整现实克隆测试",
      mode: "creator",
      lockedPaths: [],
      operationKind: "rewrite",
      operationToken: "world-lease-must-stay-on-world",
      operationLeaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  const timeline = await prisma.timeline.create({
    data: {
      worldId: world.id,
      branchName: "原初现实",
      branchSummary: "万物仍循旧史",
      realityState: {
        theme: { chronicleName: "星历", rankNames: { nascent: "微光", ascendant: "升格", sovereign: "主宰" }, narratorTerms: { chapter: "卷", chronicle: "史", omen: "兆" } },
        style: { prose: "冷峻", dialogue: "克制", pacing: "舒缓", imagery: ["星尘"] },
        cosmology: { origin: "星海", worldStructure: "环层", transcendentRules: ["名字有重量"], boundaries: ["不可越界"] },
        fusionAxiom: null,
        currentEra: "星历二年",
        establishedFacts: [{ ref: "fact-stars", text: "群星记忆众生", establishedByRewriteId: null }],
      },
      observerState: {
        focusType: "god",
        focusId: null,
        timeLabel: "星历二年",
        viewpoint: "limited",
        activeAvatarId: null,
      },
    },
  });
  const chapterOne = await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 1, title: "初醒", summary: "星火初生", settleState: "settled", snapshot: { weather: "snow" } },
  });
  const chapterTwo = await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 2, title: "结盟", summary: "山民入城", settleState: "open", snapshot: { weather: "clear" } },
  });
  const race = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "race",
      name: "山民",
      aliases: ["岩裔"],
      emblemSeed: "mountain-race",
      summary: "行于峭壁的族群",
      lockedPaths: ["summary"],
      materialRef: `race-${crypto.randomUUID()}`,
    },
  });
  const faction = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "faction",
      name: "观星会",
      aliases: [],
      emblemSeed: "star-watchers",
      summary: "记录群星",
      lockedPaths: [],
      starred: true,
    },
  });
  const avatar = await prisma.entity.create({
    data: {
      timelineId: timeline.id,
      type: "character",
      name: "阿岚",
      aliases: ["行者"],
      emblemSeed: "alan",
      summary: "山民观星者",
      lockedPaths: [],
      raceId: race.id,
      isChosen: true,
      isMajorCharacter: true,
      isCreatorAvatar: true,
      scenePresence: true,
    },
  });
  await prisma.entitySection.createMany({
    data: [
      { entityId: race.id, key: "customs", content: { rites: ["听石"] }, revealed: true },
      { entityId: faction.id, key: "agenda", content: { goal: "绘制星图" }, revealed: false, rumorText: "他们仰望夜空" },
      { entityId: avatar.id, key: "memory", content: { recent: ["雪夜"] }, playerLocked: true },
    ],
  });
  const dawnGod = await prisma.god.create({
    data: {
      timelineId: timeline.id,
      name: "曙光神",
      aliases: ["晨星"],
      tier: "major",
      rank: "ascendant",
      domains: ["光"],
      persona: { temper: "warm" },
      voice: { cadence: "short" },
      agenda: { goal: "照亮群山" },
      agendaRevealed: true,
      relations: {},
      faithScope: "东方",
      codexEntityId: avatar.id,
      materialRef: `god-${crypto.randomUUID()}`,
    },
  });
  const duskGod = await prisma.god.create({
    data: {
      timelineId: timeline.id,
      name: "暮色神",
      aliases: [],
      tier: "minor",
      rank: "nascent",
      domains: ["影"],
      relations: { [dawnGod.id]: { label: "rival", note: "争夺天际" } },
    },
  });
  await prisma.god.update({
    where: { id: dawnGod.id },
    data: { relations: { [duskGod.id]: { label: "neutral", note: "彼此戒备" } } },
  });
  await prisma.timeline.update({
    where: { id: timeline.id },
    data: {
      observerState: {
        focusType: "god",
        focusId: dawnGod.id,
        timeLabel: "星历二年",
        viewpoint: "limited",
        activeAvatarId: avatar.id,
      },
    },
  });
  const messageOne = await prisma.message.create({
    data: {
      chapterId: chapterOne.id,
      index: 0,
      role: "narrator",
      content: "阿岚在雪夜听见山石低语。",
      scale: "scene",
      variants: [{ content: "雪夜有回声", chosen: false }],
      meta: { tags: ["origin"], nested: { untouched: true } },
    },
  });
  const messageTwo = await prisma.message.create({
    data: {
      chapterId: chapterTwo.id,
      index: 0,
      role: "player",
      content: "加入观星会。",
      scale: "years",
      meta: {
        command: "join",
        generationRequest: {
          type: "chat-generation-request",
          chapterId: chapterTwo.id,
          playerMessageId: messageOne.id,
          narratorMessageId: "uncloned-generation-request-id",
        },
      },
    },
  });
  const sourceAbility = await prisma.ability.create({
    data: {
      timelineId: timeline.id,
      entityId: race.id,
      name: "踏岩步",
      kind: "racial_tradition",
      effect: "稳行峭壁",
      trigger: "登山",
      cost: "体力",
      limitations: "仅限岩地",
      mastery: "adept",
      lockedFields: ["effect"],
      materialRef: `ability-${crypto.randomUUID()}`,
    },
  });
  const learnedAbility = await prisma.ability.create({
    data: {
      timelineId: timeline.id,
      entityId: avatar.id,
      sourceAbilityId: sourceAbility.id,
      name: "踏岩步",
      kind: "racial_tradition",
      effect: "稳行峭壁",
      trigger: "登山",
      cost: "体力",
      limitations: "尚不熟练",
      mastery: "novice",
      state: "strained",
      visibility: "rumored",
      rumorText: "步履如风",
      bloodlineJustification: "山民血脉",
      lockedFields: [],
      version: 3,
    },
  });
  await prisma.ability.create({
    data: {
      timelineId: timeline.id,
      godId: dawnGod.id,
      name: "晨曦赐福",
      kind: "divine",
      effect: "驱散阴影",
      trigger: "日出",
      cost: "信仰",
      limitations: "夜间无效",
      mastery: "master",
      lockedFields: [],
    },
  });
  await prisma.entityMembership.create({
    data: { characterId: avatar.id, factionId: faction.id, role: "观星者", isPrimary: true },
  });
  const abilityEvent = await prisma.abilityEvent.create({
    data: {
      abilityId: learnedAbility.id,
      chapterId: chapterOne.id,
      messageId: messageOne.id,
      type: "learned",
      before: { mastery: null },
      after: { mastery: "novice" },
      evidence: "阿岚在雪夜听见山石低语。",
      scale: "scene",
      dedupeKey: `${chapterOne.id}:${learnedAbility.id}:learned:${messageOne.id}`,
    },
  });
  const chronicle = await prisma.chronicleEntry.create({
    data: {
      timelineId: timeline.id,
      chapterIndex: 1,
      yearLabel: "星历元年",
      text: "曙光照见阿岚与山民。",
      entityIds: [avatar.id, race.id, faction.id],
      godIds: [dawnGod.id, duskGod.id],
      revealed: false,
      revealedAtChapter: 2,
      source: "pantheon",
    },
  });
  await prisma.message.update({
    where: { id: messageOne.id },
    data: {
      variants: [{
        content: "雪夜有回声",
        chosen: false,
        meta: {
          abilityReveals: [{ abilityId: learnedAbility.id, evidence: "旧闻" }],
          revealedEventIds: [chronicle.id],
          evidenceEventId: abilityEvent.id,
          linkedEntityId: avatar.id,
          linkedGodId: dawnGod.id,
          chapterId: chapterOne.id,
          messageId: messageOne.id,
        },
      }],
      meta: {
        tags: ["origin"],
        linkedEntityId: avatar.id,
        linkedGodId: dawnGod.id,
        abilityReveals: [{ abilityId: learnedAbility.id, evidence: "旧闻" }],
        revealedEventIds: [chronicle.id],
        evidenceEventId: abilityEvent.id,
        chapterId: chapterOne.id,
        playerMessageId: messageTwo.id,
      },
    },
  });
  await prisma.chapter.update({
    where: { id: chapterOne.id },
    data: {
      snapshot: {
        gods: [{ id: dawnGod.id, relations: { [duskGod.id]: { label: "rival" } } }],
        entities: [{ id: avatar.id, raceId: race.id }],
        pendingSettlement: { evidenceMessageId: messageOne.id, abilityId: learnedAbility.id },
      },
    },
  });
  await prisma.omenQueue.create({
    data: { timelineId: timeline.id, godId: duskGod.id, text: "暮色将遮蔽星图", consumed: false },
  });
  await prisma.generationRequest.create({
    data: {
      id: `generation-${crypto.randomUUID()}`,
      chapterId: chapterTwo.id,
      mode: "creator",
      scale: "scene",
      content: "不得克隆的请求",
      status: "running",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      narratorMessageId: messageTwo.id,
      narratorIndex: 1,
    },
  });
  const rewrite = await prisma.realityRewrite.create({
    data: {
      worldId: world.id,
      sourceTimelineId: timeline.id,
      sourceChapterId: chapterTwo.id,
      decree: "令群星倒流",
      scope: "retroactive",
      status: "applying",
      idempotencyKey: `clone-${crypto.randomUUID()}`,
      leaseToken: "rewrite-task-lease-must-not-be-cloned",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.world.update({ where: { id: world.id }, data: { activeTimelineId: timeline.id } });
  return {
    world, timeline, rewrite, chapterOne, chapterTwo, messageOne, messageTwo,
    dawnGod, duskGod, race, faction, avatar, sourceAbility, learnedAbility,
    abilityEvent, chronicle,
  };
}

describe("cloneTimelineGraph", () => {
  it("两阶段克隆完整时间线图并重映射所有内部引用，不复制请求或租约", async () => {
    const data = await fixture();
    try {
      const before = await sourceGraph(data.timeline.id);
      const leaseBefore = plain(await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } }));
      const rewriteBefore = plain(await prisma.realityRewrite.findUniqueOrThrow({ where: { id: data.rewrite.id } }));

      const result = await prisma.$transaction((tx) => cloneTimelineGraph(tx, {
        sourceTimelineId: data.timeline.id,
        worldId: data.world.id,
        rewriteId: data.rewrite.id,
        branchName: "群星逆流",
        branchSummary: "旧有星轨被重新编织",
      }));

      const after = await sourceGraph(data.timeline.id);
      expect(after).toEqual(before);
      expect(plain(await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } }))).toEqual(leaseBefore);
      expect(plain(await prisma.realityRewrite.findUniqueOrThrow({ where: { id: data.rewrite.id } }))).toEqual(rewriteBefore);
      expect(await prisma.realityRewrite.count({ where: { worldId: data.world.id } })).toBe(1);

      const cloned = await sourceGraph(result.timelineId);
      expect(cloned.timeline).toMatchObject({
        id: result.timelineId,
        worldId: data.world.id,
        parentId: data.timeline.id,
        forkChapter: data.chapterTwo.index,
        forkRewriteId: data.rewrite.id,
        branchName: "群星逆流",
        branchSummary: "旧有星轨被重新编织",
        realityState: before.timeline.realityState,
      });
      expect(cloned.timeline.id).not.toBe(data.timeline.id);
      expect(cloned.timeline.realityState).not.toBe(before.timeline.realityState);
      expect(cloned.timeline.observerState).toMatchObject({
        focusId: result.maps.godIds.get(data.dawnGod.id),
        activeAvatarId: result.maps.entityIds.get(data.avatar.id),
      });
      expect(cloned.timeline.chapters).toHaveLength(2);
      expect(cloned.timeline.gods).toHaveLength(2);
      expect(cloned.timeline.entities).toHaveLength(3);
      expect(cloned.timeline.abilities).toHaveLength(3);
      expect(cloned.timeline.chronicles).toHaveLength(1);
      expect(cloned.timeline.omens).toHaveLength(1);
      expect(cloned.memberships).toHaveLength(1);
      expect(result.maps.chapterIds.size).toBe(2);
      expect(result.maps.messageIds.size).toBe(2);
      expect(result.maps.godIds.size).toBe(2);
      expect(result.maps.entityIds.size).toBe(3);
      expect(result.maps.abilityIds.size).toBe(3);
      expect(cloned.timeline.chapters.every((row) => row.timelineId === result.timelineId)).toBe(true);
      expect(cloned.timeline.gods.every((row) => row.timelineId === result.timelineId)).toBe(true);
      expect(cloned.timeline.entities.every((row) => row.timelineId === result.timelineId)).toBe(true);
      expect(cloned.timeline.abilities.every((row) => row.timelineId === result.timelineId)).toBe(true);
      expect(cloned.timeline.chronicles.every((row) => row.timelineId === result.timelineId)).toBe(true);
      expect(cloned.timeline.omens.every((row) => row.timelineId === result.timelineId)).toBe(true);
      expect(cloned.timeline.entities.every((entity) =>
        entity.sections.every((section) => section.entityId === entity.id)
      )).toBe(true);

      const expectDisjointIds = (sourceRows: Array<{ id: string }>, clonedRows: Array<{ id: string }>) => {
        const sourceIds = new Set(sourceRows.map((row) => row.id));
        expect(clonedRows.every((row) => !sourceIds.has(row.id))).toBe(true);
      };
      expectDisjointIds(before.timeline.chapters, cloned.timeline.chapters);
      expectDisjointIds(
        before.timeline.chapters.flatMap((chapter) => chapter.messages),
        cloned.timeline.chapters.flatMap((chapter) => chapter.messages),
      );
      expectDisjointIds(before.timeline.gods, cloned.timeline.gods);
      expectDisjointIds(before.timeline.entities, cloned.timeline.entities);
      expectDisjointIds(
        before.timeline.entities.flatMap((entity) => entity.sections),
        cloned.timeline.entities.flatMap((entity) => entity.sections),
      );
      expectDisjointIds(before.timeline.abilities, cloned.timeline.abilities);
      expectDisjointIds(
        before.timeline.abilities.flatMap((ability) => ability.events),
        cloned.timeline.abilities.flatMap((ability) => ability.events),
      );
      expectDisjointIds(before.memberships, cloned.memberships);
      expectDisjointIds(before.timeline.chronicles, cloned.timeline.chronicles);
      expectDisjointIds(before.timeline.omens, cloned.timeline.omens);

      for (const sourceChapter of before.timeline.chapters) {
        const chapter = cloned.timeline.chapters.find((item) => item.index === sourceChapter.index)!;
        expect(chapter.id).toBe(result.maps.chapterIds.get(sourceChapter.id));
        expect(chapter.id).not.toBe(sourceChapter.id);
        expect(chapter.timelineId).toBe(result.timelineId);
        expect(chapter.generationRequests).toEqual([]);
        for (const sourceMessage of sourceChapter.messages) {
          const message = chapter.messages.find((item) => item.index === sourceMessage.index)!;
          expect(message.id).toBe(result.maps.messageIds.get(sourceMessage.id));
          expect(message.id).not.toBe(sourceMessage.id);
          expect(message.chapterId).toBe(chapter.id);
          expect(message.meta).not.toHaveProperty("generationRequest");
          expect(message.meta).not.toHaveProperty("realityOrigin");
          expect(message.meta).not.toHaveProperty("previousReality");
          expect(message.meta).not.toHaveProperty("sourceMessageId");
        }
      }

      const clonedChapterOne = cloned.timeline.chapters.find((item) => item.index === 1)!;
      const clonedMessageOne = clonedChapterOne.messages.find((item) => item.index === 0)!;
      const clonedMessageTwo = cloned.timeline.chapters.find((item) => item.index === 2)!.messages[0]!;
      expect(clonedChapterOne.snapshot).toMatchObject({
        gods: [{ id: result.maps.godIds.get(data.dawnGod.id) }],
        entities: [{ id: result.maps.entityIds.get(data.avatar.id), raceId: result.maps.entityIds.get(data.race.id) }],
        pendingSettlement: {
          evidenceMessageId: result.maps.messageIds.get(data.messageOne.id),
          abilityId: result.maps.abilityIds.get(data.learnedAbility.id),
        },
      });
      expect(clonedMessageOne.meta).toMatchObject({
        linkedEntityId: result.maps.entityIds.get(data.avatar.id),
        linkedGodId: result.maps.godIds.get(data.dawnGod.id),
        abilityReveals: [{ abilityId: result.maps.abilityIds.get(data.learnedAbility.id) }],
        chapterId: result.maps.chapterIds.get(data.chapterOne.id),
        playerMessageId: result.maps.messageIds.get(data.messageTwo.id),
      });
      expect(clonedMessageTwo.meta).not.toHaveProperty("generationRequest");
      expect(clonedMessageOne.variants).toMatchObject([{
        meta: {
          linkedEntityId: result.maps.entityIds.get(data.avatar.id),
          linkedGodId: result.maps.godIds.get(data.dawnGod.id),
          abilityReveals: [{ abilityId: result.maps.abilityIds.get(data.learnedAbility.id) }],
          chapterId: result.maps.chapterIds.get(data.chapterOne.id),
          messageId: result.maps.messageIds.get(data.messageOne.id),
        },
      }]);

      const clonedRace = cloned.timeline.entities.find((item) => item.name === data.race.name)!;
      const clonedFaction = cloned.timeline.entities.find((item) => item.name === data.faction.name)!;
      const clonedAvatar = cloned.timeline.entities.find((item) => item.name === data.avatar.name)!;
      expect(clonedAvatar.raceId).toBe(clonedRace.id);
      expect(clonedAvatar.id).toBe(result.maps.entityIds.get(data.avatar.id));
      expect(cloned.timeline.entities.flatMap((item) => item.sections).map((item) => item.id))
        .not.toEqual(expect.arrayContaining(before.timeline.entities.flatMap((item) => item.sections).map((item) => item.id)));

      const clonedDawn = cloned.timeline.gods.find((item) => item.name === data.dawnGod.name)!;
      const clonedDusk = cloned.timeline.gods.find((item) => item.name === data.duskGod.name)!;
      expect(clonedDawn.id).toBe(result.maps.godIds.get(data.dawnGod.id));
      expect(clonedDawn.codexEntityId).toBe(clonedAvatar.id);
      expect(clonedDawn.relations).toEqual({ [clonedDusk.id]: { label: "neutral", note: "彼此戒备" } });
      expect(clonedDusk.relations).toEqual({ [clonedDawn.id]: { label: "rival", note: "争夺天际" } });

      const clonedSourceAbility = cloned.timeline.abilities.find((item) => item.entityId === clonedRace.id)!;
      const clonedLearnedAbility = cloned.timeline.abilities.find((item) => item.entityId === clonedAvatar.id)!;
      const clonedGodAbility = cloned.timeline.abilities.find((item) => item.godId !== null)!;
      expect(clonedGodAbility.godId).toBe(clonedDawn.id);
      expect(clonedSourceAbility.id).toBe(result.maps.abilityIds.get(data.sourceAbility.id));
      expect(clonedLearnedAbility.sourceAbilityId).toBe(clonedSourceAbility.id);
      expect(clonedLearnedAbility.events).toHaveLength(1);
      expect(clonedLearnedAbility.events[0]).toMatchObject({
        abilityId: clonedLearnedAbility.id,
        chapterId: result.maps.chapterIds.get(before.timeline.chapters[0]!.id),
        messageId: result.maps.messageIds.get(before.timeline.chapters[0]!.messages[0]!.id),
        evidence: "阿岚在雪夜听见山石低语。",
      });
      expect(clonedLearnedAbility.events[0]!.id).not.toBe(before.timeline.abilities.find((item) => item.id === data.learnedAbility.id)!.events[0]!.id);
      expect(clonedLearnedAbility.events[0]!.dedupeKey).toBe([
        result.maps.chapterIds.get(before.timeline.chapters[0]!.id),
        clonedLearnedAbility.id,
        "learned",
        result.maps.messageIds.get(before.timeline.chapters[0]!.messages[0]!.id),
      ].join(":"));

      expect(cloned.memberships[0]).toMatchObject({ characterId: clonedAvatar.id, factionId: clonedFaction.id, role: "观星者" });
      expect(cloned.memberships[0]!.id).not.toBe(before.memberships[0]!.id);
      expect(cloned.timeline.chronicles[0]).toMatchObject({
        entityIds: [clonedAvatar.id, clonedRace.id, clonedFaction.id],
        godIds: [clonedDawn.id, clonedDusk.id],
      });
      expect(cloned.timeline.chronicles[0]!.id).not.toBe(before.timeline.chronicles[0]!.id);
      expect(cloned.timeline.omens[0]).toMatchObject({ godId: clonedDusk.id, text: "暮色将遮蔽星图" });
      expect(cloned.timeline.omens[0]!.id).not.toBe(before.timeline.omens[0]!.id);
    } finally {
      await prisma.world.delete({ where: { id: data.world.id } });
    }
  });

  it("必需的源时间线引用没有映射时直接抛错并回滚子分支", async () => {
    const world = await prisma.world.create({
      data: { name: `clone-dangling-${crypto.randomUUID()}`, genesisInput: "test", mode: "creator", lockedPaths: [] },
    });
    try {
      const timeline = await prisma.timeline.create({ data: { worldId: world.id } });
      const chapter = await prisma.chapter.create({ data: { timelineId: timeline.id, index: 1 } });
      await prisma.god.create({
        data: {
          timelineId: timeline.id,
          name: "孤神",
          aliases: [],
          tier: "major",
          domains: [],
          relations: { "missing-source-god": { label: "rival" } },
        },
      });
      const rewrite = await prisma.realityRewrite.create({
        data: {
          worldId: world.id,
          sourceTimelineId: timeline.id,
          sourceChapterId: chapter.id,
          decree: "测试悬空引用",
          idempotencyKey: `dangling-${crypto.randomUUID()}`,
        },
      });

      await expect(prisma.$transaction((tx) => cloneTimelineGraph(tx, {
        sourceTimelineId: timeline.id,
        worldId: world.id,
        rewriteId: rewrite.id,
        branchName: "悬空现实",
        branchSummary: "不应创建",
      }))).rejects.toThrow(/missing-source-god/);
      expect(await prisma.timeline.count({ where: { worldId: world.id } })).toBe(1);
    } finally {
      await prisma.world.delete({ where: { id: world.id } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
