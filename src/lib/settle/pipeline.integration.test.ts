import { afterAll, describe, expect, it, vi } from "vitest";

const responses = vi.hoisted(() => ({
  extract: {} as Record<string, unknown>,
  extractHandler: undefined as undefined | ((user: string) => Record<string, unknown>),
  worldActivity: {
    mergeActivityIds: [],
    eventMutations: [],
  } as Record<string, unknown>,
  modelDelayMs: 0,
  beforeModelResponse: undefined as undefined | (() => void | Promise<void>),
}));
vi.mock("@/lib/llm/structured", () => ({
  completeStructured: vi.fn(async (_slot: string, request: { task: string; user: string }) => {
    await responses.beforeModelResponse?.();
    if (responses.modelDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, responses.modelDelayMs));
    if (request.task !== "settlement") throw new Error(`unexpected ${request.task}`);
    return {
      pantheonTurns: [],
      extraction: responses.extractHandler?.(request.user) ?? responses.extract,
      chronicle: {
        entries: [{ yearLabel: "元年", text: "阿岚习得踏岩步。", entityNames: ["阿岚"], godNames: [] }],
        epilogue: "传承已续。",
        chapterTitle: "石阶传承",
      },
      worldActivity: responses.worldActivity,
    };
  }),
}));

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
const { prisma } = await import("@/lib/db");
const { settleChapter } = await import("./pipeline");

async function fixture() {
  const world = await prisma.world.create({ data: { name: `settle-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [] } });
  const timeline = await prisma.timeline.create({ data: { worldId: world.id } });
  await prisma.world.update({ where: { id: world.id }, data: { activeTimelineId: timeline.id, status: "playing" } });
  const race = await prisma.entity.create({ data: { timelineId: timeline.id, type: "race", name: "山民", aliases: [], emblemSeed: "race", summary: "山地族群", lockedPaths: [] } });
  const character = await prisma.entity.create({ data: { timelineId: timeline.id, type: "character", name: "阿岚", aliases: [], emblemSeed: "alan", summary: "山民学徒", lockedPaths: [], raceId: race.id } });
  const source = await prisma.ability.create({ data: { timelineId: timeline.id, entityId: race.id, name: "踏岩步", kind: "racial_tradition", effect: "稳行峭壁", trigger: "山路", cost: "体力", limitations: "仅适于岩地", mastery: "adept", state: "normal", visibility: "known", lockedFields: [] } });
  const chapter = await prisma.chapter.create({ data: { timelineId: timeline.id, index: 1 } });
  const message = await prisma.message.create({ data: { chapterId: chapter.id, index: 7, role: "narrator", content: "阿岚走完断崖石阶，并正式获授踏岩步的传承石符。", scale: "scene" } });
  responses.extract = {
    newEntities: [], entityUpdates: [], godUpdates: [], revealSections: [],
    abilityChanges: [{ ownerName: "阿岚", sourceAbilityId: source.id, type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 7, evidence: "阿岚走完断崖石阶，并正式获授踏岩步的传承石符" }],
  };
  return { world, timeline, race, character, source, chapter, message };
}

async function settle(id: string) { for await (const _progress of settleChapter(id)) void _progress; }

describe("章末 pipeline 习得族群技艺", () => {
  it("保存章节、正文消息和尺度，重跑 dedupe 不重复习得", async () => {
    const data = await fixture();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await settle(data.chapter.id);
      await prisma.chapter.update({ where: { id: data.chapter.id }, data: { settleState: "settling:extract" } });
      await settle(data.chapter.id);
      const learned = await prisma.ability.findFirst({ where: { entityId: data.character.id, sourceAbilityId: data.source.id } });
      const events = await prisma.abilityEvent.findMany({ where: { abilityId: learned?.id } });
      expect(learned).toMatchObject({ mastery: "novice", version: 2 });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ chapterId: data.chapter.id, messageId: data.message.id, scale: "scene", type: "learned" });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await prisma.world.delete({ where: { id: data.world.id } });
    }
  });

  it("同一次整理合并重复动态、升级事件并在断点重跑时保持幂等", async () => {
    const data = await fixture();
    const first = await prisma.worldActivity.create({
      data: {
        id: `activity-${crypto.randomUUID()}`,
        timelineId: data.timeline.id,
        recordType: "activity",
        kind: "conflict",
        text: "山民与盐商在石阶冲突。",
        visibility: "public",
        targetIds: [],
        subjectIds: [data.character.id],
        sourceMessageId: data.message.id,
        eraLabel: "元年",
        timeLabel: "此刻",
      },
    });
    const duplicate = await prisma.worldActivity.create({
      data: {
        id: `activity-${crypto.randomUUID()}`,
        timelineId: data.timeline.id,
        recordType: "activity",
        kind: "conflict",
        text: "盐商再次与山民争夺石阶。",
        visibility: "public",
        targetIds: [],
        subjectIds: [data.character.id],
        sourceMessageId: data.message.id,
        eraLabel: "元年",
        timeLabel: "此刻",
      },
    });
    responses.worldActivity = {
      mergeActivityIds: [first.id, duplicate.id],
      eventMutations: [{
        operation: "create",
        sourceActivityIds: [first.id, duplicate.id],
        kind: "war",
        title: "石阶争夺",
        summary: "山民与盐商的冲突升级为持续战争。",
        phase: "escalating",
        participantIds: [data.character.id],
        visibility: "public",
      }],
    };
    try {
      await settle(data.chapter.id);
      await prisma.chapter.update({
        where: { id: data.chapter.id },
        data: { settleState: "settling:chronicle" },
      });
      await settle(data.chapter.id);

      const eventId = `settlement:${data.chapter.id}:0`;
      expect(await prisma.worldEvent.count({ where: { id: eventId } })).toBe(1);
      expect(await prisma.worldActivity.count({
        where: { id: `${eventId}:progress` },
      })).toBe(1);
      expect(await prisma.worldActivity.findUnique({ where: { id: first.id } }))
        .toMatchObject({ eventId });
      expect(await prisma.worldActivity.findUnique({ where: { id: duplicate.id } }))
        .toBeNull();
    } finally {
      responses.worldActivity = { mergeActivityIds: [], eventMutations: [] };
      await prisma.world.delete({ where: { id: data.world.id } });
    }
  });
});

afterAll(async () => prisma.$disconnect());

it("单次模型请求失败时释放占用且不运行后续阶段", async () => {
  const data = await fixture();
  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockImplementationOnce(async () => { throw new Error("extract unavailable"); });
  try {
    await expect(settle(data.chapter.id)).rejects.toThrow("extract unavailable");
    const chapter = await prisma.chapter.findUnique({ where: { id: data.chapter.id } });
    expect(chapter?.settleState).toBe("open");
    expect(await prisma.world.findUnique({ where: { id: data.world.id } })).toMatchObject({
      operationKind: null, operationToken: null, operationLeaseExpiresAt: null,
    });
    expect(vi.mocked(completeStructured)).toHaveBeenCalledTimes(1);
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});


it("多窗口会抽取早期消息与超长消息前缀中的能力变化", async () => {
  const data = await fixture();
  const earlyAbility = await prisma.ability.create({
    data: { timelineId: data.timeline.id, entityId: data.character.id, name: "凿阵术", kind: "personal", effect: "开凿阵基", trigger: "施工", cost: "体力", limitations: "需要石材", mastery: "novice", state: "normal", visibility: "known", lockedFields: [] },
  });
  const prefixAbility = await prisma.ability.create({
    data: { timelineId: data.timeline.id, entityId: data.character.id, name: "听石诀", kind: "personal", effect: "听辨岩层", trigger: "触石", cost: "专注", limitations: "嘈杂时失准", mastery: "novice", state: "normal", visibility: "known", lockedFields: [] },
  });
  const early = await prisma.message.create({ data: { chapterId: data.chapter.id, index: 20, role: "narrator", content: "阿岚苦修凿阵术，终于将凿阵术磨炼得更加纯熟。", scale: "years" } });
  await prisma.message.createMany({ data: Array.from({ length: 45 }, (_, offset) => ({ chapterId: data.chapter.id, index: 21 + offset, role: "narrator", content: `中段行旅记录${offset}。`, scale: "scene" })) });
  const long = await prisma.message.create({ data: { chapterId: data.chapter.id, index: 80, role: "narrator", content: "阿岚反复演练听石诀，听石诀变得更加纯熟。" + "山风掠过岩壁。".repeat(1200), scale: "years" } });
  const empty = { newEntities: [], entityUpdates: [], godUpdates: [], revealSections: [], abilityChanges: [] };
  responses.extractHandler = (user) => ({
    ...empty,
    abilityChanges: [
      ...(user.includes("阿岚苦修凿阵术") ? [{ abilityId: earlyAbility.id, ownerName: "阿岚", type: "improved", patch: { mastery: "adept" }, evidenceMessageIndex: early.index, evidence: "阿岚苦修凿阵术，终于将凿阵术磨炼得更加纯熟" }] : []),
      ...(user.includes("阿岚反复演练听石诀") ? [{ abilityId: prefixAbility.id, ownerName: "阿岚", type: "improved", patch: { mastery: "adept" }, evidenceMessageIndex: long.index, evidence: "阿岚反复演练听石诀，听石诀变得更加纯熟" }] : []),
    ],
  });
  try {
    await settle(data.chapter.id);
    const [earlyAfter, prefixAfter, events] = await Promise.all([
      prisma.ability.findUnique({ where: { id: earlyAbility.id } }),
      prisma.ability.findUnique({ where: { id: prefixAbility.id } }),
      prisma.abilityEvent.findMany({ where: { abilityId: { in: [earlyAbility.id, prefixAbility.id] } } }),
    ]);
    expect(earlyAfter).toMatchObject({ mastery: "adept" });
    expect(prefixAfter).toMatchObject({ mastery: "adept" });
    expect(events.map((event) => event.messageId)).toEqual(expect.arrayContaining([early.id, long.id]));
  } finally {
    responses.extractHandler = undefined;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("extraction 中途数据库失败会回滚同阶段已写入实体并停留 extract", async () => {
  const data = await fixture();
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `task11_fail_${suffix}`;
  const triggerName = `task11_trigger_${suffix}`;
  const firstName = `先写实体-${suffix}`;
  const failingName = `触发失败-${suffix}`;
  const emptyEntity = (name: string) => ({
    type: "place", name, aliases: [], summary: `${name}摘要`, sections: [], isChosen: false,
  });
  responses.extractHandler = () => ({
    newEntities: [emptyEntity(firstName), emptyEntity(failingName)],
    entityUpdates: [], godUpdates: [], revealSections: [], abilityChanges: [],
  });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
    BEGIN
      IF NEW.timeline_id = '${data.timeline.id}' AND NEW.name = '${failingName}' THEN
        RAISE EXCEPTION 'task11 injected failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER "${triggerName}" BEFORE INSERT ON entities
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);
  try {
    await expect(settle(data.chapter.id)).rejects.toThrow(/task11 injected failure/);
    expect(await prisma.entity.count({ where: { timelineId: data.timeline.id, name: firstName } })).toBe(0);
    expect((await prisma.chapter.findUnique({ where: { id: data.chapter.id } }))?.settleState).toBe("settling:extract");
  } finally {
    responses.extractHandler = undefined;
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON entities; DROP FUNCTION IF EXISTS "${functionName}"();`);
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("多窗口重复返回同一新实体时只创建一次，重试仍不重复", async () => {
  const data = await fixture();
  const name = `回声谷-${crypto.randomUUID()}`;
  await prisma.message.createMany({
    data: Array.from({ length: 45 }, (_, offset) => ({
      chapterId: data.chapter.id, index: 20 + offset, role: "narrator", content: `阿岚途经回声谷记录${offset}。`, scale: "scene",
    })),
  });
  const duplicate = { type: "place", name, aliases: ["谷地"], summary: "回声环绕的谷地", sections: [], isChosen: false };
  responses.extractHandler = () => ({
    newEntities: [duplicate], entityUpdates: [], godUpdates: [], revealSections: [], abilityChanges: [],
  });
  try {
    await settle(data.chapter.id);
    await prisma.chapter.update({ where: { id: data.chapter.id }, data: { settleState: "settling:extract" } });
    await settle(data.chapter.id);
    expect(await prisma.entity.count({ where: { timelineId: data.timeline.id, name } })).toBe(1);
  } finally {
    responses.extractHandler = undefined;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});


it("多窗口实体更新会累积去重 aliases，标量 section 冲突按窗口顺序 latest wins", async () => {
  const data = await fixture();
  await prisma.message.createMany({
    data: Array.from({ length: 45 }, (_, offset) => ({
      chapterId: data.chapter.id,
      index: 100 + offset,
      role: "narrator",
      content: `阿岚多窗口状态记录${offset}。`,
      scale: "scene",
    })),
  });
  responses.extractHandler = () => ({
    newEntities: [], godUpdates: [], revealSections: [], abilityChanges: [],
    entityUpdates: [{
      name: "阿岚",
      sectionDeltas: [{ key: "overview", title: "近况", text: "第二窗口" }],
      newAliases: ["石行者", "断崖客", "共同别名"],
      scenePresent: true,
    }],
  });
  try {
    await settle(data.chapter.id);
    const [entity, section] = await Promise.all([
      prisma.entity.findUnique({ where: { id: data.character.id } }),
      prisma.entitySection.findUnique({ where: { entityId_key: { entityId: data.character.id, key: "overview" } } }),
    ]);
    expect(entity?.aliases).toEqual(expect.arrayContaining(["石行者", "断崖客", "共同别名"]));
    expect(entity?.aliases.filter((alias) => alias === "共同别名")).toHaveLength(1);
    expect(section?.content).toMatchObject({ title: "近况", text: "第二窗口" });
  } finally {
    responses.extractHandler = undefined;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});


it("旧世界章节可创建新能力并将既有人物晋升主要人物，重跑幂等", async () => {
  const data = await fixture();
  const evidence = "阿岚终于学会裂石掌并独自守住山门，从此成为山民公认的领袖人物。";
  const message = await prisma.message.create({ data: {
    chapterId: data.chapter.id, index: 90, role: "narrator", content: evidence, scale: "years",
  } });
  responses.extract = {
    newEntities: [], entityUpdates: [], godUpdates: [], revealSections: [],
    majorCharacterPromotions: [{ name: "阿岚", evidenceMessageIndex: 90, evidence: evidence.slice(0, -1) }],
    abilityChanges: [{
      ownerName: "阿岚", name: "裂石掌", kind: "personal", type: "learned",
      effect: "以掌劲碎岩", trigger: "挥掌", cost: "体力", limitations: "需近身", lockedFields: [],
      patch: { mastery: "novice" }, evidenceMessageIndex: 90, evidence: evidence.slice(0, -1),
    }],
  };
  try {
    await settle(data.chapter.id);
    await prisma.chapter.update({ where: { id: data.chapter.id }, data: { settleState: "settling:extract" } });
    await settle(data.chapter.id);
    const [character, abilities, events] = await Promise.all([
      prisma.entity.findUnique({ where: { id: data.character.id } }),
      prisma.ability.findMany({ where: { entityId: data.character.id, name: "裂石掌" } }),
      prisma.abilityEvent.findMany({ where: { chapterId: data.chapter.id, messageId: message.id, type: "learned" } }),
    ]);
    expect(character?.isMajorCharacter).toBe(true);
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).toMatchObject({ kind: "personal", mastery: "novice", visibility: "known", version: 2 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ scale: "years", evidence: evidence.slice(0, -1) });
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("显式抽取的新重要人物创建时直接标记 major", async () => {
  const data = await fixture();
  const name = `白石-${crypto.randomUUID()}`;
  responses.extract = {
    newEntities: [{ type: "character", name, aliases: [], summary: "守住山门的新领袖", sections: [], isChosen: false, isMajorCharacter: true }],
    entityUpdates: [], godUpdates: [], revealSections: [], majorCharacterPromotions: [], abilityChanges: [],
  };
  try {
    await settle(data.chapter.id);
    expect(await prisma.entity.findFirst({ where: { timelineId: data.timeline.id, name } })).toMatchObject({ isMajorCharacter: true });
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("同章新人物的非法能力逐项拒绝，其他实体、能力与状态仍提交", async () => {
  const data = await fixture();
  const invalidName = `错脉-${crypto.randomUUID()}`;
  const invalidEntityName = `无族-${crypto.randomUUID()}`;
  const validName = `石芽-${crypto.randomUUID()}`;
  const invalidEvidence = `${invalidName}终于学会伪神权，并当众施展震动群山；他是山民新秀。`;
  const validEvidence = `${validName}终于学会碎岩拳，独自击碎封路巨石并成为关键人物；他是山民新秀。`;
  await prisma.message.create({ data: {
    chapterId: data.chapter.id, index: 150, role: "narrator", content: invalidEvidence, scale: "scene",
  } });
  const validMessage = await prisma.message.create({ data: {
    chapterId: data.chapter.id, index: 151, role: "narrator", content: validEvidence, scale: "scene",
  } });
  responses.extract = {
    newEntities: [
      { type: "character", name: invalidName, aliases: [], raceName: "山民", summary: "独立入册的山民新秀", sections: [], isChosen: false, isMajorCharacter: false },
      { type: "character", name: invalidEntityName, aliases: [], raceName: "不存在族", summary: "种族引用无效", sections: [], isChosen: false, isMajorCharacter: false },
      { type: "character", name: validName, aliases: [], raceName: "山民", summary: "山民新秀", sections: [], isChosen: false, isMajorCharacter: true },
    ],
    entityUpdates: [{
      name: "阿岚", sectionDeltas: [], summary: "见证两名山民新秀崭露头角", newAliases: [],
      becameChosen: false, died: false, scenePresent: true,
    }],
    godUpdates: [], revealSections: [], majorCharacterPromotions: [],
    abilityChanges: [
      {
        ownerName: invalidName, name: "伪神权", kind: "divine", type: "learned",
        effect: "震动群山", trigger: "施展", cost: "体力", limitations: "无", lockedFields: [],
        patch: { mastery: "novice" }, evidenceMessageIndex: 150, evidence: invalidEvidence.slice(0, -1),
      },
      {
        ownerName: validName, name: "碎岩拳", kind: "personal", type: "learned",
        effect: "击碎岩石", trigger: "挥拳", cost: "体力", limitations: "需近身", lockedFields: [],
        patch: { mastery: "novice" }, evidenceMessageIndex: 151, evidence: validEvidence.slice(0, -1),
      },
    ],
  };
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await settle(data.chapter.id);
    const [invalidEntity, rejectedEntity, validEntity, existingCharacter, chapter] = await Promise.all([
      prisma.entity.findFirst({ where: { timelineId: data.timeline.id, name: invalidName } }),
      prisma.entity.findFirst({ where: { timelineId: data.timeline.id, name: invalidEntityName } }),
      prisma.entity.findFirst({ where: { timelineId: data.timeline.id, name: validName } }),
      prisma.entity.findUnique({ where: { id: data.character.id } }),
      prisma.chapter.findUnique({ where: { id: data.chapter.id } }),
    ]);
    const [invalidAbilityCount, validAbility] = await Promise.all([
      prisma.ability.count({ where: { entityId: invalidEntity?.id } }),
      prisma.ability.findFirst({ where: { entityId: validEntity?.id, name: "碎岩拳" } }),
    ]);
    const event = await prisma.abilityEvent.findFirst({ where: { abilityId: validAbility?.id } });

    expect(invalidEntity).toMatchObject({ raceId: data.race.id, summary: "独立入册的山民新秀" });
    expect(invalidAbilityCount).toBe(0);
    expect(rejectedEntity).toBeNull();
    expect(validEntity).toMatchObject({ raceId: data.race.id, isMajorCharacter: true });
    expect(validAbility).toMatchObject({ kind: "personal", mastery: "novice", version: 2 });
    expect(event).toMatchObject({ chapterId: data.chapter.id, messageId: validMessage.id, scale: "scene", type: "learned" });
    expect(existingCharacter?.summary).toBe("见证两名山民新秀崭露头角");
    expect(chapter?.settleState).toBe("settled");
    expect(consoleError).toHaveBeenCalledWith("章末新实体被拒绝", expect.objectContaining({
      name: invalidEntityName, reason: expect.stringMatching(/主种族|不存在/),
    }));
    expect(consoleError).toHaveBeenCalledWith("章末能力变化被拒绝", expect.objectContaining({
      ownerName: invalidName, reason: expect.stringMatching(/kind|personal/),
    }));
  } finally {
    consoleError.mockRestore();
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("即使有多位主要神，一次结束章节也只发起一个结构化模型调用", async () => {
  const data = await fixture();
  await prisma.god.createMany({ data: [
    { timelineId: data.timeline.id, name: "山岳神", aliases: [], tier: "major", rank: "ascended", domains: ["山岳"] },
    { timelineId: data.timeline.id, name: "长风神", aliases: [], tier: "major", rank: "nascent", domains: ["长风"] },
  ] });
  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockClear();
  responses.extractHandler = undefined;
  try {
    await settle(data.chapter.id);
    expect(vi.mocked(completeStructured)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(completeStructured)).toHaveBeenCalledWith(
      "backstage",
      expect.objectContaining({
        task: "settlement",
        maxAttempts: 1,
        transportMaxAttempts: 1,
        allowTransportFallback: false,
      }),
    );
    expect(await prisma.chronicleEntry.count({
      where: { timelineId: data.timeline.id, chapterIndex: 1, source: "pantheon" },
    })).toBe(2);
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});


it("同一章节并发结束时全局只发起一次模型请求", async () => {
  const data = await fixture();
  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockClear();
  responses.modelDelayMs = 150;
  responses.extract = {
    newEntities: [], entityUpdates: [], godUpdates: [], revealSections: [],
    majorCharacterPromotions: [], abilityChanges: [],
  };
  try {
    const results = await Promise.allSettled([settle(data.chapter.id), settle(data.chapter.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ activeKind: "settlement" }) }),
    ]);
    expect(vi.mocked(completeStructured)).toHaveBeenCalledTimes(1);
    expect((await prisma.chapter.findUnique({ where: { id: data.chapter.id } }))?.settleState).toBe("settled");
    expect(await prisma.world.findUnique({ where: { id: data.world.id } })).toMatchObject({
      operationKind: null, operationToken: null, operationLeaseExpiresAt: null,
    });
  } finally {
    responses.modelDelayMs = 0;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});



it("rejects settlement while chat owns the world and names the active operation in Chinese", async () => {
  const data = await fixture();
  await prisma.world.update({
    where: { id: data.world.id },
    data: {
      operationKind: "chat",
      operationToken: "generation-live",
      operationLeaseExpiresAt: new Date(Date.now() + 60_000),
    },
  });

  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockClear();
  try {
    await expect(settle(data.chapter.id)).rejects.toMatchObject({
      activeKind: "chat",
      message: expect.stringContaining("叙事生成"),
    });
    expect(vi.mocked(completeStructured)).not.toHaveBeenCalled();
    expect((await prisma.chapter.findUnique({ where: { id: data.chapter.id } }))?.settleState).toBe("open");
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("把可见未锁定栏目放入整理上下文，并持久化人物的方向性关系", async () => {
  const data = await fixture();
  const target = await prisma.entity.create({
    data: {
      timelineId: data.timeline.id,
      type: "character",
      name: "保罗",
      aliases: ["父亲"],
      emblemSeed: "paul",
      summary: "阿岚的父亲",
      lockedPaths: [],
    },
  });
  await prisma.entitySection.createMany({
    data: [{
      entityId: data.character.id,
      key: "overview",
      content: { title: "近况", text: "仍在山门修习旧式步法。" },
      revealed: true,
    }, {
      entityId: data.character.id,
      key: "identity",
      content: { title: "隐秘身份", text: "不可传入整理上下文。" },
      revealed: false,
    }, {
      entityId: data.character.id,
      key: "affiliation",
      content: { title: "门派", text: "此栏已由玩家锁定。" },
      revealed: true,
      playerLocked: true,
    }],
  });
  responses.extractHandler = (user) => {
    expect(user).toContain("overview");
    expect(user).toContain("近况");
    expect(user).toContain("仍在山门修习旧式步法");
    expect(user).not.toContain("不可传入整理上下文");
    expect(user).not.toContain("此栏已由玩家锁定");
    return {
      newEntities: [],
      newGods: [],
      entityUpdates: [{
        name: "阿岚",
        sectionDeltas: [],
        summary: null,
        newAliases: null,
        becameChosen: null,
        died: null,
        scenePresent: true,
        relationChanges: [{
          target: "父亲",
          label: "family",
          note: "本轮正文明确两人重新承认父子关系。",
        }],
      }],
      godUpdates: [],
      revealSections: [],
      majorCharacterPromotions: [],
      abilityChanges: [],
    };
  };
  try {
    await settle(data.chapter.id);
    const relation = await prisma.entityRelation.findUnique({
      where: {
        sourceEntityId_targetEntityId: {
          sourceEntityId: data.character.id,
          targetEntityId: target.id,
        },
      },
    });
    expect(relation).toMatchObject({
      timelineId: data.timeline.id,
      sourceEntityId: data.character.id,
      targetEntityId: target.id,
      label: "family",
      note: "本轮正文明确两人重新承认父子关系。",
    });
    expect(await prisma.entityRelation.findUnique({
      where: {
        sourceEntityId_targetEntityId: {
          sourceEntityId: target.id,
          targetEntityId: data.character.id,
        },
      },
    })).toBeNull();
  } finally {
    responses.extractHandler = undefined;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("逐项忽略跨现实或非人物的人物关系目标", async () => {
  const data = await fixture();
  const foreignWorld = await prisma.world.create({
    data: { name: `foreign-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [] },
  });
  const foreignTimeline = await prisma.timeline.create({ data: { worldId: foreignWorld.id } });
  await prisma.entity.create({
    data: {
      timelineId: foreignTimeline.id,
      type: "character",
      name: "异界人",
      aliases: [],
      emblemSeed: "foreign",
      summary: "不属于当前现实",
      lockedPaths: [],
    },
  });
  await prisma.entity.create({
    data: {
      timelineId: data.timeline.id,
      type: "place",
      name: "山门",
      aliases: [],
      emblemSeed: "gate",
      summary: "一处地点",
      lockedPaths: [],
    },
  });
  responses.extract = {
    newEntities: [],
    newGods: [],
    entityUpdates: [{
      name: "阿岚",
      sectionDeltas: [],
      summary: null,
      newAliases: null,
      becameChosen: null,
      died: null,
      scenePresent: true,
      relationChanges: [{
        target: "异界人",
        label: "friend",
        note: "非法跨现实目标",
      }, {
        target: "山门",
        label: "ally",
        note: "非法非人物目标",
      }],
    }],
    godUpdates: [],
    revealSections: [],
    majorCharacterPromotions: [],
    abilityChanges: [],
  };
  try {
    await settle(data.chapter.id);
    expect(await prisma.entityRelation.count({
      where: { sourceEntityId: data.character.id },
    })).toBe(0);
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
    await prisma.world.delete({ where: { id: foreignWorld.id } });
  }
});

it("rejects settlement on a frozen non-active timeline without calling the model", async () => {
  const data = await fixture();
  const replacement = await prisma.timeline.create({ data: { worldId: data.world.id } });
  await prisma.world.update({ where: { id: data.world.id }, data: { activeTimelineId: replacement.id } });
  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockClear();
  try {
    await expect(settle(data.chapter.id)).rejects.toThrow("该现实已被冻结");
    expect(vi.mocked(completeStructured)).not.toHaveBeenCalled();
    expect((await prisma.chapter.findUnique({ where: { id: data.chapter.id } }))?.settleState).toBe("open");
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("creator settlement uses creator schema/prompt and never writes stanceToPlayer", async () => {
  const data = await fixture();
  const { completeCreatorDeck } = await import("@/lib/abilities/embark.test-fixtures");
  const { initialRealityState, initialObserverState } = await import("@/lib/reality/schemas");
  const creatorDeck = completeCreatorDeck();
  await prisma.$transaction([
    prisma.world.update({ where: { id: data.world.id }, data: { mode: "creator", themeCard: { eraSystem: "旧世界纪年" } } }),
    prisma.timeline.update({ where: { id: data.timeline.id }, data: {
      realityState: initialRealityState(creatorDeck),
      observerState: initialObserverState(creatorDeck),
    } }),
  ]);
  const god = await prisma.god.create({
    data: {
      timelineId: data.timeline.id, name: "潮神", aliases: [], tier: "major", rank: "ascended", domains: ["潮汐"],
      agenda: { longTermGoal: "吞没旧港", shortTermGoals: [], methods: "海啸", schemes: [] },
      relations: {},
    },
  });
  const windGod = await prisma.god.create({
    data: {
      timelineId: data.timeline.id, name: "风神", aliases: ["长风"], tier: "major", rank: "nascent", domains: ["风"],
      agenda: { longTermGoal: "吹散盐雾", shortTermGoals: [], methods: "季风", schemes: [] },
      relations: {},
    },
  });
  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockClear();
  vi.mocked(completeStructured).mockResolvedValueOnce({
    pantheonTurns: [{
      godName: "潮神", action: { description: "潮神令盐潮倒灌", targets: ["阿岚"] }, omen: "井水泛咸",
      agendaUpdate: { shortTermGoals: ["控制盐路"], schemes: ["扶植海商"] },
      relationsUpdate: [{ target: "长风", label: "neutral", note: "暂时观察" }],
      proactiveEvent: { type: "envoy", openingHook: "海商找到阿岚" },
    }],
    extraction: {
      newEntities: [], newGods: [], entityUpdates: [], revealSections: [], majorCharacterPromotions: [], abilityChanges: [],
      godUpdates: [{
        name: "风神",
        relationChanges: [{ target: "潮神", label: "rival", note: "争夺海岸气候" }],
      }],
    },
    chronicle: { entries: [{ yearLabel: "元年", text: "盐潮倒灌山脚。", entityNames: ["阿岚"], godNames: ["潮神"] }], epilogue: "盐气漫上石阶。", chapterTitle: "盐潮" },
  } as never);
  try {
    await settle(data.chapter.id);
    const updated = await prisma.god.findUniqueOrThrow({ where: { id: god.id } });
    const updatedWind = await prisma.god.findUniqueOrThrow({ where: { id: windGod.id } });
    expect(updated.agenda).toMatchObject({ shortTermGoals: ["控制盐路"], schemes: ["扶植海商"] });
    expect(updated.agenda).not.toHaveProperty("stanceToPlayer");
    expect(updated.relations).toEqual({
      [windGod.id]: { label: "neutral", note: "暂时观察" },
    });
    expect(updatedWind.relations).toEqual({
      [god.id]: { label: "rival", note: "争夺海岸气候" },
    });
    const rewrite = await prisma.realityRewrite.create({
      data: {
        worldId: data.world.id,
        sourceTimelineId: data.timeline.id,
        sourceChapterId: data.chapter.id,
        decree: "验证关系图可克隆",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const { cloneTimelineGraph } = await import("@/lib/reality/clone");
    const cloned = await prisma.$transaction((tx) => cloneTimelineGraph(tx, {
      sourceTimelineId: data.timeline.id,
      worldId: data.world.id,
      rewriteId: rewrite.id,
      branchName: "关系回归",
      branchSummary: "关系键必须为真实 God ID",
    }));
    const clonedTide = await prisma.god.findUniqueOrThrow({ where: { id: cloned.maps.godIds.get(god.id)! } });
    expect(clonedTide.relations).toEqual({
      [cloned.maps.godIds.get(windGod.id)!]: { label: "neutral", note: "暂时观察" },
    });
    expect(vi.mocked(completeStructured)).toHaveBeenCalledWith("backstage", expect.objectContaining({
      system: expect.stringContaining("world-external Creator"),
      user: expect.stringContaining(creatorDeck.theme.eraSystem),
      cache: { namespace: "settlement:v2:creator" },
    }));
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it.each([
  { target: "阿岚", expected: /关系目标.*实体|实体.*关系目标/ },
  { target: "不存在神", expected: /无法解析神明关系目标/ },
  { target: "长风", expected: /存在歧义/ },
])("creator settlement rejects invalid relation target $target before relation writes", async ({ target, expected }) => {
  const data = await fixture();
  const { completeCreatorDeck } = await import("@/lib/abilities/embark.test-fixtures");
  const { initialRealityState, initialObserverState } = await import("@/lib/reality/schemas");
  const creatorDeck = completeCreatorDeck();
  await prisma.$transaction([
    prisma.world.update({ where: { id: data.world.id }, data: { mode: "creator" } }),
    prisma.timeline.update({ where: { id: data.timeline.id }, data: {
      realityState: initialRealityState(creatorDeck), observerState: initialObserverState(creatorDeck),
    } }),
  ]);
  const tide = await prisma.god.create({ data: {
    timelineId: data.timeline.id, name: "潮神", aliases: [], tier: "major", rank: "ascended", domains: ["潮汐"], relations: {},
  } });
  if (target === "长风") {
    await prisma.god.createMany({ data: [
      { timelineId: data.timeline.id, name: "东风神", aliases: ["长风"], tier: "major", rank: "nascent", domains: ["东风"] },
      { timelineId: data.timeline.id, name: "西风神", aliases: ["长风"], tier: "major", rank: "nascent", domains: ["西风"] },
    ] });
  }
  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockResolvedValueOnce({
    pantheonTurns: [{
      godName: "潮神", action: { description: "潮神观察山民", targets: ["阿岚"] }, omen: "井水泛咸",
      agendaUpdate: {}, relationsUpdate: [{ target, label: "neutral", note: "非法关系目标" }], proactiveEvent: null,
    }],
    extraction: { newEntities: [], newGods: [], entityUpdates: [], godUpdates: [], revealSections: [], majorCharacterPromotions: [], abilityChanges: [] },
    chronicle: { entries: [], epilogue: "未成。", chapterTitle: "拒绝关系" },
  } as never);
  try {
    await expect(settle(data.chapter.id)).rejects.toThrow(expected);
    expect((await prisma.god.findUniqueOrThrow({ where: { id: tide.id } })).relations).toEqual({});
    expect(await prisma.chronicleEntry.count({ where: { timelineId: data.timeline.id } })).toBe(0);
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("renews a long settlement lease so another operation remains blocked past the original expiry", async () => {
  const data = await fixture();
  const token = crypto.randomUUID();
  const originalExpiry = new Date(Date.now() + 1_000);
  await prisma.world.update({
    where: { id: data.world.id },
    data: {
      operationKind: "settlement",
      operationToken: token,
      operationLeaseExpiresAt: originalExpiry,
    },
  });
  responses.modelDelayMs = 1_100;
  try {
    const running = (async () => {
      for await (const _progress of settleChapter(data.chapter.id, {
        worldId: data.world.id,
        token,
        claimed: true,
        heartbeatMs: 2_000,
      })) void _progress;
    })();
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    const { claimWorldOperation } = await import("@/lib/reality/operation-lock");
    await expect(claimWorldOperation(prisma, data.world.id, "chat", "intruder")).resolves.toEqual({
      acquired: false,
      activeKind: "settlement",
    });
    expect((await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } })).operationLeaseExpiresAt!.getTime())
      .toBeGreaterThan(originalExpiry.getTime());
    await running;
  } finally {
    responses.modelDelayMs = 0;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("rolls back the model claim when the settlement lease changes at the claim write boundary", async () => {
  const data = await fixture();
  const token = crypto.randomUUID();
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `settle_model_claim_fence_${suffix}`;
  const triggerName = `settle_model_claim_fence_trigger_${suffix}`;
  const { claimWorldOperation } = await import("@/lib/reality/operation-lock");
  await expect(claimWorldOperation(prisma, data.world.id, "settlement", token)).resolves.toEqual({ acquired: true });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
    BEGIN
      IF NEW.id = '${data.chapter.id}' AND NEW.settle_state LIKE 'settling:model:%' THEN
        UPDATE worlds SET operation_token = 'replacement-owner' WHERE id = '${data.world.id}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON chapters
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);
  try {
    await expect((async () => {
      for await (const _progress of settleChapter(data.chapter.id, {
        worldId: data.world.id,
        token,
        claimed: true,
        heartbeatMs: 60_000,
      })) void _progress;
    })()).rejects.toThrow("世界操作租约已失效");
    expect(await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapter.id } })).toMatchObject({
      settleState: "open",
      snapshot: null,
    });
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON chapters; DROP FUNCTION IF EXISTS "${functionName}"();`);
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("rolls back the pending model result when the settlement lease changes at the result write boundary", async () => {
  const data = await fixture();
  const token = crypto.randomUUID();
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `settle_model_result_fence_${suffix}`;
  const triggerName = `settle_model_result_fence_trigger_${suffix}`;
  const { claimWorldOperation } = await import("@/lib/reality/operation-lock");
  await expect(claimWorldOperation(prisma, data.world.id, "settlement", token)).resolves.toEqual({ acquired: true });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
    BEGIN
      IF NEW.id = '${data.chapter.id}'
        AND NEW.settle_state = 'settling:pantheon'
        AND NEW.snapshot IS NOT NULL THEN
        UPDATE worlds SET operation_token = 'replacement-owner' WHERE id = '${data.world.id}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON chapters
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);
  try {
    await expect((async () => {
      for await (const _progress of settleChapter(data.chapter.id, {
        worldId: data.world.id,
        token,
        claimed: true,
        heartbeatMs: 60_000,
      })) void _progress;
    })()).rejects.toThrow("世界操作租约已失效");
    expect(await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapter.id } })).toMatchObject({
      settleState: "open",
      snapshot: null,
    });
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON chapters; DROP FUNCTION IF EXISTS "${functionName}"();`);
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("does not commit model-claim recovery when recovery loses the settlement lease", async () => {
  const data = await fixture();
  const token = crypto.randomUUID();
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `settle_model_recovery_fence_${suffix}`;
  const triggerName = `settle_model_recovery_fence_trigger_${suffix}`;
  const { claimWorldOperation } = await import("@/lib/reality/operation-lock");
  const { completeStructured } = await import("@/lib/llm/structured");
  await expect(claimWorldOperation(prisma, data.world.id, "settlement", token)).resolves.toEqual({ acquired: true });
  vi.mocked(completeStructured).mockImplementationOnce(async () => { throw new Error("model unavailable"); });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
    BEGIN
      IF NEW.id = '${data.chapter.id}'
        AND OLD.settle_state LIKE 'settling:model:%'
        AND NEW.settle_state = 'open' THEN
        UPDATE worlds SET operation_token = 'replacement-owner' WHERE id = '${data.world.id}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON chapters
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);
  try {
    await expect((async () => {
      for await (const _progress of settleChapter(data.chapter.id, {
        worldId: data.world.id,
        token,
        claimed: true,
        heartbeatMs: 60_000,
      })) void _progress;
    })()).rejects.toThrow("model unavailable");
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapter.id } });
    expect(chapter.settleState).toMatch(/^settling:model:/);
    expect(chapter.snapshot).toBeNull();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON chapters; DROP FUNCTION IF EXISTS "${functionName}"();`);
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it("stops after settlement lease renewal is lost and performs no post-model writes", async () => {
  const data = await fixture();
  const token = crypto.randomUUID();
  const { claimWorldOperation } = await import("@/lib/reality/operation-lock");
  await expect(claimWorldOperation(prisma, data.world.id, "settlement", token)).resolves.toEqual({ acquired: true });
  responses.modelDelayMs = 50;
  responses.beforeModelResponse = async () => {
    await prisma.world.update({
      where: { id: data.world.id },
      data: { operationToken: "replacement-owner" },
    });
  };
  try {
    await expect((async () => {
      for await (const _progress of settleChapter(data.chapter.id, {
        worldId: data.world.id,
        token,
        claimed: true,
        heartbeatMs: 5,
      } as never)) void _progress;
    })()).rejects.toThrow("世界操作租约已失效");
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapter.id } });
    expect(chapter.snapshot).toBeNull();
    expect(await prisma.chronicleEntry.count({ where: { timelineId: data.timeline.id } })).toBe(0);
  } finally {
    responses.modelDelayMs = 0;
    responses.beforeModelResponse = undefined;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});

it.each(["extract", "chronicle"] as const)(
  "refuses to resume the %s stage after the settlement lease changes while progress is yielded",
  async (pausedStep) => {
    const data = await fixture();
    const token = crypto.randomUUID();
    const { claimWorldOperation } = await import("@/lib/reality/operation-lock");
    await expect(claimWorldOperation(prisma, data.world.id, "settlement", token)).resolves.toEqual({ acquired: true });
    const runner = settleChapter(data.chapter.id, {
      worldId: data.world.id,
      token,
      claimed: true,
      heartbeatMs: 60_000,
    });
    try {
      let progress = await runner.next();
      while (!progress.done && progress.value.step !== pausedStep) progress = await runner.next();
      expect(progress).toMatchObject({ done: false, value: { step: pausedStep } });
      expect((await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapter.id } })).settleState)
        .toBe(`settling:${pausedStep}`);

      await prisma.world.update({
        where: { id: data.world.id },
        data: { operationToken: "replacement-owner" },
      });

      await expect(runner.next()).rejects.toThrow("世界操作租约已失效");
      expect((await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapter.id } })).settleState)
        .toBe(`settling:${pausedStep}`);
      expect(await prisma.chronicleEntry.count({ where: { timelineId: data.timeline.id } })).toBe(0);
      expect(await prisma.ability.count({
        where: { entityId: data.character.id, sourceAbilityId: data.source.id },
      })).toBe(pausedStep === "chronicle" ? 1 : 0);
    } finally {
      await runner.return(undefined);
      await prisma.world.delete({ where: { id: data.world.id } });
    }
  },
);

it("stops after an extraction transaction changes the lease and does not advance settlement state", async () => {
  const data = await fixture();
  const token = crypto.randomUUID();
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const functionName = `settle_fence_${suffix}`;
  const triggerName = `settle_fence_trigger_${suffix}`;
  const { claimWorldOperation } = await import("@/lib/reality/operation-lock");
  await expect(claimWorldOperation(prisma, data.world.id, "settlement", token)).resolves.toEqual({ acquired: true });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
    BEGIN
      IF NEW.timeline_id = '${data.timeline.id}' AND NEW.source_ability_id = '${data.source.id}' THEN
        UPDATE worlds SET operation_token = 'replacement-owner' WHERE id = '${data.world.id}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER "${triggerName}" AFTER INSERT ON abilities
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);
  try {
    await expect((async () => {
      for await (const _progress of settleChapter(data.chapter.id, {
        worldId: data.world.id,
        token,
        claimed: true,
        heartbeatMs: 60_000,
      })) void _progress;
    })()).rejects.toThrow("世界操作租约已失效");
    expect(await prisma.ability.count({
      where: { entityId: data.character.id, sourceAbilityId: data.source.id },
    })).toBe(0);
    expect((await prisma.chapter.findUniqueOrThrow({ where: { id: data.chapter.id } })).settleState)
      .toBe("settling:extract");
    expect(await prisma.chronicleEntry.count({ where: { timelineId: data.timeline.id } })).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON abilities; DROP FUNCTION IF EXISTS "${functionName}"();`);
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});
