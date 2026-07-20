import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildAbilityContext } from "@/lib/abilities/context";
import {
  applyAbilityExtraction,
  type AbilityExtractionClient,
} from "@/lib/abilities/extraction";
import { completeStructured } from "@/lib/llm/structured";
import {
  PantheonTurnSchema,
  pantheonSystem,
  pantheonUserPrompt,
} from "@/lib/prompts/pantheon";
import {
  ExtractionSchema,
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
    try {
      await runExtraction(timeline.id, chapterId, chapterText, scaleNote);
    } catch {
      // 抽取失败不阻塞：标记待重抽（meta 层面，M2 简化为跳过）
    }
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
  const [entities, gods, abilities] = await Promise.all([
    prisma.entity.findMany({
      where: { timelineId },
      select: {
        id: true,
        name: true,
        type: true,
        aliases: true,
        summary: true,
        lockedPaths: true,
        raceId: true,
      },
    }),
    prisma.god.findMany({
      where: { timelineId },
      select: { id: true, name: true, aliases: true, rank: true, isPlayer: true },
    }),
    prisma.ability.findMany({
      where: { timelineId },
      include: {
        entity: { select: { name: true, type: true } },
        god: { select: { name: true } },
        sourceAbility: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const lockedList = entities
    .flatMap((e) => e.lockedPaths.map((p) => `${e.name}.${p}`))
    .join(", ");

  const extraction = await completeStructured("backstage", {
    task: "extract",
    system: extractorSystem(),
    user: extractorUserPrompt({
      chapterMessages: chapterText.messages,
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
    maxTokens: 6000,
  });

  const byName = new Map<string, (typeof entities)[number]>();
  for (const e of entities) {
    byName.set(e.name, e);
    for (const a of e.aliases) byName.set(a, e);
  }

  // 新实体建卡
  for (const ne of extraction.newEntities) {
    if (byName.has(ne.name)) continue; // 防重复
    const validKeys = new Set(SECTION_TEMPLATES[ne.type] ?? []);
    await prisma.entity.create({
      data: {
        timelineId,
        type: ne.type,
        name: ne.name,
        aliases: ne.aliases,
        emblemSeed: emblemSeed(ne.name),
        summary: ne.summary.slice(0, 200),
        isChosen: ne.isChosen,
        scenePresence: true,
        sections: {
          create: ne.sections
            .filter((s) => validKeys.has(s.key))
            .map((s) => ({
              key: s.key,
              content: { title: s.title, text: s.text } as Prisma.InputJsonValue,
            })),
        },
      },
    });
  }

  // 既有实体增量
  for (const up of extraction.entityUpdates) {
    const target = byName.get(up.name);
    if (!target) continue;
    const locked = new Set(target.lockedPaths);

    await prisma.entity.update({
      where: { id: target.id },
      data: {
        ...(up.summary && !locked.has("summary") ? { summary: up.summary.slice(0, 200) } : {}),
        ...(up.newAliases?.length
          ? { aliases: [...new Set([...target.aliases, ...up.newAliases])] }
          : {}),
        ...(up.becameChosen ? { isChosen: true } : {}),
        scenePresence: up.scenePresent,
        heat: "active", // 有更新即复活
      },
    });
    for (const d of up.sectionDeltas) {
      if (locked.has(d.key)) continue; // player_locked 保护
      await prisma.entitySection.upsert({
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

  // 诸神状态
  const godByName = new Map<string, (typeof gods)[number]>();
  for (const g of gods) {
    godByName.set(g.name, g);
    for (const a of g.aliases) godByName.set(a, g);
  }
  for (const gu of extraction.godUpdates) {
    const target = godByName.get(gu.name);
    if (!target) continue;
    const god = await prisma.god.findUnique({ where: { id: target.id } });
    if (!god) continue;
    const relations = (god.relations ?? {}) as Record<string, unknown>;
    for (const r of gu.relationChanges ?? []) {
      relations[r.target] = { label: r.label, note: r.note };
    }
    await prisma.god.update({
      where: { id: target.id },
      data: {
        relations: relations as Prisma.InputJsonValue,
        ...(gu.rankChange ? { rank: gu.rankChange.to } : {}),
        ...(gu.faithScope ? { faithScope: gu.faithScope } : {}),
      },
    });
  }

  // 迷雾揭示
  for (const rv of extraction.revealSections) {
    const target = byName.get(rv.entityName);
    if (!target) continue;
    await prisma.entitySection.updateMany({
      where: { entityId: target.id, key: rv.sectionKey },
      data: { revealed: true },
    });
  }

  const owners = [
    ...entities
      .filter((entity) => entity.type === "race" || entity.type === "character")
      .map((entity) => ({
        id: entity.id,
        type: entity.type as "race" | "character",
        name: entity.name,
        aliases: entity.aliases,
        raceId: entity.raceId,
      })),
    ...gods.map((god) => ({
      id: god.id,
      type: "god" as const,
      name: god.name,
      aliases: god.aliases,
      raceId: null,
    })),
  ];
  const result = await applyAbilityExtraction(
    prisma as unknown as AbilityExtractionClient,
    {
      timelineId,
      chapterId,
      owners,
      messages: chapterText.messages,
      changes: extraction.abilityChanges,
    },
  );
  for (const rejected of result.rejected) {
    console.error("章末能力变化被拒绝", {
      chapterId,
      item: rejected.index,
      ownerName: rejected.change.ownerName,
      reason: rejected.reason,
    });
  }
}

function emblemSeed(name: string): string {
  let h = 5381;
  for (const ch of name) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}
