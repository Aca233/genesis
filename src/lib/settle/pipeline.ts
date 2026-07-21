import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  applyAbilityExtractionInTransaction,
  type AbilityExtractionTx,
} from "@/lib/abilities/extraction";
import { completeStructured } from "@/lib/llm/structured";
import {
  EXTRACTION_MAX_ABILITIES,
  EXTRACTION_MAX_ENTITIES,
} from "@/lib/settle/extraction-context";
import {
  type Extraction,
  SECTION_TEMPLATES,
} from "@/lib/prompts/extractor";
import {
  ChapterSettlementSchema,
  settlementSystem,
  settlementUserPrompt,
  type ChapterSettlement,
} from "@/lib/prompts/settlement";

/**
 * 章末结算流水线（docs/02 §4.2）：
 *   单次模型响应（诸神行动 + 状态抽取 + 编年史）→ 本地应用 → 热度衰减 → 快照 → 新章
 * 状态机存 chapter.settleState："open" | "settling:<step>" | "settled"。
 * 模型响应先持久化，后续步骤幂等应用，断点续跑时不会再次调用模型。
 */

export type SettleStep =
  | "pantheon"
  | "extract"
  | "chronicle"
  | "decay"
  | "snapshot"
  | "done";

const STEP_ORDER: SettleStep[] = [
  "pantheon",
  "extract",
  "chronicle",
  "decay",
  "snapshot",
  "done",
];

const MODEL_LEASE_MS = 15 * 60 * 1000;
const MODEL_WAIT_MS = 250;
const MODEL_STATE_PREFIX = "settling:model:";

type SettlementModelClaim =
  | { owner: true; leaseState: string }
  | { owner: false; settlement: ChapterSettlement };


export type SettleProgress = {
  step: SettleStep;
  detail?: string; // 如当前神名
  index?: number;
  total?: number;
};

function parseState(settleState: string): SettleStep {
  if (settleState === "open") return "pantheon";
  if (settleState === "settled") return "done";
  const m = settleState.match(/^settling:(.+)$/);
  return (m?.[1] as SettleStep) ?? "pantheon";
}

async function setState(chapterId: string, step: SettleStep) {
  await prisma.chapter.update({
    where: { id: chapterId },
    data: { settleState: step === "done" ? "settled" : `settling:${step}` },
  });
}

/** 组装本章正文（定稿内容，含玩家神谕） */
async function chapterProse(chapterId: string) {
  const messages = await prisma.message.findMany({
    where: { chapterId },
    orderBy: { index: "asc" },
  });
  return {
    prose: messages
      .map((message) =>
        message.role === "player" ? `【玩家神谕】${message.content}` : message.content,
      )
      .join("\n\n"),
    messages,
  };
}

/** 结算主流程：模型只调用一次；后续进度均为本地结果应用。 */
export async function* settleChapter(
  chapterId: string,
): AsyncGenerator<SettleProgress> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { timeline: { include: { world: true } } },
  });
  if (!chapter) throw new Error("章节不存在");
  if (chapter.settleState === "settled") {
    yield { step: "done" };
    return;
  }

  const timeline = chapter.timeline;
  const world = timeline.world;
  const chapterText = await chapterProse(chapterId);
  const scaleNote = await dominantScale(chapterId);

  // Database CAS makes the model request chapter-global: concurrent settlement runners
  // wait for the winner's persisted response instead of issuing their own request.
  let settlement = readPendingSettlement(chapter.snapshot);
  if (!settlement) {
    const claim = await claimSettlementModel(chapterId);
    if (claim.owner) {
      yield { step: "pantheon", detail: "诸神与史官正在共同结算" };
      try {
        const context = await buildSettlementContext(timeline.id, chapterText, scaleNote, world);
        settlement = await completeStructured("backstage", {
          task: "settlement",
          system: settlementSystem(),
          user: settlementUserPrompt(context),
          schema: ChapterSettlementSchema,
          maxTokens: 16000,
          maxAttempts: 1,
          transportMaxAttempts: 1,
          allowTransportFallback: false,
          cache: { namespace: "settlement:v1" },
        });
        const stored = await prisma.chapter.updateMany({
          where: { id: chapterId, settleState: claim.leaseState },
          data: {
            snapshot: { pendingSettlement: settlement } as unknown as Prisma.InputJsonValue,
            settleState: "settling:pantheon",
          },
        });
        if (stored.count !== 1) throw new Error("章节结算占用已失效");
      } catch (error) {
        await prisma.chapter.updateMany({
          where: { id: chapterId, settleState: claim.leaseState },
          data: { settleState: "open" },
        });
        throw error;
      }
    } else {
      yield { step: "pantheon", detail: "正在等待同章结算结果" };
      settlement = claim.settlement;
    }
  }

  const afterModel = await prisma.chapter.findUniqueOrThrow({
    where: { id: chapterId },
    select: { settleState: true },
  });
  if (parseState(afterModel.settleState) === "pantheon") {
    yield { step: "pantheon", detail: "诸神行动落定" };
    await applyPantheonTurns(timeline.id, chapter.index, settlement.pantheonTurns);
    await setState(chapterId, "extract");
  }

  const current = await prisma.chapter.findUniqueOrThrow({
    where: { id: chapterId },
    select: { settleState: true },
  });
  const startIdx = STEP_ORDER.indexOf(parseState(current.settleState));

  if (startIdx <= STEP_ORDER.indexOf("extract")) {
    yield { step: "extract" };
    await applyExtraction(timeline.id, chapterId, chapterText, settlement.extraction);
    await setState(chapterId, "chronicle");
  }

  if (startIdx <= STEP_ORDER.indexOf("chronicle")) {
    yield { step: "chronicle" };
    await applyChronicle(timeline.id, chapterId, chapter.index, chapter.title, settlement.chronicle);
    await setState(chapterId, "decay");
  }

  if (startIdx <= STEP_ORDER.indexOf("decay")) {
    yield { step: "decay" };
    const staleBefore = chapter.index - 3;
    if (staleBefore > 0) {
      const [entities, recent] = await Promise.all([
        prisma.entity.findMany({
          where: {
            timelineId: timeline.id,
            heat: "active",
            isChosen: false,
            starred: false,
            scenePresence: false,
          },
          select: { id: true },
        }),
        prisma.chronicleEntry.findMany({
          where: { timelineId: timeline.id, chapterIndex: { gt: staleBefore } },
          select: { entityIds: true },
        }),
      ]);
      const recentIds = new Set(recent.flatMap((entry) => entry.entityIds));
      const toDormant = entities.filter((entity) => !recentIds.has(entity.id)).map((entity) => entity.id);
      if (toDormant.length) {
        await prisma.entity.updateMany({
          where: { id: { in: toDormant } },
          data: { heat: "dormant" },
        });
      }
    }
    await setState(chapterId, "snapshot");
  }

  if (startIdx <= STEP_ORDER.indexOf("snapshot")) {
    yield { step: "snapshot" };
    const [gods, entities] = await Promise.all([
      prisma.god.findMany({ where: { timelineId: timeline.id } }),
      prisma.entity.findMany({
        where: { timelineId: timeline.id },
        include: { sections: true },
      }),
    ]);
    await prisma.$transaction([
      prisma.chapter.update({
        where: { id: chapterId },
        data: {
          snapshot: { gods, entities, pendingSettlement: settlement } as unknown as Prisma.InputJsonValue,
          settleState: "settled",
        },
      }),
      prisma.chapter.upsert({
        where: { timelineId_index: { timelineId: timeline.id, index: chapter.index + 1 } },
        create: { timelineId: timeline.id, index: chapter.index + 1 },
        update: {},
      }),
    ]);
  }

  yield { step: "done" };
}

type SettlementWorld = {
  themeCard: Prisma.JsonValue | null;
  fusionAxiom: Prisma.JsonValue | null;
};

function modelLeaseExpiry(state: string): number | null {
  if (!state.startsWith(MODEL_STATE_PREFIX)) return null;
  const expiry = Number(state.slice(MODEL_STATE_PREFIX.length).split(":", 1)[0]);
  return Number.isFinite(expiry) ? expiry : 0;
}

async function claimSettlementModel(chapterId: string): Promise<SettlementModelClaim> {
  while (true) {
    const current = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      select: { snapshot: true, settleState: true },
    });
    const pending = readPendingSettlement(current.snapshot);
    if (pending) return { owner: false, settlement: pending };
    if (current.settleState === "settled") {
      throw new Error("章节已经完成结算，但缺少可恢复的结算响应");
    }

    const leaseExpiry = modelLeaseExpiry(current.settleState);
    if (leaseExpiry !== null && leaseExpiry > Date.now()) {
      await new Promise((resolve) => setTimeout(resolve, MODEL_WAIT_MS));
      continue;
    }

    const leaseState = `${MODEL_STATE_PREFIX}${Date.now() + MODEL_LEASE_MS}:${crypto.randomUUID()}`;
    const claimed = await prisma.chapter.updateMany({
      where: { id: chapterId, settleState: current.settleState },
      data: { settleState: leaseState },
    });
    if (claimed.count === 1) return { owner: true, leaseState };
  }
}

function readPendingSettlement(snapshot: Prisma.JsonValue | null): ChapterSettlement | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const pending = (snapshot as Record<string, unknown>).pendingSettlement;
  const parsed = ChapterSettlementSchema.safeParse(pending);
  return parsed.success ? parsed.data : null;
}

function labelledChapterMessages(messages: Awaited<ReturnType<typeof chapterProse>>["messages"]): string {
  return messages.map((message) => {
    const content = message.role === "player" ? `【玩家神谕】${message.content}` : message.content;
    return `[${message.id} | ${message.index} | ${message.scale}]\n${content}`;
  }).join("\n\n");
}

async function buildSettlementContext(
  timelineId: string,
  chapterText: Awaited<ReturnType<typeof chapterProse>>,
  scaleNote: string,
  world: SettlementWorld,
): Promise<Parameters<typeof settlementUserPrompt>[0]> {
  const [entities, gods, abilities, lastEntry] = await Promise.all([
    prisma.entity.findMany({
      where: { timelineId },
      select: {
        id: true, name: true, type: true, aliases: true, summary: true,
        lockedPaths: true, raceId: true, scenePresence: true,
      },
      orderBy: { createdAt: "asc" },
      take: EXTRACTION_MAX_ENTITIES,
    }),
    prisma.god.findMany({
      where: { timelineId },
      select: {
        id: true, name: true, aliases: true, rank: true, tier: true, isPlayer: true,
        persona: true, voice: true, agenda: true, relations: true, domains: true, faithScope: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.ability.findMany({
      where: { timelineId },
      include: {
        entity: { select: { name: true, type: true } },
        god: { select: { name: true } },
        sourceAbility: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: EXTRACTION_MAX_ABILITIES,
    }),
    prisma.chronicleEntry.findFirst({
      where: { timelineId, revealed: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const theme = (world.themeCard ?? {}) as { eraSystem?: string };
  const raceName = new Map(entities.map((entity) => [entity.id, entity.name]));

  return {
    chapterMessages: labelledChapterMessages(chapterText.messages),
    scaleNote,
    eraSystem: theme.eraSystem ?? "纪元",
    currentYearLabel: lastEntry?.yearLabel ?? "元年",
    entities: entities.map((entity) =>
      `${entity.name} [${entity.id}] (${entity.type}) race=${entity.raceId ? raceName.get(entity.raceId) ?? entity.raceId : "—"} aliases=[${entity.aliases.join("、")}] present=${entity.scenePresence}: ${entity.summary}`,
    ).join("\n"),
    gods: gods.filter((god) => god.tier === "major" && !god.isPlayer).map((god) =>
      `${god.name} [${god.id}] rank=${god.rank}\n${JSON.stringify({
        persona: god.persona, voice: god.voice, agenda: god.agenda, relations: god.relations,
        domains: god.domains, faithScope: god.faithScope,
      })}`,
    ).join("\n\n"),
    abilities: abilities.map((ability) => {
      const owner = ability.entity?.name ?? ability.god?.name ?? "未知拥有者";
      const source = ability.sourceAbility ? `${ability.sourceAbility.name} [${ability.sourceAbilityId}]` : "—";
      return `[${ability.id}] ${owner}·${ability.name} kind=${ability.kind} mastery=${ability.mastery} state=${ability.state} visibility=${ability.visibility} source=${source} locked=[${ability.lockedFields.join(", ")}] effect=${ability.effect} trigger=${ability.trigger} cost=${ability.cost} limitations=${ability.limitations}`;
    }).join("\n"),
    lockedPaths: entities.flatMap((entity) => entity.lockedPaths.map((path) => `${entity.name}.${path}`)).join(", "),
    fusionAxiom: world.fusionAxiom ? JSON.stringify(world.fusionAxiom) : undefined,
  };
}

async function applyPantheonTurns(
  timelineId: string,
  chapterIndex: number,
  turns: ChapterSettlement["pantheonTurns"],
) {
  const gods = await prisma.god.findMany({
    where: { timelineId, tier: "major", isPlayer: false },
    orderBy: { createdAt: "asc" },
  });
  const already = await prisma.chronicleEntry.findMany({
    where: { timelineId, chapterIndex, source: "pantheon" },
    select: { godIds: true },
  });
  const acted = new Set(already.flatMap((entry) => entry.godIds));
  const turnByName = new Map(turns.map((turn) => [turn.godName, turn]));

  for (const god of gods) {
    if (acted.has(god.id)) continue;
    const turn = turnByName.get(god.name);
    if (!turn) {
      await prisma.chronicleEntry.create({
        data: {
          timelineId, chapterIndex, yearLabel: "",
          text: `${god.name}静观本章风云，未有所动。`,
          entityIds: [], godIds: [god.id], revealed: false, source: "pantheon",
        },
      });
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.chronicleEntry.create({
        data: {
          timelineId, chapterIndex, yearLabel: "", text: turn.action.description,
          entityIds: [], godIds: [god.id], revealed: false, source: "pantheon",
        },
      });
      const omens = [
        turn.omen,
        turn.proactiveEvent
          ? `【主动事件·${turn.proactiveEvent.type}】${turn.proactiveEvent.openingHook}`
          : null,
      ].filter((value): value is string => Boolean(value));
      if (omens.length) {
        await tx.omenQueue.createMany({
          data: omens.map((text) => ({ timelineId, godId: god.id, text })),
        });
      }
      const agenda = (god.agenda ?? {}) as Record<string, unknown>;
      if (turn.agendaUpdate.shortTermGoals) agenda.shortTermGoals = turn.agendaUpdate.shortTermGoals;
      if (turn.agendaUpdate.schemes) agenda.schemes = turn.agendaUpdate.schemes;
      if (turn.agendaUpdate.stanceToPlayer) agenda.stanceToPlayer = turn.agendaUpdate.stanceToPlayer;
      const relations = (god.relations ?? {}) as Record<string, unknown>;
      for (const relation of turn.relationsUpdate) {
        relations[relation.target] = { label: relation.label, note: relation.note };
      }
      await tx.god.update({
        where: { id: god.id },
        data: {
          agenda: agenda as Prisma.InputJsonValue,
          relations: relations as Prisma.InputJsonValue,
        },
      });
    });
  }
}

async function applyChronicle(
  timelineId: string,
  chapterId: string,
  chapterIndex: number,
  currentTitle: string | null,
  chronicle: ChapterSettlement["chronicle"],
) {
  const [entityMap, godMap] = await Promise.all([
    entityNameMap(timelineId),
    godNameMap(timelineId),
  ]);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.chronicleEntry.findMany({
      where: { timelineId, chapterIndex, source: "narrative", revealed: true },
      select: { yearLabel: true, text: true },
    });
    const existingKeys = new Set(existing.map((entry) => `${entry.yearLabel}\u0000${entry.text}`));
    for (const entry of chronicle.entries) {
      const key = `${entry.yearLabel}\u0000${entry.text}`;
      if (existingKeys.has(key)) continue;
      await tx.chronicleEntry.create({
        data: {
          timelineId,
          chapterIndex,
          yearLabel: entry.yearLabel,
          text: entry.text,
          entityIds: entry.entityNames.map((name) => entityMap.get(name)).filter((id): id is string => Boolean(id)),
          godIds: entry.godNames.map((name) => godMap.get(name)).filter((id): id is string => Boolean(id)),
          revealed: true,
          source: "narrative",
        },
      });
      existingKeys.add(key);
    }
    await tx.chapter.update({
      where: { id: chapterId },
      data: {
        summary: chronicle.epilogue,
        title: currentTitle ?? chronicle.chapterTitle,
      },
    });
  });
}

// ───────────────────────── 辅助 ─────────────────────────

async function dominantScale(chapterId: string): Promise<string> {
  const msgs = await prisma.message.findMany({
    where: { chapterId },
    select: { scale: true },
  });
  const counts = new Map<string, number>();
  for (const m of msgs) counts.set(m.scale, (counts.get(m.scale) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "scene";
  const zh: Record<string, string> = {
    moment: "一瞬（分秒之间）",
    scene: "一幕（当下场景）",
    years: "数年跨度",
    era: "数十年跨度",
    epoch: "百年以上跨度",
  };
  return zh[top] ?? top;
}

async function entityNameMap(timelineId: string): Promise<Map<string, string>> {
  const list = await prisma.entity.findMany({
    where: { timelineId },
    select: { id: true, name: true, aliases: true },
  });
  const map = new Map<string, string>();
  for (const e of list) {
    map.set(e.name, e.id);
    for (const a of e.aliases) map.set(a, e.id);
  }
  return map;
}

async function godNameMap(timelineId: string): Promise<Map<string, string>> {
  const list = await prisma.god.findMany({
    where: { timelineId },
    select: { id: true, name: true, aliases: true },
  });
  const map = new Map<string, string>();
  for (const g of list) {
    map.set(g.name, g.id);
    for (const a of g.aliases) map.set(a, g.id);
  }
  return map;
}

/** 应用单次模型响应中的状态抽取；不再发起模型调用。 */
async function applyExtraction(
  timelineId: string,
  chapterId: string,
  chapterText: Awaited<ReturnType<typeof chapterProse>>,
  extraction: Extraction,
) {
  const normalizedExtraction: Extraction = {
    ...extraction,
    newGods: extraction.newGods ?? [],
    majorCharacterPromotions: extraction.majorCharacterPromotions ?? [],
  };
  await prisma.$transaction(async (tx) => {
    const entityRecords = await tx.entity.findMany({
      where: { timelineId },
      select: {
        id: true, name: true, type: true, aliases: true, summary: true,
        lockedPaths: true, raceId: true,
      },
    });
    const byName = new Map<string, (typeof entityRecords)[number]>();
    for (const entity of entityRecords) {
      byName.set(entity.name, entity);
      for (const alias of entity.aliases) byName.set(alias, entity);
    }
    // 种族必须先建卡，以便同批新人物按正名或别名解析主种族。
    const orderedNewEntities = [
      ...normalizedExtraction.newEntities.filter((entity) => entity.type === "race"),
      ...normalizedExtraction.newEntities.filter((entity) => entity.type !== "race"),
    ];
    for (const ne of orderedNewEntities) {
      if (byName.has(ne.name)) continue;
      if (ne.type !== "character" && ne.raceName !== undefined) {
        console.error("章末新实体被拒绝", { name: ne.name, reason: "只有新人物可以指定 raceName" });
        continue;
      }
      const race = ne.type === "character" && ne.raceName !== undefined
        ? byName.get(ne.raceName)
        : undefined;
      if (ne.type === "character" && ne.raceName !== undefined && race?.type !== "race") {
        console.error("章末新实体被拒绝", {
          name: ne.name,
          reason: `新人物 ${ne.name} 的主种族 ${ne.raceName} 不存在`,
        });
        continue;
      }
      const validKeys = new Set(SECTION_TEMPLATES[ne.type] ?? []);
      const created = await tx.entity.create({
        data: {
          timelineId,
          type: ne.type,
          name: ne.name,
          aliases: ne.aliases,
          emblemSeed: emblemSeed(ne.name),
          summary: ne.summary.slice(0, 200),
          isChosen: ne.isChosen,
          isMajorCharacter: ne.type === "character" && ne.isMajorCharacter,
          raceId: race?.id,
          scenePresence: true,
          sections: {
            create: ne.sections
              .filter((section) => validKeys.has(section.key))
              .map((section) => ({
                key: section.key,
                content: { title: section.title, text: section.text } as Prisma.InputJsonValue,
              })),
          },
        },
        select: {
          id: true, name: true, type: true, aliases: true, summary: true,
          lockedPaths: true, raceId: true,
        },
      });
      byName.set(created.name, created);
      for (const alias of created.aliases) byName.set(alias, created);
    }

    // 既有实体增量
    for (const up of normalizedExtraction.entityUpdates) {
      const target = byName.get(up.name);
      if (!target) continue;
      const locked = new Set(target.lockedPaths);

      const updated = await tx.entity.update({
        where: { id: target.id },
        data: {
          ...(up.summary && !locked.has("summary") ? { summary: up.summary.slice(0, 200) } : {}),
          // Aliases are list-like: preserve first-seen order and dedupe across windows.
          ...(up.newAliases?.length
            ? { aliases: [...new Set([...target.aliases, ...up.newAliases])] }
            : {}),
          ...(up.becameChosen ? { isChosen: true } : {}),
          scenePresence: up.scenePresent,
          heat: "active", // 有更新即复活
        },
        select: {
          id: true, name: true, type: true, aliases: true, summary: true,
          lockedPaths: true, raceId: true,
        },
      });
      byName.set(updated.name, updated);
      for (const alias of updated.aliases) byName.set(alias, updated);
      for (const d of up.sectionDeltas) {
        if (locked.has(d.key)) continue; // player_locked 保护
        // Section title/text are scalar snapshots: later chronological windows win.
        await tx.entitySection.upsert({
          where: { entityId_key: { entityId: target.id, key: d.key } },
          create: {
            entityId: target.id,
            key: d.key,
            content: { title: d.title, text: d.text } as Prisma.InputJsonValue,
          },
          update: {
            content: { title: d.title, text: d.text } as Prisma.InputJsonValue,
          },
        });
      }
    }

    // 诸神状态；新神立即加入索引，供同事务能力创建使用。
    const godRecords = await tx.god.findMany({
      where: { timelineId },
      select: { id: true, name: true, aliases: true, rank: true, isPlayer: true },
    });
    const godByName = new Map<string, (typeof godRecords)[number]>();
    for (const god of godRecords) {
      godByName.set(god.name, god);
      for (const alias of god.aliases) godByName.set(alias, god);
    }
    for (const newGod of normalizedExtraction.newGods) {
      if (godByName.has(newGod.name)) continue;
      const created = await tx.god.create({
        data: {
          timelineId,
          name: newGod.name,
          aliases: newGod.aliases,
          tier: newGod.tier,
          rank: newGod.rank,
          domains: newGod.domains,
          faithScope: newGod.faithScope,
        },
        select: { id: true, name: true, aliases: true, rank: true, isPlayer: true },
      });
      godByName.set(created.name, created);
      for (const alias of created.aliases) godByName.set(alias, created);
    }
    for (const gu of normalizedExtraction.godUpdates) {
      const target = godByName.get(gu.name);
      if (!target) continue;
      const god = await tx.god.findUnique({ where: { id: target.id } });
      if (!god) continue;
      const relations = (god.relations ?? {}) as Record<string, unknown>;
      for (const r of gu.relationChanges ?? []) {
        relations[r.target] = { label: r.label, note: r.note };
      }
      await tx.god.update({
        where: { id: target.id },
        data: {
          relations: relations as Prisma.InputJsonValue,
          ...(gu.rankChange ? { rank: gu.rankChange.to } : {}),
          ...(gu.faithScope ? { faithScope: gu.faithScope } : {}),
        },
      });
    }

    // 主要人物晋升：只接受本章连续正文证据，且目标必须是既有 character。
    const messagesByIndex = new Map(chapterText.messages.map((message) => [message.index, message]));
    for (const promotion of normalizedExtraction.majorCharacterPromotions) {
      const target = byName.get(promotion.name);
      const message = messagesByIndex.get(promotion.evidenceMessageIndex);
      const evidence = promotion.evidence.replace(/\s+/gu, "");
      if (
        target?.type !== "character" || message === undefined || evidence.length < 12 ||
        !message.content.replace(/\s+/gu, "").includes(evidence) ||
        !/(?:领袖|核心人物|关键人物|举足轻重|名震|公认|主心骨|统帅)/u.test(promotion.evidence)
      ) continue;
      await tx.entity.update({ where: { id: target.id }, data: { isMajorCharacter: true } });
    }

    // 迷雾揭示
    for (const rv of normalizedExtraction.revealSections) {
      const target = byName.get(rv.entityName);
      if (!target) continue;
      await tx.entitySection.updateMany({
        where: { entityId: target.id, key: rv.sectionKey },
        data: { revealed: true },
      });
    }

    const currentEntities = [...new Map(
      [...byName.values()].map((entity) => [entity.id, entity]),
    ).values()];
    const currentGods = [...new Map(
      [...godByName.values()].map((god) => [god.id, god]),
    ).values()];
    const owners = [
      ...currentEntities
        .filter((entity) => entity.type === "race" || entity.type === "character")
        .map((entity) => ({
          id: entity.id,
          type: entity.type as "race" | "character",
          name: entity.name,
          aliases: entity.aliases,
          raceId: entity.raceId,
        })),
      ...currentGods.map((god) => ({
        id: god.id,
        type: "god" as const,
        name: god.name,
        aliases: god.aliases,
        raceId: null,
      })),
    ];
    const result = await applyAbilityExtractionInTransaction(
      tx as unknown as AbilityExtractionTx,
      {
        timelineId,
        chapterId,
        owners,
        knownEntityNames: [
          ...currentEntities.flatMap((entity) => [entity.name, ...entity.aliases]),
          ...currentGods.flatMap((god) => [god.name, ...god.aliases]),
        ],
        messages: chapterText.messages,
        changes: normalizedExtraction.abilityChanges,
      },
    );
    for (const rejected of result.rejected) {
      console.error("章末能力变化被拒绝", {
        chapterId,
        item: rejected.index,
        ownerName: typeof rejected.change === "object" && rejected.change !== null && "ownerName" in rejected.change
          ? String(rejected.change.ownerName)
          : "未知",
        reason: rejected.reason,
      });
    }
  }, { timeout: 30_000 });
}

function emblemSeed(name: string): string {
  let h = 5381;
  for (const ch of name) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}
