import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * POST /api/worlds/import —— 导入存档
 * body 为 GET /api/worlds/[id]/export 的导出格式：{ version: 1, exportedAt, world: {...} }
 * 在事务中重建 world 及全部子表：所有记录生成新 id，
 * 通过旧id→新id 映射修复 timelineId/chapterId/entityId/godId 外键引用，
 * 以及 world.activeTimelineId、timeline.parentId、god.codexEntityId、
 * chronicle.entityIds/godIds、omen.godId、god.relations 键。
 * 返回 { worldId }
 */

// ───────────────────────── 导入格式校验（宽松：只取需要的字段） ─────────────────────────

const MessageSchema = z.object({
  index: z.number().int(),
  role: z.string(),
  content: z.string(),
  scale: z.string().catch("scene"),
  variants: z.unknown().optional(),
  meta: z.unknown().optional(),
  createdAt: z.coerce.date().optional(),
});

const ChapterSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  title: z.string().nullish(),
  summary: z.string().nullish(),
  settleState: z.string().catch("open"),
  snapshot: z.unknown().optional(),
  messages: z.array(MessageSchema).default([]),
  createdAt: z.coerce.date().optional(),
});

const GodSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  tier: z.string(),
  isPlayer: z.boolean().default(false),
  rank: z.string().catch("nascent"),
  domains: z.array(z.string()).default([]),
  persona: z.unknown().optional(),
  voice: z.unknown().optional(),
  agenda: z.unknown().optional(),
  agendaRevealed: z.boolean().default(false),
  relations: z.record(z.string(), z.unknown()).nullish(),
  faithScope: z.string().nullish(),
  codexEntityId: z.string().nullish(),
  createdAt: z.coerce.date().optional(),
});

const EntitySectionSchema = z.object({
  key: z.string(),
  content: z.unknown(),
  revealed: z.boolean().default(true),
  rumorText: z.string().nullish(),
  playerLocked: z.boolean().default(false),
});

const EntitySchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  emblemSeed: z.string(),
  imageUrl: z.string().nullish(),
  starred: z.boolean().default(false),
  isChosen: z.boolean().default(false),
  heat: z.string().catch("active"),
  scenePresence: z.boolean().default(false),
  summary: z.string(),
  lockedPaths: z.array(z.string()).default([]),
  sections: z.array(EntitySectionSchema).default([]),
  createdAt: z.coerce.date().optional(),
});

const ChronicleSchema = z.object({
  chapterIndex: z.number().int(),
  yearLabel: z.string(),
  text: z.string(),
  entityIds: z.array(z.string()).default([]),
  godIds: z.array(z.string()).default([]),
  revealed: z.boolean().default(true),
  revealedAtChapter: z.number().int().nullish(),
  source: z.string().catch("narrative"),
  createdAt: z.coerce.date().optional(),
});

const OmenSchema = z.object({
  godId: z.string(),
  text: z.string(),
  consumed: z.boolean().default(false),
  createdAt: z.coerce.date().optional(),
});

const TimelineSchema = z.object({
  id: z.string(),
  parentId: z.string().nullish(),
  forkChapter: z.number().int().nullish(),
  chapters: z.array(ChapterSchema).default([]),
  gods: z.array(GodSchema).default([]),
  entities: z.array(EntitySchema).default([]),
  chronicles: z.array(ChronicleSchema).default([]),
  omens: z.array(OmenSchema).default([]),
  createdAt: z.coerce.date().optional(),
});

const LorebookEntrySchema = z.object({
  keys: z.array(z.string()).default([]),
  content: z.string(),
  enabled: z.boolean().default(true),
  stExtra: z.unknown().optional(),
  source: z.string().catch("imported"),
});

const WorldSchema = z.object({
  name: z.string(),
  genesisInput: z.string(),
  status: z.string().catch("draft"),
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
});

const ImportSchema = z.object({
  version: z.number(),
  world: WorldSchema,
});

// ───────────────────────── 工具 ─────────────────────────

/** 可空 Json 字段：null/undefined → 不写（落库为默认 null） */
function json(v: unknown): Prisma.InputJsonValue | undefined {
  return v == null ? undefined : (v as Prisma.InputJsonValue);
}

/** 必填 Json 字段：null/undefined → JSON null */
function jsonRequired(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

/** 旧 id → 新 id（映射缺失时保留原值，避免丢信息） */
function remap(map: Map<string, string>, id: string): string {
  return map.get(id) ?? id;
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON" }, { status: 400 });
  }

  // 版本门槛：仅支持 version 1
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { version?: unknown }).version !== 1
  ) {
    return NextResponse.json(
      { error: "存档版本不受支持：仅接受 version 为 1 的导出格式" },
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

  // ── 预生成全部新 id 映射（旧id → 新id） ──
  const newWorldId = crypto.randomUUID();
  const timelineMap = new Map<string, string>();
  const chapterMap = new Map<string, string>();
  const godMap = new Map<string, string>();
  const entityMap = new Map<string, string>();
  for (const tl of w.timelines) {
    timelineMap.set(tl.id, crypto.randomUUID());
    for (const ch of tl.chapters) chapterMap.set(ch.id, crypto.randomUUID());
    for (const g of tl.gods) godMap.set(g.id, crypto.randomUUID());
    for (const en of tl.entities) entityMap.set(en.id, crypto.randomUUID());
  }

  // ── 组装批量写入数据（引用全部走映射修复） ──
  const timelineRows: Prisma.TimelineCreateManyInput[] = [];
  const chapterRows: Prisma.ChapterCreateManyInput[] = [];
  const messageRows: Prisma.MessageCreateManyInput[] = [];
  const godRows: Prisma.GodCreateManyInput[] = [];
  const entityRows: Prisma.EntityCreateManyInput[] = [];
  const sectionRows: Prisma.EntitySectionCreateManyInput[] = [];
  const chronicleRows: Prisma.ChronicleEntryCreateManyInput[] = [];
  const omenRows: Prisma.OmenQueueCreateManyInput[] = [];

  for (const tl of w.timelines) {
    const newTlId = timelineMap.get(tl.id)!;
    timelineRows.push({
      id: newTlId,
      worldId: newWorldId,
      parentId: tl.parentId ? remap(timelineMap, tl.parentId) : null,
      forkChapter: tl.forkChapter ?? null,
      createdAt: tl.createdAt,
    });

    for (const ch of tl.chapters) {
      const newChId = chapterMap.get(ch.id)!;
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
      for (const m of ch.messages) {
        messageRows.push({
          chapterId: newChId,
          index: m.index,
          role: m.role,
          content: m.content,
          scale: m.scale,
          variants: json(m.variants),
          meta: json(m.meta),
          createdAt: m.createdAt,
        });
      }
    }

    for (const en of tl.entities) {
      const newEnId = entityMap.get(en.id)!;
      entityRows.push({
        id: newEnId,
        timelineId: newTlId,
        type: en.type,
        name: en.name,
        aliases: en.aliases,
        emblemSeed: en.emblemSeed,
        imageUrl: en.imageUrl ?? null,
        starred: en.starred,
        isChosen: en.isChosen,
        heat: en.heat,
        scenePresence: en.scenePresence,
        summary: en.summary,
        lockedPaths: en.lockedPaths,
        createdAt: en.createdAt,
      });
      for (const s of en.sections) {
        sectionRows.push({
          entityId: newEnId,
          key: s.key,
          content: jsonRequired(s.content),
          revealed: s.revealed,
          rumorText: s.rumorText ?? null,
          playerLocked: s.playerLocked,
        });
      }
    }

    for (const g of tl.gods) {
      // relations 的键是其他神的旧 id → 换成新 id
      let relations: Prisma.InputJsonValue | undefined;
      if (g.relations) {
        relations = Object.fromEntries(
          Object.entries(g.relations).map(([k, v]) => [remap(godMap, k), v]),
        ) as Prisma.InputJsonValue;
      }
      godRows.push({
        id: godMap.get(g.id)!,
        timelineId: newTlId,
        name: g.name,
        aliases: g.aliases,
        tier: g.tier,
        isPlayer: g.isPlayer,
        rank: g.rank,
        domains: g.domains,
        persona: json(g.persona),
        voice: json(g.voice),
        agenda: json(g.agenda),
        agendaRevealed: g.agendaRevealed,
        relations,
        faithScope: g.faithScope ?? null,
        codexEntityId: g.codexEntityId ? remap(entityMap, g.codexEntityId) : null,
        createdAt: g.createdAt,
      });
    }

    for (const c of tl.chronicles) {
      chronicleRows.push({
        timelineId: newTlId,
        chapterIndex: c.chapterIndex,
        yearLabel: c.yearLabel,
        text: c.text,
        entityIds: c.entityIds.map((id) => remap(entityMap, id)),
        godIds: c.godIds.map((id) => remap(godMap, id)),
        revealed: c.revealed,
        revealedAtChapter: c.revealedAtChapter ?? null,
        source: c.source,
        createdAt: c.createdAt,
      });
    }

    for (const o of tl.omens) {
      omenRows.push({
        timelineId: newTlId,
        godId: remap(godMap, o.godId),
        text: o.text,
        consumed: o.consumed,
        createdAt: o.createdAt,
      });
    }
  }

  // ── 事务重建：world → timelines → chapters/entities → messages/sections/gods/… ──
  try {
    await prisma.$transaction([
      prisma.world.create({
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
            ? remap(timelineMap, w.activeTimelineId)
            : null,
          lorebookEntries: {
            create: w.lorebookEntries.map((e) => ({
              keys: e.keys,
              content: e.content,
              enabled: e.enabled,
              stExtra: json(e.stExtra),
              source: e.source,
            })),
          },
        },
      }),
      prisma.timeline.createMany({ data: timelineRows }),
      prisma.chapter.createMany({ data: chapterRows }),
      prisma.message.createMany({ data: messageRows }),
      prisma.entity.createMany({ data: entityRows }),
      prisma.entitySection.createMany({ data: sectionRows }),
      prisma.god.createMany({ data: godRows }),
      prisma.chronicleEntry.createMany({ data: chronicleRows }),
      prisma.omenQueue.createMany({ data: omenRows }),
    ]);
  } catch (err) {
    // 唯一约束冲突（章节序号/消息序号/栏目键重复）等数据问题一律按坏存档处理
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `存档数据无法重建：${message}` },
      { status: 400 },
    );
  }

  return NextResponse.json({ worldId: newWorldId });
}
