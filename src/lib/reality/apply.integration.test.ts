import { afterAll, describe, expect, it } from "vitest";
import type { RewritePlan } from "./schemas";
import { RewritePlanSchema } from "./schemas";
import { applyRewritePlan } from "./apply";
import { cloneTimelineGraph } from "./clone";

const { prisma } = await import("@/lib/db");

const createdWorldIds: string[] = [];

function plan(overrides: Partial<RewritePlan> = {}): RewritePlan {
  return RewritePlanSchema.parse({
    scope: "prospective",
    interpretation: "星轨依照敕令重排",
    effectivePoint: "星历二年",
    branchName: "群星重排新纪",
    realityCardPatches: [],
    godPatches: [],
    entityPatches: [],
    abilityPatches: [],
    chroniclePatches: [],
    memoryPatches: [],
    causalConsequences: ["众生将看见新的星轨"],
    narrationFocus: "新星第一次升起",
    subcommands: [{ decree: "重排群星", scope: "prospective", effectivePoint: "星历二年" }],
    ...overrides,
  });
}

async function fixture() {
  const world = await prisma.world.create({
    data: {
      userId: "test-user", name: `apply-${crypto.randomUUID()}`,
      genesisInput: "现实应用测试",
      mode: "creator",
      lockedPaths: [],
    },
  });
  createdWorldIds.push(world.id);
  const timeline = await prisma.timeline.create({
    data: {
      worldId: world.id,
      branchName: "测试现实分支",
      realityState: {
        theme: {
          eraSystem: "星历",
          rankNames: {
            fallen: "陨灭", ember: "余烬", slumbering: "沉睡", nascent: "微末",
            ascended: "成神", exalted: "显赫", sovereign: "主宰",
          },
          typeNames: {
            faction: "势力", character: "人物", race: "种族",
            place: "地点", artifact: "造物", cult: "教团",
          },
          addressStyle: "古雅",
        },
        style: { preset: "epic", presetName: "史诗", toneNotes: "冷峻" },
        cosmology: { origin: "星海", powerSystem: "星辉", laws: "星轨不可逆", divinity: "信仰凝聚神格" },
        fusionAxiom: null,
        currentEra: "星历二年",
        establishedFacts: [],
      },
      observerState: {
        focusType: "world",
        focusId: null,
        timeLabel: "星历二年",
        viewpoint: "omniscient",
        activeAvatarId: null,
      },
    },
  });
  const chapter = await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 2, title: "旧星", summary: "旧史仍在", settleState: "settled" },
  });
  const message = await prisma.message.create({
    data: { chapterId: chapter.id, index: 0, role: "narrator", content: "旧王在星空下加冕。", meta: { preserved: true } },
  });
  const race = await prisma.entity.create({
    data: {
      timelineId: timeline.id, type: "race", name: "星民", aliases: [], emblemSeed: "race",
      summary: "仰望群星的族群", lockedPaths: [],
    },
  });
  const faction = await prisma.entity.create({
    data: {
      timelineId: timeline.id, type: "faction", name: "观星会", aliases: [], emblemSeed: "faction",
      summary: "记录星轨", lockedPaths: [],
    },
  });
  const character = await prisma.entity.create({
    data: {
      timelineId: timeline.id, type: "character", name: "司星者", aliases: [], emblemSeed: "character",
      summary: "记得旧星", lockedPaths: [], raceId: race.id,
    },
  });
  await prisma.entityMembership.create({
    data: { characterId: character.id, factionId: faction.id, role: "司录", isPrimary: true },
  });
  const god = await prisma.god.create({
    data: {
      timelineId: timeline.id, name: "旧星神", aliases: [], tier: "major", rank: "ascended",
      domains: ["星辰"], relations: {},
    },
  });
  const raceAbility = await prisma.ability.create({
    data: {
      timelineId: timeline.id, entityId: race.id, name: "辨星", kind: "racial_tradition",
      effect: "辨认星位", trigger: "仰望", cost: "无", limitations: "阴天无效",
      mastery: "adept", lockedFields: [],
    },
  });
  const chronicle = await prisma.chronicleEntry.create({
    data: {
      timelineId: timeline.id, chapterIndex: 2, yearLabel: "星历二年", text: "旧星神照耀观星会。",
      entityIds: [race.id, faction.id, character.id], godIds: [god.id], revealed: true, source: "narrative",
    },
  });
  const rewrite = await prisma.realityRewrite.create({
    data: {
      worldId: world.id, sourceTimelineId: timeline.id, sourceChapterId: chapter.id,
      decree: "重排群星", scope: "prospective", status: "applying",
      idempotencyKey: `apply-${crypto.randomUUID()}`,
    },
  });
  await prisma.world.update({ where: { id: world.id }, data: { activeTimelineId: timeline.id } });
  return { world, timeline, chapter, message, race, faction, character, god, raceAbility, chronicle, rewrite };
}

async function apply(data: Awaited<ReturnType<typeof fixture>>, rewritePlan: RewritePlan) {
  return prisma.$transaction((tx) => applyRewritePlan(tx, {
    worldId: data.world.id,
    timelineId: data.timeline.id,
    rewriteId: data.rewrite.id,
    plan: rewritePlan,
  }));
}

afterAll(async () => {
  if (createdWorldIds.length > 0) {
    await prisma.world.deleteMany({ where: { id: { in: createdWorldIds } } });
  }
  await prisma.$disconnect();
});

describe("applyRewritePlan", () => {
  it("按固定阶段应用未来现实卡与实体更新，并建立可见改写编年史", async () => {
    const data = await fixture();
    const result = await apply(data, plan({
      realityCardPatches: [
        { section: "currentEra", value: "新星元年" },
        { section: "cosmology", value: { origin: "星海", powerSystem: "双星辉", laws: "新星可逆", divinity: "神格源自星名" } },
      ],
      entityPatches: [{ op: "update", targetId: data.character.id, changes: { summary: "见证新星的司星者" } }],
    }));

    expect(result).toEqual({ summary: "星轨依照敕令重排", consequenceLines: ["众生将看见新的星轨"] });
    const timeline = await prisma.timeline.findUniqueOrThrow({ where: { id: data.timeline.id } });
    expect(timeline.realityState).toMatchObject({ currentEra: "新星元年", cosmology: { laws: "新星可逆" } });
    expect(await prisma.entity.findUniqueOrThrow({ where: { id: data.character.id } })).toMatchObject({ summary: "见证新星的司星者" });
    expect(await prisma.chronicleEntry.findFirstOrThrow({
      where: { timelineId: data.timeline.id, source: "rewrite" },
      orderBy: { createdAt: "desc" },
    })).toMatchObject({ text: "星轨依照敕令重排", revealed: true, chapterIndex: 2 });
  });

  it("为规划器新增的既定事实补充当前改写来源", async () => {
    const data = await fixture();

    await apply(data, plan({
      realityCardPatches: [{
        section: "establishedFacts",
        value: [{ ref: "fact-new-stars", text: "新星自此照耀北境" }],
      }],
    }));

    expect(await prisma.timeline.findUniqueOrThrow({
      where: { id: data.timeline.id },
      select: { realityState: true },
    })).toMatchObject({
      realityState: {
        establishedFacts: [{
          ref: "fact-new-stars",
          text: "新星自此照耀北境",
          establishedByRewriteId: data.rewrite.id,
        }],
      },
    });
  });

  it("追溯改写保留旧消息正文并标注前现实，同时创建重写后历史摘要", async () => {
    const data = await fixture();
    const obsolete = await prisma.entity.create({
      data: {
        timelineId: data.timeline.id, type: "place", name: "旧王宫", aliases: [], emblemSeed: "old-palace",
        summary: "已经消失", lockedPaths: [],
      },
    });

    await apply(data, plan({
      scope: "retroactive",
      subcommands: [{ decree: "旧王宫从未存在", scope: "retroactive", effectivePoint: "世界之初" }],
      effectivePoint: "世界之初",
      interpretation: "历史中从来只有群星议庭",
      entityPatches: [
        { op: "remove", targetId: obsolete.id },
        {
          op: "create", tempRef: "new-star-court", value: {
            type: "place", name: "群星议庭", aliases: [], summary: "自古存在的议庭", raceRef: null,
            heat: "active", isMajorCharacter: false, isCreatorAvatar: false, sections: [],
          },
        },
      ],
    }));

    expect(await prisma.entity.findUnique({ where: { id: obsolete.id } })).toBeNull();
    expect(await prisma.entity.findFirst({ where: { timelineId: data.timeline.id, name: "群星议庭" } })).not.toBeNull();
    expect(await prisma.message.findUniqueOrThrow({ where: { id: data.message.id } })).toMatchObject({
      content: "旧王在星空下加冕。",
      meta: { preserved: true, previousReality: true },
    });
    expect(await prisma.chronicleEntry.findFirstOrThrow({
      where: { timelineId: data.timeline.id, source: "rewrite", text: "历史中从来只有群星议庭" },
    })).toMatchObject({ revealed: true });
  });

  it("纯 memory_only 携带客观补丁时在写入前 fail closed", async () => {
    const data = await fixture();
    const beforeTimeline = await prisma.timeline.findUniqueOrThrow({ where: { id: data.timeline.id } });

    const invalidPlan = {
      ...plan({
        scope: "memory_only",
        subcommands: [{ decree: "司星者忘记旧王", scope: "memory_only", effectivePoint: "此刻记忆" }],
        memoryPatches: [{ entityId: data.character.id, operation: "replace", text: "只记得群星议庭" }],
      }),
      realityCardPatches: [{ section: "currentEra", value: "不应写入的伪造纪元" }],
      entityPatches: [{ op: "remove", targetId: data.character.id }],
    } as unknown as RewritePlan;

    await expect(apply(data, invalidPlan)).rejects.toThrow(/memory_only|客观/);

    expect(await prisma.timeline.findUniqueOrThrow({ where: { id: data.timeline.id } })).toMatchObject({
      realityState: beforeTimeline.realityState,
    });
    expect(await prisma.entity.findUnique({ where: { id: data.character.id } })).not.toBeNull();
    expect(await prisma.entitySection.findUnique({
      where: { entityId_key: { entityId: data.character.id, key: "memory" } },
    })).toBeNull();
  });

  it("memory_only 只写主体记忆与神明议程，不改变客观编年史", async () => {
    const data = await fixture();
    const before = await prisma.chronicleEntry.findMany({ where: { timelineId: data.timeline.id }, orderBy: { id: "asc" } });

    await apply(data, plan({
      scope: "memory_only",
      subcommands: [{ decree: "司星者忘记旧王", scope: "memory_only", effectivePoint: "此刻记忆" }],
      memoryPatches: [{ entityId: data.character.id, operation: "replace", text: "只记得群星议庭" }],
      godPatches: [{ op: "update", targetId: data.god.id, changes: { agenda: { belief: "旧王从未存在" } } }],
    }));

    expect(await prisma.chronicleEntry.findMany({ where: { timelineId: data.timeline.id }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.entitySection.findUniqueOrThrow({
      where: { entityId_key: { entityId: data.character.id, key: "memory" } },
    })).toMatchObject({ content: { text: "只记得群星议庭" } });
    expect(await prisma.god.findUniqueOrThrow({ where: { id: data.god.id } })).toMatchObject({
      agenda: { belief: "旧王从未存在" },
    });
  });

  it("通过 tempRef 解析新神、实体与能力的交叉关系", async () => {
    const data = await fixture();
    await apply(data, plan({
      godPatches: [{
        op: "create", tempRef: "new-guiding-god", value: {
          name: "引星神", aliases: [], tier: "major", rank: "ascended", domains: ["引航"],
          persona: null, voice: null, agenda: { goal: "引导新族" },
          relations: [{ targetRef: data.god.id, label: "ally", note: "共同守望" }], faithScope: "星海",
        },
      }],
      entityPatches: [
        {
          op: "create", tempRef: "new-race", value: {
            type: "race", name: "引星族", aliases: [], summary: "追随星光", raceRef: null,
            heat: "active", isMajorCharacter: false, isCreatorAvatar: false, sections: [],
          },
        },
        {
          op: "create", tempRef: "new-character", value: {
            type: "character", name: "引星者", aliases: [], summary: "新族引路人", raceRef: "new-race",
            heat: "active", isMajorCharacter: true, isCreatorAvatar: false, sections: [],
          },
        },
      ],
      abilityPatches: [
        {
          op: "create", tempRef: "new-race-sight", ownerRef: "new-race", value: {
            name: "引星目", kind: "racial_innate", effect: "看见星路", trigger: "夜晚", cost: "无",
            limitations: "白昼失效", mastery: "adept", state: "normal", visibility: "known",
            rumorText: null, bloodlineJustification: null, sourceAbilityRef: null, lockedFields: [],
          },
        },
        {
          op: "create", tempRef: "new-character-sight", ownerRef: "new-character", value: {
            name: "引星目", kind: "racial_innate", effect: "看见星路", trigger: "夜晚", cost: "无",
            limitations: "尚未熟练", mastery: "novice", state: "normal", visibility: "known",
            rumorText: null, bloodlineJustification: null, sourceAbilityRef: "new-race-sight", lockedFields: [],
          },
        },
        {
          op: "create", tempRef: "new-divine-guide", ownerRef: "new-guiding-god", value: {
            name: "星路指引", kind: "divine", effect: "指明方向", trigger: "祈祷", cost: "信仰",
            limitations: "不改变命运", mastery: "master", state: "normal", visibility: "known",
            rumorText: null, bloodlineJustification: null, sourceAbilityRef: null, lockedFields: [],
          },
        },
      ],
    }));

    const race = await prisma.entity.findFirstOrThrow({ where: { timelineId: data.timeline.id, name: "引星族" } });
    const character = await prisma.entity.findFirstOrThrow({ where: { timelineId: data.timeline.id, name: "引星者" } });
    const god = await prisma.god.findFirstOrThrow({ where: { timelineId: data.timeline.id, name: "引星神" } });
    const source = await prisma.ability.findFirstOrThrow({ where: { timelineId: data.timeline.id, entityId: race.id, name: "引星目" } });
    expect(character.raceId).toBe(race.id);
    expect(god.relations).toMatchObject({ [data.god.id]: { label: "ally", note: "共同守望" } });
    expect(await prisma.ability.findFirstOrThrow({ where: { timelineId: data.timeline.id, entityId: character.id } })).toMatchObject({ sourceAbilityId: source.id });
    expect(await prisma.ability.findFirstOrThrow({ where: { timelineId: data.timeline.id, godId: god.id } })).toMatchObject({ kind: "divine" });
  });

  it.each(["race", "membership"] as const)("拒绝删除仍被未修补 %s 引用的实体并回滚先前写入", async (dependency) => {
    const data = await fixture();
    const targetId = dependency === "race" ? data.race.id : data.faction.id;
    await expect(apply(data, plan({
      realityCardPatches: [{ section: "currentEra", value: "不应提交的纪元" }],
      entityPatches: [{ op: "remove", targetId }],
    }))).rejects.toThrow(/引用|成员|种族/);

    expect(await prisma.entity.findUnique({ where: { id: targetId } })).not.toBeNull();
    expect(await prisma.timeline.findUniqueOrThrow({ where: { id: data.timeline.id } })).toMatchObject({
      realityState: { currentEra: "星历二年" },
    });
  });

  it.each([
    { isPlayer: true, tier: "major" },
    { tier: "player" },
  ])("creator 模式拒绝创建玩家神：$tier/$isPlayer", async (forbidden) => {
    const data = await fixture();
    const invalid = {
      ...plan(),
      godPatches: [{
        op: "create", tempRef: "forbidden-player-god", value: {
          name: "玩家神", aliases: [], rank: "ascended", domains: [], persona: null, voice: null,
          agenda: null, relations: [], faithScope: null, ...forbidden,
        },
      }],
    } as unknown as RewritePlan;
    await expect(apply(data, invalid)).rejects.toThrow();
    expect(await prisma.god.findFirst({ where: { timelineId: data.timeline.id, name: "玩家神" } })).toBeNull();
  });

  it("可将计划应用到由 rewrite 克隆出的结果时间线", async () => {
    const data = await fixture();
    const childId = await prisma.$transaction(async (tx) => {
      const child = await cloneTimelineGraph(tx, {
        sourceTimelineId: data.timeline.id,
        worldId: data.world.id,
        rewriteId: data.rewrite.id,
        branchName: "新现实分支",
        branchSummary: "克隆后应用",
      });
      await applyRewritePlan(tx, {
        worldId: data.world.id,
        timelineId: child.timelineId,
        rewriteId: data.rewrite.id,
        plan: plan({ realityCardPatches: [{ section: "currentEra", value: "克隆新纪" }] }),
      });
      return child.timelineId;
    });

    expect(await prisma.timeline.findUniqueOrThrow({ where: { id: childId } })).toMatchObject({
      parentId: data.timeline.id,
      realityState: { currentEra: "克隆新纪" },
    });
    expect(await prisma.timeline.findUniqueOrThrow({ where: { id: data.timeline.id } })).toMatchObject({
      realityState: { currentEra: "星历二年" },
    });
  });
  it("拒绝把另一时间线的 existing ID 当成本时间线目标", async () => {
    const data = await fixture();
    const other = await fixture();
    await expect(apply(data, plan({
      entityPatches: [{ op: "update", targetId: other.character.id, changes: { summary: "越界" } }],
    }))).rejects.toThrow(/时间线|不存在/);
    expect(await prisma.entity.findUniqueOrThrow({ where: { id: other.character.id } })).toMatchObject({ summary: "记得旧星" });
  });

  it("按议程后的固定阶段创建、更新、删除征兆并应用 tempRef 观察状态", async () => {
    const data = await fixture();
    const updatedOmen = await prisma.omenQueue.create({
      data: { timelineId: data.timeline.id, godId: data.god.id, text: "旧星将落", consumed: false },
    });
    const removedOmen = await prisma.omenQueue.create({
      data: { timelineId: data.timeline.id, godId: data.god.id, text: "此兆将被抹除", consumed: false },
    });

    await apply(data, plan({
      godPatches: [{
        op: "create",
        tempRef: "new-omen-god",
        value: {
          name: "新兆神", aliases: [], tier: "minor", rank: "nascent", domains: ["征兆"],
          persona: null, voice: null, agenda: { goal: "守望新兆" }, relations: [], faithScope: null,
        },
      }],
      entityPatches: [{
        op: "create",
        tempRef: "new-observer-avatar",
        value: {
          type: "character", name: "天外行者", aliases: [], summary: "创世主的新化身",
          raceRef: null, heat: "active", isMajorCharacter: true, isCreatorAvatar: true,
          sections: [],
        },
      }],
      omenPatches: [
        {
          op: "create", tempRef: "new-star-omen",
          value: { godRef: "new-omen-god", text: "新星即将升起", consumed: false },
        },
        {
          op: "update", targetId: updatedOmen.id,
          changes: { godRef: "new-omen-god", text: "旧星已落", consumed: true },
        },
        { op: "remove", targetId: removedOmen.id },
      ],
      observerPatch: {
        focus: { focusType: "avatar", focusRef: "new-observer-avatar" },
        viewpoint: "limited",
        activeAvatarRef: "new-observer-avatar",
      },
    }));

    const newGod = await prisma.god.findFirstOrThrow({
      where: { timelineId: data.timeline.id, name: "新兆神" },
    });
    const avatar = await prisma.entity.findFirstOrThrow({
      where: { timelineId: data.timeline.id, name: "天外行者" },
    });
    expect(await prisma.omenQueue.findUniqueOrThrow({ where: { id: updatedOmen.id } })).toMatchObject({
      godId: newGod.id, text: "旧星已落", consumed: true,
    });
    expect(await prisma.omenQueue.findFirstOrThrow({
      where: { timelineId: data.timeline.id, text: "新星即将升起" },
    })).toMatchObject({ godId: newGod.id, consumed: false });
    expect(await prisma.omenQueue.findUnique({ where: { id: removedOmen.id } })).toBeNull();
    expect(await prisma.timeline.findUniqueOrThrow({ where: { id: data.timeline.id } })).toMatchObject({
      observerState: {
        focusType: "avatar", focusId: avatar.id, viewpoint: "limited",
        activeAvatarId: avatar.id, timeLabel: "星历二年",
      },
    });
  });

  it("允许通过同一计划修复待删除神明的征兆与观察引用", async () => {
    const data = await fixture();
    const omen = await prisma.omenQueue.create({
      data: { timelineId: data.timeline.id, godId: data.god.id, text: "旧神仍在", consumed: false },
    });
    await prisma.timeline.update({
      where: { id: data.timeline.id },
      data: { observerState: {
        focusType: "god", focusId: data.god.id, timeLabel: "星历二年",
        viewpoint: "omniscient", activeAvatarId: null,
      } },
    });

    await apply(data, plan({
      godPatches: [{ op: "remove", targetId: data.god.id }],
      chroniclePatches: [{ op: "update", targetId: data.chronicle.id, changes: { godRefs: [] } }],
      omenPatches: [{ op: "remove", targetId: omen.id }],
      observerPatch: { focus: { focusType: "world", focusRef: null } },
    }));

    expect(await prisma.god.findUnique({ where: { id: data.god.id } })).toBeNull();
    expect(await prisma.omenQueue.findUnique({ where: { id: omen.id } })).toBeNull();
    expect(await prisma.timeline.findUniqueOrThrow({ where: { id: data.timeline.id } })).toMatchObject({
      observerState: { focusType: "world", focusId: null },
    });
  });

  it.each([
    ["普通实体", (data: Awaited<ReturnType<typeof fixture>>) => data.character.id],
    ["跨时间线实体", (data: Awaited<ReturnType<typeof fixture>>, other: Awaited<ReturnType<typeof fixture>>) => other.character.id],
  ])("拒绝把%s设为活动创世主化身并回滚征兆", async (_label, target) => {
    const data = await fixture();
    const other = await fixture();
    await expect(apply(data, plan({
      omenPatches: [{
        op: "create", tempRef: "rollback-omen",
        value: { godRef: data.god.id, text: "不应落库", consumed: false },
      }],
      observerPatch: { activeAvatarRef: target(data, other) },
    }))).rejects.toThrow(/化身|时间线|不存在/);
    expect(await prisma.omenQueue.findFirst({
      where: { timelineId: data.timeline.id, text: "不应落库" },
    })).toBeNull();
  });
});
