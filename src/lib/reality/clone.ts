import { Prisma } from "@prisma/client";

const RESERVED_GOD_RELATION_KEYS = new Set(["player"]);

export type TimelineCloneMaps = {
  chapterIds: Map<string, string>;
  messageIds: Map<string, string>;
  godIds: Map<string, string>;
  entityIds: Map<string, string>;
  abilityIds: Map<string, string>;
};

type CloneInput = {
  sourceTimelineId: string;
  worldId: string;
  rewriteId: string;
  branchName: string;
  branchSummary: string;
};

function deepCopyJson<T>(value: T): T {
  return structuredClone(value);
}

function nullableJson(value: Prisma.JsonValue | null) {
  return value === null
    ? Prisma.DbNull
    : deepCopyJson(value) as Prisma.InputJsonValue;
}

function requiredJson(value: Prisma.JsonValue) {
  return value === null
    ? Prisma.JsonNull
    : deepCopyJson(value) as Prisma.InputJsonValue;
}

function requireMapped(
  map: ReadonlyMap<string, string>,
  sourceId: string,
  label: string,
): string {
  const clonedId = map.get(sourceId);
  if (clonedId === undefined) {
    throw new Error(`${label}缺少克隆映射：${sourceId}`);
  }
  return clonedId;
}

function remapGodRelations(
  value: Prisma.JsonValue | null,
  maps: Pick<TimelineCloneMaps, "godIds" | "entityIds">,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null) return Prisma.DbNull;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("神明关系必须是以目标 ID 为键的对象");
  }

  return Object.fromEntries(Object.entries(value).map(([sourceId, relation]) => {
    if (RESERVED_GOD_RELATION_KEYS.has(sourceId)) {
      return [sourceId, deepCopyJson(relation)] as const;
    }
    const clonedId = maps.godIds.get(sourceId) ?? maps.entityIds.get(sourceId);
    if (clonedId === undefined) {
      throw new Error(`神明关系缺少克隆映射：${sourceId}`);
    }
    return [clonedId, deepCopyJson(relation)] as const;
  })) as Prisma.InputJsonValue;
}

function remapObserverState(
  value: Prisma.JsonValue | null,
  maps: Pick<TimelineCloneMaps, "godIds" | "entityIds">,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null) return Prisma.DbNull;
  const cloned = deepCopyJson(value);
  if (typeof cloned !== "object" || Array.isArray(cloned)) return cloned;

  const observer = cloned as Record<string, Prisma.JsonValue>;
  if (typeof observer.focusId === "string") {
    if (observer.focusType === "god") {
      observer.focusId = requireMapped(maps.godIds, observer.focusId, "观察焦点神明");
    } else if (
      observer.focusType === "entity"
      || observer.focusType === "place"
      || observer.focusType === "avatar"
    ) {
      observer.focusId = requireMapped(maps.entityIds, observer.focusId, "观察焦点实体");
    } else {
      throw new Error(`观察焦点缺少可重映射类型：${String(observer.focusType)}`);
    }
  }
  if (typeof observer.activeAvatarId === "string") {
    observer.activeAvatarId = requireMapped(
      maps.entityIds,
      observer.activeAvatarId,
      "当前化身实体",
    );
  }
  return observer as Prisma.InputJsonValue;
}

function remapEventDedupeKey(
  event: {
    dedupeKey: string;
    chapterId: string;
    abilityId: string;
    messageId: string | null;
    type: string;
  },
  clonedEventId: string,
  timelineId: string,
  maps: Pick<TimelineCloneMaps, "chapterIds" | "messageIds" | "abilityIds">,
): string {
  const canonical = event.dedupeKey.match(/^([^:]+):([^:]+):([^:]+):([^:]+)$/);
  if (
    event.messageId !== null
    && canonical?.[1] === event.chapterId
    && canonical[2] === event.abilityId
    && canonical[3] === event.type
    && canonical[4] === event.messageId
  ) {
    return [
      requireMapped(maps.chapterIds, event.chapterId, "能力事件章节"),
      requireMapped(maps.abilityIds, event.abilityId, "能力事件能力"),
      event.type,
      requireMapped(maps.messageIds, event.messageId, "能力事件消息"),
    ].join(":");
  }
  return `clone:${timelineId}:${clonedEventId}`;
}

/**
 * Clone one timeline and every timeline-owned historical row inside the caller's
 * transaction. Runtime work records (generation requests and leases) are
 * deliberately outside this graph.
 */
export async function cloneTimelineGraph(
  tx: Prisma.TransactionClient,
  input: CloneInput,
): Promise<{ timelineId: string; maps: TimelineCloneMaps }> {
  const source = await tx.timeline.findUniqueOrThrow({
    where: { id: input.sourceTimelineId },
    include: {
      chapters: {
        orderBy: { index: "asc" },
        include: { messages: { orderBy: { index: "asc" } } },
      },
      gods: { orderBy: { createdAt: "asc" } },
      entities: {
        orderBy: { createdAt: "asc" },
        include: { sections: { orderBy: { key: "asc" } } },
      },
      abilities: { orderBy: { createdAt: "asc" } },
      chronicles: { orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }] },
      omens: { orderBy: { createdAt: "asc" } },
    },
  });
  if (source.worldId !== input.worldId) {
    throw new Error(`源时间线不属于目标世界：${input.sourceTimelineId}`);
  }

  const rewrite = await tx.realityRewrite.findUniqueOrThrow({
    where: { id: input.rewriteId },
    select: { worldId: true, sourceTimelineId: true, sourceChapterId: true },
  });
  if (rewrite.worldId !== input.worldId || rewrite.sourceTimelineId !== source.id) {
    throw new Error(`现实改写不属于源时间线：${input.rewriteId}`);
  }
  const forkChapter = source.chapters.find(
    (chapter) => chapter.id === rewrite.sourceChapterId,
  );
  if (forkChapter === undefined) {
    throw new Error(`改写来源章节缺少克隆映射：${rewrite.sourceChapterId}`);
  }

  const maps: TimelineCloneMaps = {
    chapterIds: new Map(),
    messageIds: new Map(),
    godIds: new Map(),
    entityIds: new Map(),
    abilityIds: new Map(),
  };

  // Pass 1: create the child and identity-bearing roots. Forward references are
  // repaired only after every target ID exists.
  const child = await tx.timeline.create({
    data: {
      worldId: input.worldId,
      parentId: source.id,
      forkChapter: forkChapter.index,
      forkRewriteId: input.rewriteId,
      branchName: input.branchName,
      branchSummary: input.branchSummary,
      realityState: nullableJson(source.realityState),
      observerState: Prisma.DbNull,
    },
  });

  for (const chapter of source.chapters) {
    const cloned = await tx.chapter.create({
      data: {
        timelineId: child.id,
        index: chapter.index,
        title: chapter.title,
        summary: chapter.summary,
        settleState: chapter.settleState,
        snapshot: nullableJson(chapter.snapshot),
        createdAt: chapter.createdAt,
      },
    });
    maps.chapterIds.set(chapter.id, cloned.id);
  }

  for (const entity of source.entities) {
    const cloned = await tx.entity.create({
      data: {
        timelineId: child.id,
        type: entity.type,
        name: entity.name,
        aliases: [...entity.aliases],
        emblemSeed: entity.emblemSeed,
        imageUrl: entity.imageUrl,
        starred: entity.starred,
        isChosen: entity.isChosen,
        isMajorCharacter: entity.isMajorCharacter,
        isCreatorAvatar: entity.isCreatorAvatar,
        raceId: null,
        heat: entity.heat,
        scenePresence: entity.scenePresence,
        summary: entity.summary,
        lockedPaths: [...entity.lockedPaths],
        materialRef: entity.materialRef,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      },
    });
    maps.entityIds.set(entity.id, cloned.id);
  }

  for (const god of source.gods) {
    const cloned = await tx.god.create({
      data: {
        timelineId: child.id,
        name: god.name,
        aliases: [...god.aliases],
        tier: god.tier,
        isPlayer: god.isPlayer,
        rank: god.rank,
        domains: [...god.domains],
        persona: nullableJson(god.persona),
        voice: nullableJson(god.voice),
        agenda: nullableJson(god.agenda),
        agendaRevealed: god.agendaRevealed,
        relations: Prisma.DbNull,
        faithScope: god.faithScope,
        materialRef: god.materialRef,
        codexEntityId: null,
        createdAt: god.createdAt,
        updatedAt: god.updatedAt,
      },
    });
    maps.godIds.set(god.id, cloned.id);
  }

  for (const entity of source.entities) {
    if (entity.raceId !== null) {
      await tx.entity.update({
        where: { id: requireMapped(maps.entityIds, entity.id, "实体") },
        data: {
          raceId: requireMapped(maps.entityIds, entity.raceId, "人物种族"),
          updatedAt: entity.updatedAt,
        },
      });
    }
  }
  for (const god of source.gods) {
    await tx.god.update({
      where: { id: requireMapped(maps.godIds, god.id, "神明") },
      data: {
        relations: remapGodRelations(god.relations, maps),
        codexEntityId: god.codexEntityId === null
          ? null
          : requireMapped(maps.entityIds, god.codexEntityId, "神明百科实体"),
        updatedAt: god.updatedAt,
      },
    });
  }
  await tx.timeline.update({
    where: { id: child.id },
    data: { observerState: remapObserverState(source.observerState, maps) },
  });

  // Pass 2: clone dependent rows and remap every graph edge.
  for (const chapter of source.chapters) {
    for (const message of chapter.messages) {
      const cloned = await tx.message.create({
        data: {
          chapterId: requireMapped(maps.chapterIds, message.chapterId, "消息章节"),
          index: message.index,
          role: message.role,
          content: message.content,
          scale: message.scale,
          variants: nullableJson(message.variants),
          meta: nullableJson(message.meta),
          createdAt: message.createdAt,
        },
      });
      maps.messageIds.set(message.id, cloned.id);
    }
  }

  for (const entity of source.entities) {
    const entityId = requireMapped(maps.entityIds, entity.id, "实体栏目所属实体");
    for (const section of entity.sections) {
      await tx.entitySection.create({
        data: {
          entityId,
          key: section.key,
          content: requiredJson(section.content),
          revealed: section.revealed,
          rumorText: section.rumorText,
          playerLocked: section.playerLocked,
        },
      });
    }
  }

  for (const ability of source.abilities) {
    const cloned = await tx.ability.create({
      data: {
        timelineId: child.id,
        entityId: ability.entityId === null
          ? null
          : requireMapped(maps.entityIds, ability.entityId, "能力所属实体"),
        godId: ability.godId === null
          ? null
          : requireMapped(maps.godIds, ability.godId, "能力所属神明"),
        sourceAbilityId: null,
        name: ability.name,
        kind: ability.kind,
        effect: ability.effect,
        trigger: ability.trigger,
        cost: ability.cost,
        limitations: ability.limitations,
        mastery: ability.mastery,
        state: ability.state,
        visibility: ability.visibility,
        rumorText: ability.rumorText,
        bloodlineJustification: ability.bloodlineJustification,
        lockedFields: [...ability.lockedFields],
        version: ability.version,
        materialRef: ability.materialRef,
        createdAt: ability.createdAt,
        updatedAt: ability.updatedAt,
      },
    });
    maps.abilityIds.set(ability.id, cloned.id);
  }
  for (const ability of source.abilities) {
    if (ability.sourceAbilityId !== null) {
      await tx.ability.update({
        where: { id: requireMapped(maps.abilityIds, ability.id, "能力") },
        data: {
          sourceAbilityId: requireMapped(
            maps.abilityIds,
            ability.sourceAbilityId,
            "来源能力",
          ),
          updatedAt: ability.updatedAt,
        },
      });
    }
  }

  const memberships = await tx.entityMembership.findMany({
    where: {
      OR: [
        { character: { timelineId: source.id } },
        { faction: { timelineId: source.id } },
      ],
    },
    orderBy: { id: "asc" },
  });
  for (const membership of memberships) {
    await tx.entityMembership.create({
      data: {
        characterId: requireMapped(maps.entityIds, membership.characterId, "成员人物"),
        factionId: requireMapped(maps.entityIds, membership.factionId, "成员势力"),
        role: membership.role,
        isPrimary: membership.isPrimary,
      },
    });
  }

  const events = await tx.abilityEvent.findMany({
    where: {
      OR: [
        { ability: { timelineId: source.id } },
        { chapter: { timelineId: source.id } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  for (const event of events) {
    const clonedEventId = crypto.randomUUID();
    await tx.abilityEvent.create({
      data: {
        id: clonedEventId,
        abilityId: requireMapped(maps.abilityIds, event.abilityId, "能力事件能力"),
        chapterId: requireMapped(maps.chapterIds, event.chapterId, "能力事件章节"),
        messageId: event.messageId === null
          ? null
          : requireMapped(maps.messageIds, event.messageId, "能力事件消息"),
        type: event.type,
        before: nullableJson(event.before),
        after: nullableJson(event.after),
        evidence: event.evidence,
        scale: event.scale,
        dedupeKey: remapEventDedupeKey(event, clonedEventId, child.id, maps),
        createdAt: event.createdAt,
      },
    });
  }

  for (const chronicle of source.chronicles) {
    await tx.chronicleEntry.create({
      data: {
        timelineId: child.id,
        chapterIndex: chronicle.chapterIndex,
        yearLabel: chronicle.yearLabel,
        text: chronicle.text,
        entityIds: chronicle.entityIds.map((id) =>
          requireMapped(maps.entityIds, id, "编年史实体")
        ),
        godIds: chronicle.godIds.map((id) =>
          requireMapped(maps.godIds, id, "编年史神明")
        ),
        revealed: chronicle.revealed,
        revealedAtChapter: chronicle.revealedAtChapter,
        source: chronicle.source,
        createdAt: chronicle.createdAt,
      },
    });
  }

  for (const omen of source.omens) {
    await tx.omenQueue.create({
      data: {
        timelineId: child.id,
        godId: requireMapped(maps.godIds, omen.godId, "征兆神明"),
        text: omen.text,
        consumed: omen.consumed,
        createdAt: omen.createdAt,
      },
    });
  }

  return { timelineId: child.id, maps };
}
