import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  AbilityEventTypeSchema,
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
} from "@/lib/abilities/types";
import { validateAbilityOwnership } from "@/lib/abilities/validator";

/**
 * POST /api/worlds/import —— 导入 version 1 或 version 2 存档。
 * 所有记录在单个事务中用新 ID 重建，任何失败都会回滚整个新世界。
 */

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_COLLECTION_ITEMS = 10_000;
const MAX_STRING_LIST_ITEMS = 1_000;
const MAX_TEXT_LENGTH = 1024 * 1024;
const IMPORT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;
const RESERVED_GOD_RELATION_KEYS = new Set(["player"]);

const IdSchema = z.string().min(1).max(512);
const OptionalIdSchema = IdSchema.optional();
const NullableIdSchema = IdSchema.nullish();
const ShortStringSchema = z.string().max(1024);
const TextSchema = z.string().max(MAX_TEXT_LENGTH);
const StringListSchema = z.array(ShortStringSchema).max(MAX_STRING_LIST_ITEMS);

function boundedJsonValue(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    const seen = new WeakSet<object>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.depth > MAX_JSON_DEPTH) return `JSON 深度不能超过 ${MAX_JSON_DEPTH}`;
      if (typeof current.value !== "object" || current.value === null) continue;
      if (seen.has(current.value)) return "JSON 不能包含循环引用";
      seen.add(current.value);
      const children = Array.isArray(current.value)
        ? current.value
        : Object.values(current.value as Record<string, unknown>);
      if (children.length > MAX_COLLECTION_ITEMS) {
        return `JSON 单层项目数不能超过 ${MAX_COLLECTION_ITEMS}`;
      }
      for (const child of children) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return "字段必须是可序列化 JSON";
    if (new TextEncoder().encode(serialized).byteLength > MAX_JSON_BYTES) {
      return `JSON 字段不能超过 ${MAX_JSON_BYTES} 字节`;
    }
    return null;
  } catch {
    return "字段必须是可序列化 JSON";
  }
}

const BoundedJsonSchema = z.unknown().superRefine((value, context) => {
  const error = boundedJsonValue(value);
  if (error !== null) context.addIssue({ code: "custom", message: error });
});

const MessageSchema = z
  .object({
    id: IdSchema,
    chapterId: OptionalIdSchema,
    index: z.number().int().nonnegative(),
    role: ShortStringSchema.min(1),
    content: TextSchema,
    scale: ShortStringSchema.default("scene"),
    variants: BoundedJsonSchema.optional(),
    meta: BoundedJsonSchema.optional(),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const ChapterSchema = z
  .object({
    id: IdSchema,
    timelineId: OptionalIdSchema,
    index: z.number().int().nonnegative(),
    title: ShortStringSchema.nullish(),
    summary: TextSchema.nullish(),
    settleState: ShortStringSchema.default("open"),
    snapshot: BoundedJsonSchema.optional(),
    messages: z.array(MessageSchema).max(MAX_COLLECTION_ITEMS).default([]),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const GodSchema = z
  .object({
    id: IdSchema,
    timelineId: OptionalIdSchema,
    name: ShortStringSchema.min(1),
    aliases: StringListSchema.default([]),
    tier: ShortStringSchema.min(1),
    isPlayer: z.boolean().default(false),
    rank: ShortStringSchema.default("nascent"),
    domains: StringListSchema.default([]),
    persona: BoundedJsonSchema.optional(),
    voice: BoundedJsonSchema.optional(),
    agenda: BoundedJsonSchema.optional(),
    agendaRevealed: z.boolean().default(false),
    relations: z.record(IdSchema, BoundedJsonSchema).nullish(),
    faithScope: TextSchema.nullish(),
    codexEntityId: NullableIdSchema,
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const EntitySectionSchema = z
  .object({
    id: OptionalIdSchema,
    entityId: OptionalIdSchema,
    key: ShortStringSchema.min(1),
    content: BoundedJsonSchema,
    revealed: z.boolean().default(true),
    rumorText: TextSchema.nullish(),
    playerLocked: z.boolean().default(false),
  })
  .strict();

const EntitySchema = z
  .object({
    id: IdSchema,
    timelineId: OptionalIdSchema,
    type: ShortStringSchema.min(1),
    name: ShortStringSchema.min(1),
    aliases: StringListSchema.default([]),
    emblemSeed: ShortStringSchema,
    imageUrl: TextSchema.nullish(),
    starred: z.boolean().default(false),
    isChosen: z.boolean().default(false),
    isMajorCharacter: z.boolean().default(false),
    raceId: NullableIdSchema,
    heat: ShortStringSchema.default("active"),
    scenePresence: z.boolean().default(false),
    summary: TextSchema,
    lockedPaths: StringListSchema.default([]),
    sections: z.array(EntitySectionSchema).max(MAX_COLLECTION_ITEMS).default([]),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const AbilitySchema = z
  .object({
    id: IdSchema,
    timelineId: OptionalIdSchema,
    entityId: NullableIdSchema,
    godId: NullableIdSchema,
    sourceAbilityId: NullableIdSchema,
    name: ShortStringSchema.min(1),
    kind: AbilityKindSchema,
    effect: TextSchema,
    trigger: TextSchema,
    cost: TextSchema,
    limitations: TextSchema,
    mastery: AbilityMasterySchema,
    state: AbilityStateSchema.default("normal"),
    visibility: AbilityVisibilitySchema.default("known"),
    rumorText: TextSchema.nullish(),
    bloodlineJustification: TextSchema.nullish(),
    lockedFields: StringListSchema.default([]),
    version: z.number().int().positive().default(1),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const AbilityEventSchema = z
  .object({
    id: IdSchema,
    abilityId: IdSchema,
    chapterId: IdSchema,
    messageId: NullableIdSchema,
    type: AbilityEventTypeSchema,
    before: BoundedJsonSchema.optional(),
    after: BoundedJsonSchema.optional(),
    evidence: TextSchema,
    scale: ShortStringSchema.min(1),
    dedupeKey: z.string().min(1).max(4096),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const MembershipSchema = z
  .object({
    id: IdSchema,
    characterId: IdSchema,
    factionId: IdSchema,
    role: ShortStringSchema,
    isPrimary: z.boolean().default(false),
  })
  .strict();

const ChronicleSchema = z
  .object({
    id: OptionalIdSchema,
    timelineId: OptionalIdSchema,
    chapterIndex: z.number().int().nonnegative(),
    yearLabel: ShortStringSchema,
    text: TextSchema,
    entityIds: z.array(IdSchema).max(MAX_COLLECTION_ITEMS).default([]),
    godIds: z.array(IdSchema).max(MAX_COLLECTION_ITEMS).default([]),
    revealed: z.boolean().default(true),
    revealedAtChapter: z.number().int().nonnegative().nullish(),
    source: ShortStringSchema.default("narrative"),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const OmenSchema = z
  .object({
    id: OptionalIdSchema,
    timelineId: OptionalIdSchema,
    godId: IdSchema,
    text: TextSchema,
    consumed: z.boolean().default(false),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const TimelineSchema = z
  .object({
    id: IdSchema,
    worldId: OptionalIdSchema,
    parentId: NullableIdSchema,
    forkChapter: z.number().int().nonnegative().nullish(),
    chapters: z.array(ChapterSchema).max(MAX_COLLECTION_ITEMS).default([]),
    gods: z.array(GodSchema).max(MAX_COLLECTION_ITEMS).default([]),
    entities: z.array(EntitySchema).max(MAX_COLLECTION_ITEMS).default([]),
    abilities: z.array(AbilitySchema).max(MAX_COLLECTION_ITEMS).default([]),
    abilityEvents: z.array(AbilityEventSchema).max(MAX_COLLECTION_ITEMS).default([]),
    memberships: z.array(MembershipSchema).max(MAX_COLLECTION_ITEMS).default([]),
    chronicles: z.array(ChronicleSchema).max(MAX_COLLECTION_ITEMS).default([]),
    omens: z.array(OmenSchema).max(MAX_COLLECTION_ITEMS).default([]),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const LorebookEntrySchema = z
  .object({
    id: OptionalIdSchema,
    worldId: OptionalIdSchema,
    keys: StringListSchema.default([]),
    content: TextSchema,
    enabled: z.boolean().default(true),
    stExtra: BoundedJsonSchema.optional(),
    source: ShortStringSchema.default("imported"),
  })
  .strict();

const WorldSchema = z
  .object({
    id: OptionalIdSchema,
    userId: OptionalIdSchema,
    name: ShortStringSchema.min(1),
    genesisInput: TextSchema,
    status: ShortStringSchema.default("draft"),
    draftDeck: BoundedJsonSchema.optional(),
    lockedPaths: StringListSchema.default([]),
    themeCard: BoundedJsonSchema.optional(),
    styleCard: BoundedJsonSchema.optional(),
    cosmology: BoundedJsonSchema.optional(),
    fusionAxiom: BoundedJsonSchema.optional(),
    activeTimelineId: NullableIdSchema,
    timelines: z.array(TimelineSchema).max(100).default([]),
    lorebookEntries: z.array(LorebookEntrySchema).max(MAX_COLLECTION_ITEMS).default([]),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const ImportSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    exportedAt: z.string().datetime().max(64).optional(),
    world: WorldSchema,
  })
  .strict();

class BodyTooLargeError extends Error {}
class InvalidContentLengthError extends Error {}

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new InvalidContentLengthError();
    if (parsed > MAX_BODY_BYTES) throw new BodyTooLargeError();
  }

  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}


function json(v: unknown): Prisma.InputJsonValue | undefined {
  return v == null ? undefined : (v as Prisma.InputJsonValue);
}

function jsonRequired(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

function addMapping(map: Map<string, string>, oldId: string, label: string) {
  if (map.has(oldId)) throw new Error(`重复的${label} ID：${oldId}`);
  map.set(oldId, crypto.randomUUID());
}

function remapRequired(map: Map<string, string>, oldId: string, label: string) {
  const newId = map.get(oldId);
  if (!newId) throw new Error(`${label}引用不存在：${oldId}`);
  return newId;
}

function assertDeclaredOwner(declaredId: string | undefined, ownerId: string, label: string) {
  if (declaredId !== undefined && declaredId !== ownerId) {
    throw new Error(`${label}不属于当前父记录`);
  }
}

type ImportedWorld = z.infer<typeof WorldSchema>;
type ImportedTimeline = z.infer<typeof TimelineSchema>;
type ImportedChapter = z.infer<typeof ChapterSchema>;
type ImportedMessage = z.infer<typeof MessageSchema>;
type ImportedEntity = z.infer<typeof EntitySchema>;
type ImportedGod = z.infer<typeof GodSchema>;
type ImportedAbility = z.infer<typeof AbilitySchema>;

interface TimelineReferenceIndexes {
  chapters: Map<string, ImportedChapter>;
  messageToChapter: Map<string, { message: ImportedMessage; chapterId: string }>;
  entities: Map<string, ImportedEntity>;
  gods: Map<string, ImportedGod>;
  abilities: Map<string, ImportedAbility>;
}

interface GlobalReferenceIndexes {
  timelines: Map<string, TimelineReferenceIndexes>;
  chapters: Map<string, { timelineId: string; value: ImportedChapter }>;
  messageToChapter: Map<
    string,
    { timelineId: string; chapterId: string; value: ImportedMessage }
  >;
  entities: Map<string, { timelineId: string; value: ImportedEntity }>;
  gods: Map<string, { timelineId: string; value: ImportedGod }>;
  abilities: Map<string, { timelineId: string; value: ImportedAbility }>;
}

function buildReferenceIndexes(world: ImportedWorld): GlobalReferenceIndexes {
  const indexes: GlobalReferenceIndexes = {
    timelines: new Map(),
    chapters: new Map(),
    messageToChapter: new Map(),
    entities: new Map(),
    gods: new Map(),
    abilities: new Map(),
  };

  for (const timeline of world.timelines) {
    const local: TimelineReferenceIndexes = {
      chapters: new Map(),
      messageToChapter: new Map(),
      entities: new Map(),
      gods: new Map(),
      abilities: new Map(),
    };
    indexes.timelines.set(timeline.id, local);

    for (const chapter of timeline.chapters) {
      local.chapters.set(chapter.id, chapter);
      indexes.chapters.set(chapter.id, { timelineId: timeline.id, value: chapter });
      for (const message of chapter.messages) {
        local.messageToChapter.set(message.id, { message, chapterId: chapter.id });
        indexes.messageToChapter.set(message.id, {
          timelineId: timeline.id,
          chapterId: chapter.id,
          value: message,
        });
      }
    }
    for (const entity of timeline.entities) {
      local.entities.set(entity.id, entity);
      indexes.entities.set(entity.id, { timelineId: timeline.id, value: entity });
    }
    for (const god of timeline.gods) {
      local.gods.set(god.id, god);
      indexes.gods.set(god.id, { timelineId: timeline.id, value: god });
    }
    for (const ability of timeline.abilities) {
      local.abilities.set(ability.id, ability);
      indexes.abilities.set(ability.id, { timelineId: timeline.id, value: ability });
    }
  }
  return indexes;
}

function requireTimelineRecord<T>(
  map: ReadonlyMap<string, { timelineId: string; value: T }>,
  id: string,
  timelineId: string,
  label: string,
): T {
  const indexed = map.get(id);
  if (indexed === undefined) throw new Error(`${label}引用不存在：${id}`);
  if (indexed.timelineId !== timelineId) throw new Error(`${label}必须属于当前时间线`);
  return indexed.value;
}

async function validateTimelineReferences(
  timeline: ImportedTimeline,
  indexes: GlobalReferenceIndexes,
) {
  const local = indexes.timelines.get(timeline.id);
  if (local === undefined) throw new Error(`时间线索引不存在：${timeline.id}`);

  for (const chapter of timeline.chapters) {
    assertDeclaredOwner(chapter.timelineId, timeline.id, "章节");
    for (const message of chapter.messages) {
      assertDeclaredOwner(message.chapterId, chapter.id, "消息");
    }
  }
  for (const entity of timeline.entities) {
    assertDeclaredOwner(entity.timelineId, timeline.id, "实体");
    if (entity.raceId != null) {
      if (entity.type !== "character") throw new Error("只有 character 实体可以携带 raceId");
      const race = requireTimelineRecord(indexes.entities, entity.raceId, timeline.id, "人物种族");
      if (race.type !== "race") throw new Error("人物 raceId 必须指向 race 实体");
    }
    for (const section of entity.sections) {
      assertDeclaredOwner(section.entityId, entity.id, "实体栏目");
    }
  }
  for (const god of timeline.gods) {
    assertDeclaredOwner(god.timelineId, timeline.id, "神明");
    if (god.codexEntityId != null) {
      requireTimelineRecord(indexes.entities, god.codexEntityId, timeline.id, "神明百科实体");
    }
    for (const relationId of Object.keys(god.relations ?? {})) {
      if (RESERVED_GOD_RELATION_KEYS.has(relationId)) continue;
      requireTimelineRecord(indexes.gods, relationId, timeline.id, "神明关系");
    }
  }
  for (const ability of timeline.abilities) {
    assertDeclaredOwner(ability.timelineId, timeline.id, "能力");
    if (ability.entityId != null) {
      requireTimelineRecord(indexes.entities, ability.entityId, timeline.id, "能力实体");
    }
    if (ability.godId != null) {
      requireTimelineRecord(indexes.gods, ability.godId, timeline.id, "能力神明");
    }
    if (ability.sourceAbilityId != null) {
      requireTimelineRecord(indexes.abilities, ability.sourceAbilityId, timeline.id, "来源能力");
    }
  }
  for (const membership of timeline.memberships) {
    const character = requireTimelineRecord(
      indexes.entities,
      membership.characterId,
      timeline.id,
      "成员人物",
    );
    const faction = requireTimelineRecord(
      indexes.entities,
      membership.factionId,
      timeline.id,
      "成员势力",
    );
    if (character.type !== "character" || faction.type !== "faction") {
      throw new Error("成员关系必须连接 character 与 faction");
    }
  }
  for (const event of timeline.abilityEvents) {
    requireTimelineRecord(indexes.abilities, event.abilityId, timeline.id, "事件能力");
    requireTimelineRecord(indexes.chapters, event.chapterId, timeline.id, "事件章节");
    if (event.messageId != null) {
      const message = indexes.messageToChapter.get(event.messageId);
      if (message === undefined) throw new Error(`事件消息引用不存在：${event.messageId}`);
      if (message.timelineId !== timeline.id) throw new Error("事件消息必须属于当前时间线");
      if (message.chapterId !== event.chapterId) throw new Error("事件消息必须属于事件章节");
    }
  }
  for (const chronicle of timeline.chronicles) {
    assertDeclaredOwner(chronicle.timelineId, timeline.id, "编年史");
    for (const id of chronicle.entityIds) {
      requireTimelineRecord(indexes.entities, id, timeline.id, "编年史实体");
    }
    for (const id of chronicle.godIds) {
      requireTimelineRecord(indexes.gods, id, timeline.id, "编年史神明");
    }
  }
  for (const omen of timeline.omens) {
    assertDeclaredOwner(omen.timelineId, timeline.id, "征兆");
    requireTimelineRecord(indexes.gods, omen.godId, timeline.id, "征兆神明");
  }

  const ownershipTx = {
    entity: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const entity = local.entities.get(where.id);
        return entity
          ? {
              id: entity.id,
              timelineId: timeline.id,
              type: entity.type,
              raceId: entity.raceId ?? null,
            }
          : null;
      },
    },
    god: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const god = local.gods.get(where.id);
        return god ? { id: god.id, timelineId: timeline.id } : null;
      },
    },
    ability: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const ability = local.abilities.get(where.id);
        return ability
          ? {
              id: ability.id,
              timelineId: timeline.id,
              entityId: ability.entityId ?? null,
              godId: ability.godId ?? null,
              sourceAbilityId: ability.sourceAbilityId ?? null,
              kind: ability.kind,
            }
          : null;
      },
    },
  };
  await Promise.all(
    timeline.abilities.map((ability) =>
      validateAbilityOwnership(ownershipTx, {
        id: ability.id,
        timelineId: timeline.id,
        entityId: ability.entityId ?? null,
        godId: ability.godId ?? null,
        sourceAbilityId: ability.sourceAbilityId ?? null,
        kind: ability.kind,
        bloodlineJustification: ability.bloodlineJustification,
      }),
    ),
  );
}


function remapDedupeKey(
  event: z.infer<typeof AbilityEventSchema>,
  newWorldId: string,
  newEventId: string,
  chapterMap: ReadonlyMap<string, string>,
  abilityMap: ReadonlyMap<string, string>,
  messageMap: ReadonlyMap<string, string>,
) {
  const canonical = event.dedupeKey.match(/^([^:]+):([^:]+):([^:]+):([^:]+)$/);
  if (
    canonical?.[1] === event.chapterId &&
    canonical[2] === event.abilityId &&
    canonical[3] === event.type &&
    canonical[4] === event.messageId
  ) {
    return [
      remapRequired(chapterMap as Map<string, string>, event.chapterId, "事件章节"),
      remapRequired(abilityMap as Map<string, string>, event.abilityId, "事件能力"),
      event.type,
      remapRequired(messageMap as Map<string, string>, event.messageId!, "事件消息"),
    ].join(":");
  }
  return `import:${newWorldId}:${newEventId}`;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = JSON.parse(await readBoundedBody(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return NextResponse.json({ error: "存档请求体不能超过 10MB" }, { status: 413 });
    }
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }

  const rawVersion =
    typeof raw === "object" && raw !== null
      ? (raw as { version?: unknown }).version
      : undefined;
  if (rawVersion !== 1 && rawVersion !== 2) {
    return NextResponse.json(
      { error: "存档版本不受支持：仅接受 version 1 或 version 2" },
      { status: 400 },
    );
  }

  const parsed = ImportSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "存档格式校验失败", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const w = parsed.data.world;

  const newWorldId = crypto.randomUUID();
  const timelineMap = new Map<string, string>();
  const chapterMap = new Map<string, string>();
  const messageMap = new Map<string, string>();
  const godMap = new Map<string, string>();
  const entityMap = new Map<string, string>();
  const abilityMap = new Map<string, string>();
  const abilityEventMap = new Map<string, string>();
  const membershipMap = new Map<string, string>();

  try {
    if (w.id !== undefined) {
      for (const timeline of w.timelines) {
        assertDeclaredOwner(timeline.worldId, w.id, "时间线");
      }
      for (const entry of w.lorebookEntries) {
        assertDeclaredOwner(entry.worldId, w.id, "世界书条目");
      }
    }
    for (const tl of w.timelines) {
      addMapping(timelineMap, tl.id, "时间线");
      for (const ch of tl.chapters) {
        addMapping(chapterMap, ch.id, "章节");
        for (const message of ch.messages) addMapping(messageMap, message.id, "消息");
      }
      for (const god of tl.gods) addMapping(godMap, god.id, "神明");
      for (const entity of tl.entities) addMapping(entityMap, entity.id, "实体");
      for (const ability of tl.abilities) addMapping(abilityMap, ability.id, "能力");
      for (const event of tl.abilityEvents) {
        addMapping(abilityEventMap, event.id, "能力事件");
      }
      for (const membership of tl.memberships) {
        addMapping(membershipMap, membership.id, "成员关系");
      }
    }

    const referenceIndexes = buildReferenceIndexes(w);
    for (const timeline of w.timelines) {
      await validateTimelineReferences(timeline, referenceIndexes);
    }

    const timelineRows: Prisma.TimelineCreateManyInput[] = [];
    const chapterRows: Prisma.ChapterCreateManyInput[] = [];
    const messageRows: Prisma.MessageCreateManyInput[] = [];
    const godRows: Prisma.GodCreateManyInput[] = [];
    const entityRows: Prisma.EntityCreateManyInput[] = [];
    const sectionRows: Prisma.EntitySectionCreateManyInput[] = [];
    const abilityRows: Prisma.AbilityCreateManyInput[] = [];
    const membershipRows: Prisma.EntityMembershipCreateManyInput[] = [];
    const eventRows: Prisma.AbilityEventCreateManyInput[] = [];
    const chronicleRows: Prisma.ChronicleEntryCreateManyInput[] = [];
    const omenRows: Prisma.OmenQueueCreateManyInput[] = [];

    for (const tl of w.timelines) {
      const newTlId = remapRequired(timelineMap, tl.id, "时间线");
      timelineRows.push({
        id: newTlId,
        worldId: newWorldId,
        parentId: tl.parentId != null
          ? remapRequired(timelineMap, tl.parentId, "父时间线")
          : null,
        forkChapter: tl.forkChapter ?? null,
        createdAt: tl.createdAt,
      });

      for (const ch of tl.chapters) {
        const newChId = remapRequired(chapterMap, ch.id, "章节");
        chapterRows.push({
          id: newChId,
          timelineId: newTlId,
          index: ch.index,
          title: ch.title ?? null,
          summary: ch.summary ?? null,
          settleState: ch.settleState,
          snapshot: json(ch.snapshot),
          createdAt: ch.createdAt,
        });
        for (const message of ch.messages) {
          messageRows.push({
            id: remapRequired(messageMap, message.id, "消息"),
            chapterId: newChId,
            index: message.index,
            role: message.role,
            content: message.content,
            scale: message.scale,
            variants: json(message.variants),
            meta: json(message.meta),
            createdAt: message.createdAt,
          });
        }
      }

      for (const entity of tl.entities) {
        const newEntityId = remapRequired(entityMap, entity.id, "实体");
        entityRows.push({
          id: newEntityId,
          timelineId: newTlId,
          type: entity.type,
          name: entity.name,
          aliases: entity.aliases,
          emblemSeed: entity.emblemSeed,
          imageUrl: entity.imageUrl ?? null,
          starred: entity.starred,
          isChosen: entity.isChosen,
          isMajorCharacter: entity.isMajorCharacter,
          raceId: entity.raceId != null
            ? remapRequired(entityMap, entity.raceId, "人物种族")
            : null,
          heat: entity.heat,
          scenePresence: entity.scenePresence,
          summary: entity.summary,
          lockedPaths: entity.lockedPaths,
          createdAt: entity.createdAt,
        });
        for (const section of entity.sections) {
          sectionRows.push({
            entityId: newEntityId,
            key: section.key,
            content: jsonRequired(section.content),
            revealed: section.revealed,
            rumorText: section.rumorText ?? null,
            playerLocked: section.playerLocked,
          });
        }
      }

      for (const god of tl.gods) {
        const relations = god.relations
          ? (Object.fromEntries(
              Object.entries(god.relations).map(([id, relation]) => [
                RESERVED_GOD_RELATION_KEYS.has(id)
                  ? id
                  : remapRequired(godMap, id, "神明关系"),
                relation,
              ]),
            ) as Prisma.InputJsonValue)
          : undefined;
        godRows.push({
          id: remapRequired(godMap, god.id, "神明"),
          timelineId: newTlId,
          name: god.name,
          aliases: god.aliases,
          tier: god.tier,
          isPlayer: god.isPlayer,
          rank: god.rank,
          domains: god.domains,
          persona: json(god.persona),
          voice: json(god.voice),
          agenda: json(god.agenda),
          agendaRevealed: god.agendaRevealed,
          relations,
          faithScope: god.faithScope ?? null,
          codexEntityId: god.codexEntityId != null
            ? remapRequired(entityMap, god.codexEntityId, "神明百科实体")
            : null,
          createdAt: god.createdAt,
        });
      }

      for (const ability of tl.abilities) {
        abilityRows.push({
          id: remapRequired(abilityMap, ability.id, "能力"),
          timelineId: newTlId,
          entityId: ability.entityId != null
            ? remapRequired(entityMap, ability.entityId, "能力实体")
            : null,
          godId: ability.godId != null
            ? remapRequired(godMap, ability.godId, "能力神明")
            : null,
          sourceAbilityId: ability.sourceAbilityId != null
            ? remapRequired(abilityMap, ability.sourceAbilityId, "来源能力")
            : null,
          name: ability.name,
          kind: ability.kind,
          effect: ability.effect,
          trigger: ability.trigger,
          cost: ability.cost,
          limitations: ability.limitations,
          mastery: ability.mastery,
          state: ability.state,
          visibility: ability.visibility,
          rumorText: ability.rumorText ?? null,
          bloodlineJustification: ability.bloodlineJustification ?? null,
          lockedFields: ability.lockedFields,
          version: ability.version,
          createdAt: ability.createdAt,
        });
      }

      for (const membership of tl.memberships) {
        membershipRows.push({
          id: remapRequired(membershipMap, membership.id, "成员关系"),
          characterId: remapRequired(entityMap, membership.characterId, "成员人物"),
          factionId: remapRequired(entityMap, membership.factionId, "成员势力"),
          role: membership.role,
          isPrimary: membership.isPrimary,
        });
      }

      for (const event of tl.abilityEvents) {
        const newEventId = remapRequired(abilityEventMap, event.id, "能力事件");
        eventRows.push({
          id: newEventId,
          abilityId: remapRequired(abilityMap, event.abilityId, "事件能力"),
          chapterId: remapRequired(chapterMap, event.chapterId, "事件章节"),
          messageId: event.messageId != null
            ? remapRequired(messageMap, event.messageId, "事件消息")
            : null,
          type: event.type,
          before: json(event.before),
          after: json(event.after),
          evidence: event.evidence,
          scale: event.scale,
          dedupeKey: remapDedupeKey(
            event,
            newWorldId,
            newEventId,
            chapterMap,
            abilityMap,
            messageMap,
          ),
          createdAt: event.createdAt,
        });
      }

      for (const chronicle of tl.chronicles) {
        chronicleRows.push({
          timelineId: newTlId,
          chapterIndex: chronicle.chapterIndex,
          yearLabel: chronicle.yearLabel,
          text: chronicle.text,
          entityIds: chronicle.entityIds.map((id) =>
            remapRequired(entityMap, id, "编年史实体"),
          ),
          godIds: chronicle.godIds.map((id) =>
            remapRequired(godMap, id, "编年史神明"),
          ),
          revealed: chronicle.revealed,
          revealedAtChapter: chronicle.revealedAtChapter ?? null,
          source: chronicle.source,
          createdAt: chronicle.createdAt,
        });
      }

      for (const omen of tl.omens) {
        omenRows.push({
          timelineId: newTlId,
          godId: remapRequired(godMap, omen.godId, "征兆神明"),
          text: omen.text,
          consumed: omen.consumed,
          createdAt: omen.createdAt,
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.world.create({
        data: {
          id: newWorldId,
          name: w.name,
          genesisInput: w.genesisInput,
          status: w.status,
          draftDeck: json(w.draftDeck),
          lockedPaths: w.lockedPaths,
          themeCard: json(w.themeCard),
          styleCard: json(w.styleCard),
          cosmology: json(w.cosmology),
          fusionAxiom: json(w.fusionAxiom),
          activeTimelineId: w.activeTimelineId != null
            ? remapRequired(timelineMap, w.activeTimelineId, "当前时间线")
            : null,
          lorebookEntries: {
            create: w.lorebookEntries.map((entry) => ({
              keys: entry.keys,
              content: entry.content,
              enabled: entry.enabled,
              stExtra: json(entry.stExtra),
              source: entry.source,
            })),
          },
        },
      });
      await tx.timeline.createMany({ data: timelineRows });
      await tx.chapter.createMany({ data: chapterRows });
      await tx.entity.createMany({ data: entityRows });
      await tx.entitySection.createMany({ data: sectionRows });
      await tx.god.createMany({ data: godRows });
      await tx.message.createMany({ data: messageRows });
      await tx.ability.createMany({ data: abilityRows });
      await tx.entityMembership.createMany({ data: membershipRows });
      await tx.abilityEvent.createMany({ data: eventRows });
      await tx.chronicleEntry.createMany({ data: chronicleRows });
      await tx.omenQueue.createMany({ data: omenRows });
    }, IMPORT_TRANSACTION_OPTIONS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `存档数据无法重建：${message}` },
      { status: 400 },
    );
  }

  return NextResponse.json({ worldId: newWorldId });
}
