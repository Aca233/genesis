import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildAbilityContext } from "@/lib/abilities/context";
import {
  applyAbilityExtractionInTransaction,
  type AbilityExtractionTx,
} from "@/lib/abilities/extraction";
import { completeStructured } from "@/lib/llm/structured";
import {
  EXTRACTION_MAX_ABILITIES,
  EXTRACTION_MAX_ENTITIES,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  extractionMessageWindows,
  mentionedOwnerIds,
} from "@/lib/settle/extraction-context";
import {
  PantheonTurnSchema,
  pantheonSystem,
  pantheonUserPrompt,
} from "@/lib/prompts/pantheon";
import {
  ExtractionSchema,
  type Extraction,
  ChronicleSchema,
  extractorSystem,
  extractorUserPrompt,
  chronicleSystem,
  chronicleUserPrompt,
  SECTION_TEMPLATES,
} from "@/lib/prompts/extractor";

/**
 * 章末结算流水线（docs/02 §4.2）：
 *   诸神回合（位阶高→低串行）→ 状态抽取 → 编年史压缩 → 热度衰减 → 章快照 → 开新章
 * 状态机存 chapter.settleState："open" | "settling:<step>" | "settled"
 * 每步完成即推进状态，幂等可断点续跑；诸神单神失败降级为「静观」不阻塞。
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

const RANK_ORDER = [
  "sovereign",
  "exalted",
  "ascended",
  "nascent",
  "slumbering",
  "ember",
  "fallen",
];

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

/** 结算主流程：AsyncGenerator 逐步产出进度（SSE 转发用） */
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
  const startStep = parseState(chapter.settleState);
  const startIdx = STEP_ORDER.indexOf(startStep);
  const chapterText = await chapterProse(chapterId);
  const prose = chapterText.prose;
  const scaleNote = await dominantScale(chapterId);

  // ── 1. 诸神回合 ──
  if (startIdx <= STEP_ORDER.indexOf("pantheon")) {
    await setState(chapterId, "pantheon");
    const gods = await prisma.god.findMany({
      where: { timelineId: timeline.id, tier: "major", isPlayer: false },
    });
    gods.sort(
      (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank),
    );

    // 断点续跑：跳过本章已行动的神（以隐藏大事记为凭）
    const already = await prisma.chronicleEntry.findMany({
      where: {
        timelineId: timeline.id,
        chapterIndex: chapter.index,
        source: "pantheon",
      },
      select: { godIds: true },
    });
    const actedGodIds = new Set(already.flatMap((e) => e.godIds));

    const publicAftermath: string[] = [];
    for (let i = 0; i < gods.length; i++) {
      const god = gods[i];
      yield { step: "pantheon", detail: god.name, index: i + 1, total: gods.length };
      if (actedGodIds.has(god.id)) continue;

      try {
        const [relatedEntities, abilityContext] = await Promise.all([
          entitiesTouchedBy(timeline.id, god.name),
          buildAbilityContext({
            timelineId: timeline.id,
            viewer: "backstage",
            subjectGodId: god.id,
            searchText: `${god.name}\n${prose.slice(-6000)}`,
          }),
        ]);
        const turn = await completeStructured("backstage", {
          task: "pantheon",
          system: pantheonSystem(god.name),
          user: pantheonUserPrompt({
            godCard: JSON.stringify({
              persona: god.persona,
              voice: god.voice,
              agenda: god.agenda,
              relations: god.relations,
              rank: god.rank,
              domains: god.domains,
              faithScope: god.faithScope,
            }),
            chapterChronicle: prose.slice(-6000),
            relatedEntities,
            abilityContext,
            fusionAxiom: world.fusionAxiom
              ? JSON.stringify(world.fusionAxiom)
              : undefined,
            earlierTurnsPublic: publicAftermath.join("\n"),
          }),
          schema: PantheonTurnSchema,
          maxTokens: 2000,
        });

        // 行动 → 隐藏大事记
        await prisma.chronicleEntry.create({
          data: {
            timelineId: timeline.id,
            chapterIndex: chapter.index,
            yearLabel: "",
            text: turn.action.description,
            entityIds: [],
            godIds: [god.id],
            revealed: false,
            source: "pantheon",
          },
        });
        // 征兆 → 队列
        if (turn.omen) {
          await prisma.omenQueue.create({
            data: { timelineId: timeline.id, godId: god.id, text: turn.omen },
          });
        }
        // 主动事件 → 也入征兆队列（带钩子前缀，Narrator 开场消费）
        if (turn.proactiveEvent) {
          await prisma.omenQueue.create({
            data: {
              timelineId: timeline.id,
              godId: god.id,
              text: `【主动事件·${turn.proactiveEvent.type}】${turn.proactiveEvent.openingHook}`,
            },
          });
        }
        // 议程/关系增量
        const agenda = (god.agenda ?? {}) as Record<string, unknown>;
        const au = turn.agendaUpdate;
        if (au.shortTermGoals) agenda.shortTermGoals = au.shortTermGoals;
        if (au.schemes) agenda.schemes = au.schemes;
        if (au.stanceToPlayer) agenda.stanceToPlayer = au.stanceToPlayer;
        const relations = (god.relations ?? {}) as Record<string, unknown>;
        for (const r of turn.relationsUpdate) {
          relations[r.target] = { label: r.label, note: r.note };
        }
        await prisma.god.update({
          where: { id: god.id },
          data: {
            agenda: agenda as Prisma.InputJsonValue,
            relations: relations as Prisma.InputJsonValue,
          },
        });
        publicAftermath.push(`${god.name}: ${turn.omen}`);
      } catch {
        // 单神失败 → 静观，不阻塞结算
        await prisma.chronicleEntry.create({
          data: {
            timelineId: timeline.id,
            chapterIndex: chapter.index,
            yearLabel: "",
            text: `${god.name}静观本章风云，未有所动。`,
            entityIds: [],
            godIds: [god.id],
            revealed: false,
            source: "pantheon",
          },
        });
      }
    }
    await setState(chapterId, "extract");
  }

  // ── 2. 状态抽取 ──
  if (startIdx <= STEP_ORDER.indexOf("extract")) {
    yield { step: "extract" };
    await runExtraction(timeline.id, chapterId, chapterText, scaleNote);
    await setState(chapterId, "chronicle");
  }

  // ── 3. 编年史压缩 ──
  if (startIdx <= STEP_ORDER.indexOf("chronicle")) {
    yield { step: "chronicle" };
    const theme = (world.themeCard ?? {}) as { eraSystem?: string };
    const lastEntry = await prisma.chronicleEntry.findFirst({
      where: { timelineId: timeline.id, revealed: true },
      orderBy: { createdAt: "desc" },
    });
    try {
      const out = await completeStructured("backstage", {
        task: "chronicle",
        system: chronicleSystem(),
        user: chronicleUserPrompt({
          chapterProse: prose.slice(-16000),
          eraSystem: theme.eraSystem ?? "纪元",
          currentYearLabel: lastEntry?.yearLabel ?? "元年",
          scaleNote,
        }),
        schema: ChronicleSchema,
        maxTokens: 2000,
      });

      const nameToId = await entityNameMap(timeline.id);
      const godNameToId = await godNameMap(timeline.id);
      for (const e of out.entries) {
        await prisma.chronicleEntry.create({
          data: {
            timelineId: timeline.id,
            chapterIndex: chapter.index,
            yearLabel: e.yearLabel,
            text: e.text,
            entityIds: e.entityNames
              .map((n) => nameToId.get(n))
              .filter((x): x is string => Boolean(x)),
            godIds: e.godNames
              .map((n) => godNameToId.get(n))
              .filter((x): x is string => Boolean(x)),
            revealed: true,
            source: "narrative",
          },
        });
      }
      await prisma.chapter.update({
        where: { id: chapterId },
        data: {
          summary: out.epilogue,
          title: chapter.title ?? out.chapterTitle,
        },
      });
    } catch {
      // 压缩失败：写一条兜底条目
      await prisma.chronicleEntry.create({
        data: {
          timelineId: timeline.id,
          chapterIndex: chapter.index,
          yearLabel: "",
          text: "此章史料散佚，唯余残页。",
          entityIds: [],
          godIds: [],
          revealed: true,
          source: "narrative",
        },
      });
    }
    await setState(chapterId, "decay");
  }

  // ── 4. 热度衰减 ──
  if (startIdx <= STEP_ORDER.indexOf("decay")) {
    yield { step: "decay" };
    // 连续 3 章未出场且非神选者/标星 → dormant
    const staleBefore = chapter.index - 3;
    if (staleBefore > 0) {
      const entities = await prisma.entity.findMany({
        where: {
          timelineId: timeline.id,
          heat: "active",
          isChosen: false,
          starred: false,
          scenePresence: false,
        },
        select: { id: true },
      });
      // 近 3 章被编年史提及的实体保持 active
      const recent = await prisma.chronicleEntry.findMany({
        where: { timelineId: timeline.id, chapterIndex: { gt: staleBefore } },
        select: { entityIds: true },
      });
      const recentIds = new Set(recent.flatMap((e) => e.entityIds));
      const toDormant = entities.filter((e) => !recentIds.has(e.id)).map((e) => e.id);
      if (toDormant.length) {
        await prisma.entity.updateMany({
          where: { id: { in: toDormant } },
          data: { heat: "dormant" },
        });
      }
    }
    await setState(chapterId, "snapshot");
  }

  // ── 5. 章快照 + 开新章 ──
  if (startIdx <= STEP_ORDER.indexOf("snapshot")) {
    yield { step: "snapshot" };
    const [gods, entities] = await Promise.all([
      prisma.god.findMany({ where: { timelineId: timeline.id } }),
      prisma.entity.findMany({
        where: { timelineId: timeline.id },
        include: { sections: true },
      }),
    ]);
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        snapshot: { gods, entities } as unknown as Prisma.InputJsonValue,
      },
    });
    // 开新章（若尚未存在）
    await prisma.chapter.upsert({
      where: {
        timelineId_index: { timelineId: timeline.id, index: chapter.index + 1 },
      },
      create: { timelineId: timeline.id, index: chapter.index + 1 },
      update: {},
    });
    await setState(chapterId, "done");
  }

  yield { step: "done" };
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

async function entitiesTouchedBy(timelineId: string, godName: string): Promise<string> {
  // 简化：该神信仰相关/关系提及的实体摘要（M2 v1：按名字包含匹配）
  const entities = await prisma.entity.findMany({
    where: { timelineId, heat: "active" },
    select: { name: true, type: true, summary: true },
    take: 20,
  });
  return entities
    .filter((e) => e.summary.includes(godName))
    .map((e) => `${e.name}(${e.type}): ${e.summary}`)
    .join("\n");
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

/** 抽取执行与应用 */
async function runExtraction(
  timelineId: string,
  chapterId: string,
  chapterText: Awaited<ReturnType<typeof chapterProse>>,
  scaleNote: string,
) {
  const messageWindows = extractionMessageWindows(chapterText.messages);
  const [entityIndex, godIndex] = await Promise.all([
    prisma.entity.findMany({
      where: { timelineId },
      select: { id: true, name: true, type: true, aliases: true, raceId: true },
    }),
    prisma.god.findMany({
      where: { timelineId },
      select: { id: true, name: true, aliases: true, rank: true, isPlayer: true },
    }),
  ]);
  const relevantIds = mentionedOwnerIds(chapterText.messages, [...entityIndex, ...godIndex.map((god) => ({
    ...god, type: "god", raceId: null,
  }))]);
  const relevantGodIds = godIndex.filter((god) => relevantIds.has(god.id)).map((god) => god.id);
  const entities = await prisma.entity.findMany({
    where: {
      timelineId,
      OR: [
        { id: { in: [...relevantIds] } },
        { type: { notIn: ["race", "character"] }, scenePresence: true },
      ],
    },
    select: {
      id: true, name: true, type: true, aliases: true, summary: true,
      lockedPaths: true, raceId: true,
    },
    take: EXTRACTION_MAX_ENTITIES,
  });
  const gods = godIndex.filter((god) => relevantIds.has(god.id));
  const entityIds = entities.map((entity) => entity.id);
  const abilities = entityIds.length || relevantGodIds.length
    ? await prisma.ability.findMany({
        where: {
          timelineId,
          OR: [
            ...(entityIds.length ? [{ entityId: { in: entityIds } }] : []),
            ...(relevantGodIds.length ? [{ godId: { in: relevantGodIds } }] : []),
            { id: { in: (await prisma.ability.findMany({
              where: { timelineId, entityId: { in: entityIds }, sourceAbilityId: { not: null } },
              select: { sourceAbilityId: true },
              take: EXTRACTION_MAX_ABILITIES,
            })).flatMap((ability) => ability.sourceAbilityId ? [ability.sourceAbilityId] : []) } },
          ],
        },
        include: {
          entity: { select: { name: true, type: true } },
          god: { select: { name: true } },
          sourceAbility: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: EXTRACTION_MAX_ABILITIES,
      })
    : [];

  const lockedList = entities
    .flatMap((e) => e.lockedPaths.map((p) => `${e.name}.${p}`))
    .join(", ");

  const extraction = {
    newEntities: [] as Array<Extraction["newEntities"][number]>,
    newGods: [] as Array<Extraction["newGods"][number]>,
    entityUpdates: [] as Array<Extraction["entityUpdates"][number]>,
    godUpdates: [] as Array<Extraction["godUpdates"][number]>,
    revealSections: [] as Array<Extraction["revealSections"][number]>,
    majorCharacterPromotions: [] as Array<Extraction["majorCharacterPromotions"][number]>,
    abilityChanges: [] as unknown[],
  };
  for (const messages of messageWindows) {
    const windowExtraction = await completeStructured("backstage", {
      task: "extract",
      system: extractorSystem(),
      user: extractorUserPrompt({
        chapterMessages: messages,
        knownEntities: entities
          .map((entity) => {
            const race = entity.raceId
              ? entities.find((candidate) => candidate.id === entity.raceId)?.name ?? entity.raceId
              : "—";
            return `${entity.name}(${entity.type}) race=${race} 别名[${entity.aliases.join("、")}]: ${entity.summary}`;
          })
          .join("\n"),
        knownGods: gods
          .map((g) => `${g.name}${g.isPlayer ? "（玩家神）" : ""} rank=${g.rank}`)
          .join("\n"),
        knownAbilities: abilities
          .map((ability) => {
            const owner = ability.entity?.name ?? ability.god?.name ?? "未知拥有者";
            const source = ability.sourceAbility
              ? `${ability.sourceAbility.name} [${ability.sourceAbilityId}]`
              : "—";
            return `[${ability.id}] ${owner}·${ability.name} kind=${ability.kind} mastery=${ability.mastery} state=${ability.state} source=${source} locked=[${ability.lockedFields.join(", ")}] version=${ability.version}`;
          })
          .join("\n"),
        lockedPaths: lockedList,
        scaleNote,
      }),
      schema: ExtractionSchema,
      maxTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
    });
    extraction.newEntities.push(...windowExtraction.newEntities);
    extraction.newGods.push(...(windowExtraction.newGods ?? []));
    extraction.entityUpdates.push(...windowExtraction.entityUpdates);
    extraction.godUpdates.push(...windowExtraction.godUpdates);
    extraction.revealSections.push(...windowExtraction.revealSections);
    extraction.majorCharacterPromotions.push(...(windowExtraction.majorCharacterPromotions ?? []));
    extraction.abilityChanges.push(...windowExtraction.abilityChanges);
  }

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
      ...extraction.newEntities.filter((entity) => entity.type === "race"),
      ...extraction.newEntities.filter((entity) => entity.type !== "race"),
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
    for (const up of extraction.entityUpdates) {
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
    for (const newGod of extraction.newGods) {
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
    for (const gu of extraction.godUpdates) {
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
    for (const promotion of extraction.majorCharacterPromotions) {
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
    for (const rv of extraction.revealSections) {
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
        changes: extraction.abilityChanges,
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
