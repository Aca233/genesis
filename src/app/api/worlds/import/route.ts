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

/**
 * POST /api/worlds/import —— 导入 version 1 或 version 2 存档。
 * 所有记录在单个事务中用新 ID 重建，任何失败都会回滚整个新世界。
 */

const MessageSchema = z
  .object({
    id: z.string().min(1),
    chapterId: z.string().optional(),
    index: z.number().int(),
    role: z.string().min(1),
    content: z.string(),
    scale: z.string().default("scene"),
    variants: z.unknown().optional(),
    meta: z.unknown().optional(),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const ChapterSchema = z
  .object({
    id: z.string().min(1),
    timelineId: z.string().optional(),
    index: z.number().int(),
    title: z.string().nullish(),
    summary: z.string().nullish(),
    settleState: z.string().default("open"),
    snapshot: z.unknown().optional(),
    messages: z.array(MessageSchema).default([]),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const GodSchema = z
  .object({
    id: z.string().min(1),
    timelineId: z.string().optional(),
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    tier: z.string().min(1),
    isPlayer: z.boolean().default(false),
    rank: z.string().default("nascent"),
    domains: z.array(z.string()).default([]),
    persona: z.unknown().optional(),
    voice: z.unknown().optional(),
    agenda: z.unknown().optional(),
    agendaRevealed: z.boolean().default(false),
    relations: z.record(z.string(), z.unknown()).nullish(),
    faithScope: z.string().nullish(),
    codexEntityId: z.string().nullish(),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const EntitySectionSchema = z
  .object({
    id: z.string().optional(),
    entityId: z.string().optional(),
    key: z.string().min(1),
    content: z.unknown(),
    revealed: z.boolean().default(true),
    rumorText: z.string().nullish(),
    playerLocked: z.boolean().default(false),
  })
  .strict();

const EntitySchema = z
  .object({
    id: z.string().min(1),
    timelineId: z.string().optional(),
    type: z.string().min(1),
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    emblemSeed: z.string(),
    imageUrl: z.string().nullish(),
    starred: z.boolean().default(false),
    isChosen: z.boolean().default(false),
    isMajorCharacter: z.boolean().default(false),
    raceId: z.string().nullish(),
    heat: z.string().default("active"),
    scenePresence: z.boolean().default(false),
    summary: z.string(),
    lockedPaths: z.array(z.string()).default([]),
    sections: z.array(EntitySectionSchema).default([]),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const AbilitySchema = z
  .object({
    id: z.string().min(1),
    timelineId: z.string().optional(),
    entityId: z.string().nullish(),
    godId: z.string().nullish(),
    sourceAbilityId: z.string().nullish(),
    name: z.string().min(1),
    kind: AbilityKindSchema,
    effect: z.string(),
    trigger: z.string(),
    cost: z.string(),
    limitations: z.string(),
    mastery: AbilityMasterySchema,
    state: AbilityStateSchema.default("normal"),
    visibility: AbilityVisibilitySchema.default("known"),
    rumorText: z.string().nullish(),
    bloodlineJustification: z.string().nullish(),
    lockedFields: z.array(z.string()).default([]),
    version: z.number().int().positive().default(1),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const AbilityEventSchema = z
  .object({
    id: z.string().min(1),
    abilityId: z.string().min(1),
    chapterId: z.string().min(1),
    messageId: z.string().nullish(),
    type: AbilityEventTypeSchema,
    before: z.unknown().optional(),
    after: z.unknown().optional(),
    evidence: z.string(),
    scale: z.string().min(1),
    dedupeKey: z.string().min(1),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const MembershipSchema = z
  .object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    factionId: z.string().min(1),
    role: z.string(),
    isPrimary: z.boolean().default(false),
  })
  .strict();

const ChronicleSchema = z
  .object({
    id: z.string().optional(),
    timelineId: z.string().optional(),
    chapterIndex: z.number().int(),
    yearLabel: z.string(),
    text: z.string(),
    entityIds: z.array(z.string()).default([]),
    godIds: z.array(z.string()).default([]),
    revealed: z.boolean().default(true),
    revealedAtChapter: z.number().int().nullish(),
    source: z.string().default("narrative"),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const OmenSchema = z
  .object({
    id: z.string().optional(),
    timelineId: z.string().optional(),
    godId: z.string().min(1),
    text: z.string(),
    consumed: z.boolean().default(false),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const TimelineSchema = z
  .object({
    id: z.string().min(1),
    worldId: z.string().optional(),
    parentId: z.string().nullish(),
    forkChapter: z.number().int().nullish(),
    chapters: z.array(ChapterSchema).default([]),
    gods: z.array(GodSchema).default([]),
    entities: z.array(EntitySchema).default([]),
    abilities: z.array(AbilitySchema).default([]),
    abilityEvents: z.array(AbilityEventSchema).default([]),
    memberships: z.array(MembershipSchema).default([]),
    chronicles: z.array(ChronicleSchema).default([]),
    omens: z.array(OmenSchema).default([]),
    createdAt: z.coerce.date().optional(),
  })
  .strict();

const LorebookEntrySchema = z
  .object({
    id: z.string().optional(),
    worldId: z.string().optional(),
    keys: z.array(z.string()).default([]),
    content: z.string(),
    enabled: z.boolean().default(true),
    stExtra: z.unknown().optional(),
    source: z.string().default("imported"),
  })
  .strict();

const WorldSchema = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    name: z.string().min(1),
    genesisInput: z.string(),
    status: z.string().default("draft"),
    draftDeck: z.unknown().optional(),
    lockedPaths: z.array(z.string()).default([]),
    themeCard: z.unknown().optional(),
    styleCard: z.unknown().optional(),
    cosmology: z.unknown().optional(),
    fusionAxiom: z.unknown().optional(),
    activeTimelineId: z.string().nullish(),
    timelines: z.array(TimelineSchema).default([]),
    lorebookEntries: z.array(LorebookEntrySchema).default([]),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  })
  .strict();

const ImportSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    exportedAt: z.string().datetime().optional(),
    world: WorldSchema,
  })
  .strict();

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

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
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
        parentId: tl.parentId
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
          raceId: entity.raceId
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
                remapRequired(godMap, id, "神明关系"),
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
          codexEntityId: god.codexEntityId
            ? remapRequired(entityMap, god.codexEntityId, "神明百科实体")
            : null,
          createdAt: god.createdAt,
        });
      }

      for (const ability of tl.abilities) {
        abilityRows.push({
          id: remapRequired(abilityMap, ability.id, "能力"),
          timelineId: newTlId,
          entityId: ability.entityId
            ? remapRequired(entityMap, ability.entityId, "能力实体")
            : null,
          godId: ability.godId
            ? remapRequired(godMap, ability.godId, "能力神明")
            : null,
          sourceAbilityId: ability.sourceAbilityId
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
          messageId: event.messageId
            ? remapRequired(messageMap, event.messageId, "事件消息")
            : null,
          type: event.type,
          before: json(event.before),
          after: json(event.after),
          evidence: event.evidence,
          scale: event.scale,
          dedupeKey: `import:${newEventId}:${event.dedupeKey}`,
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
          activeTimelineId: w.activeTimelineId
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `存档数据无法重建：${message}` },
      { status: 400 },
    );
  }

  return NextResponse.json({ worldId: newWorldId });
}
