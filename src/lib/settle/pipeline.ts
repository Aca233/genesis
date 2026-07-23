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
  chapterSettlementSchema,
  settlementSystem,
  settlementUserPrompt,
  type ModeAwareChapterSettlement,
} from "@/lib/prompts/settlement";
import { WorldModeSchema, type WorldMode } from "@/lib/world-mode";
import { RealityStateSchema, type RealityState } from "@/lib/reality/schemas";
import {
  OPERATION_LEASE_RENEW_MS,
  WorldOperationConflictError,
  assertWorldOperationOwner,
  claimWorldOperation,
  releaseWorldOperation,
  renewWorldOperation,
  type WorldOperationClient,
} from "@/lib/reality/operation-lock";

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
  | { owner: false; settlement: ModeAwareChapterSettlement };


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

type SettlementTransaction = Prisma.TransactionClient;

async function setState(
  db: Pick<SettlementTransaction, "chapter">,
  chapterId: string,
  step: SettleStep,
) {
  await db.chapter.update({
    where: { id: chapterId },
    data: { settleState: step === "done" ? "settled" : `settling:${step}` },
  });
}

async function withSettlementLeaseFence<T>(
  worldId: string,
  token: string,
  run: (tx: SettlementTransaction) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM worlds WHERE id = ${worldId} FOR UPDATE`;
    await assertSettlementOwnerInTransaction(tx, worldId, token);
    const result = await run(tx);
    await assertSettlementOwnerInTransaction(tx, worldId, token);
    return result;
  }, { timeout: 30_000 });
}

async function assertSettlementOwnerInTransaction(
  tx: SettlementTransaction,
  worldId: string,
  token: string,
): Promise<void> {
  const lease = await tx.world.findUnique({
    where: { id: worldId },
    select: {
      operationKind: true,
      operationToken: true,
      operationLeaseExpiresAt: true,
    },
  });
  if (
    lease?.operationKind !== "settlement"
    || lease.operationToken !== token
    || lease.operationLeaseExpiresAt === null
    || lease.operationLeaseExpiresAt <= new Date()
  ) throw new Error("世界操作租约已失效");
}

/** 组装本章正文（定稿内容，含玩家神谕） */
async function chapterProse(chapterId: string, mode: WorldMode) {
  const messages = await prisma.message.findMany({
    where: { chapterId },
    orderBy: { index: "asc" },
  });
  return {
    prose: messages
      .map((message) =>
        message.role === "player" ? `${mode === "creator" ? "【天外观测】" : "【玩家神谕】"}${message.content}` : message.content,
      )
      .join("\n\n"),
    messages,
  };
}

export type SettlementOperationLease = {
  worldId: string;
  token: string;
  claimed: true;
  /** Test-only override; production uses OPERATION_LEASE_RENEW_MS. */
  heartbeatMs?: number;
};

type SettlementLeaseGuard = {
  assertOwned(): Promise<void>;
  stop(): void;
};

function startSettlementLeaseGuard(
  db: WorldOperationClient,
  worldId: string,
  token: string,
  heartbeatMs: number,
): SettlementLeaseGuard {
  let stopped = false;
  let failure: Error | null = null;
  let renewal: Promise<void> | null = null;

  const renew = () => {
    if (stopped || renewal !== null || failure !== null) return;
    renewal = renewWorldOperation(db, worldId, "settlement", token)
      .then((renewed) => {
        if (!renewed) failure = new Error("世界操作租约已失效");
      })
      .catch(() => {
        failure = new Error("世界操作租约续期失败");
      })
      .finally(() => {
        renewal = null;
      });
  };
  // Renew immediately: an inherited lease can be closer to expiry than the
  // normal heartbeat interval when the settlement runner takes ownership.
  renew();
  const timer = setInterval(renew, heartbeatMs);

  return {
    async assertOwned() {
      if (renewal !== null) await renewal;
      if (failure !== null) throw failure;
      await assertWorldOperationOwner(db, worldId, "settlement", token);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** 获取世界级结算租约，并保证 runner 的所有退出路径都会按 token 释放。 */
export async function* settleChapter(
  chapterId: string,
  lease?: SettlementOperationLease,
): AsyncGenerator<SettleProgress> {
  const operationDb = prisma as unknown as WorldOperationClient;
  const token = lease?.token ?? crypto.randomUUID();
  let worldId = lease?.worldId;
  let ownsLease = lease?.claimed ?? false;
  let leaseGuard: SettlementLeaseGuard | null = null;

  try {
    if (ownsLease && worldId) {
      leaseGuard = startSettlementLeaseGuard(
        operationDb,
        worldId,
        token,
        lease?.heartbeatMs ?? OPERATION_LEASE_RENEW_MS,
      );
      await leaseGuard.assertOwned();
    }

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { timeline: { select: { id: true, worldId: true, world: { select: { activeTimelineId: true } } } } },
    });
    if (!chapter) throw new Error("章节不存在");
    assertActiveReality(chapter.timeline.world.activeTimelineId, chapter.timeline.id);
    if (worldId && worldId !== chapter.timeline.worldId) throw new Error("结算租约与章节世界不匹配");
    worldId = chapter.timeline.worldId;

    if (!ownsLease) {
      const claimed = await claimWorldOperation(operationDb, worldId, "settlement", token);
      if (!claimed.acquired) throw new WorldOperationConflictError(claimed.activeKind);
      ownsLease = true;
    }

    if (!leaseGuard) {
      leaseGuard = startSettlementLeaseGuard(
        operationDb,
        worldId,
        token,
        lease?.heartbeatMs ?? OPERATION_LEASE_RENEW_MS,
      );
      await leaseGuard.assertOwned();
    }
    yield* settleChapterWithLease(chapterId, worldId, token, leaseGuard.assertOwned);
  } finally {
    leaseGuard?.stop();
    if (ownsLease && worldId) {
      await releaseWorldOperation(operationDb, worldId, "settlement", token);
    }
  }
}

/** 结算主流程：模型只调用一次；后续进度均为本地结果应用。 */
async function* settleChapterWithLease(
  chapterId: string,
  worldId: string,
  token: string,
  assertLeaseOwned: () => Promise<void>,
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
  const mode = WorldModeSchema.parse(world.mode);
  assertActiveReality(world.activeTimelineId, timeline.id);
  const parsedReality = RealityStateSchema.safeParse(timeline.realityState);
  if (mode === "creator" && !parsedReality.success) throw new Error("创世主现实状态无效");
  const chapterText = await chapterProse(chapterId, mode);
  const scaleNote = await dominantScale(chapterId);

  // Database CAS makes the model request chapter-global: concurrent settlement runners
  // wait for the winner's persisted response instead of issuing their own request.
  let settlement = readPendingSettlement(chapter.snapshot, mode);
  if (!settlement) {
    const claim = await claimSettlementModel(chapterId, timeline.id, worldId, token, mode);
    if (claim.owner) {
      yield { step: "pantheon", detail: "诸神与史官正在共同结算" };
      try {
        const context = await buildSettlementContext(
          timeline.id,
          chapterText,
          scaleNote,
          world,
          mode,
          parsedReality.success ? parsedReality.data : undefined,
        );
        settlement = await completeStructured("backstage", {
          task: "settlement",
          system: settlementSystem(mode),
          user: settlementUserPrompt(context),
          schema: chapterSettlementSchema(mode),
          maxTokens: 16000,
          maxAttempts: 1,
          transportMaxAttempts: 1,
          allowTransportFallback: false,
          cache: { namespace: `settlement:v1:${mode}` },
        });
        await assertLeaseOwned();
        await assertTimelineStillActive(world.id, timeline.id);
        const creatorRelationTargets = mode === "creator"
          ? await relationTargetResolver(timeline.id)
          : undefined;
        validateSettlementRelationTargets(mode, settlement, creatorRelationTargets);
        await withSettlementLeaseFence(worldId, token, async (tx) => {
          await assertTimelineStillActiveInTransaction(tx, worldId, timeline.id);
          const stored = await tx.chapter.updateMany({
            where: { id: chapterId, timelineId: timeline.id, settleState: claim.leaseState },
            data: {
              snapshot: { pendingSettlement: settlement } as unknown as Prisma.InputJsonValue,
              settleState: "settling:pantheon",
            },
          });
          if (stored.count !== 1) throw new Error("章节结算占用已失效");
        });
      } catch (error) {
        try {
          await withSettlementLeaseFence(worldId, token, async (tx) => {
            await tx.chapter.updateMany({
              where: { id: chapterId, settleState: claim.leaseState },
              data: { settleState: "open" },
            });
          });
        } catch {
          // Lease loss forbids any further settlement mutation, including recovery writes.
        }
        throw error;
      }
    } else {
      yield { step: "pantheon", detail: "正在等待同章结算结果" };
      settlement = claim.settlement;
    }
  }

  const creatorRelationTargets = mode === "creator"
    ? await relationTargetResolver(timeline.id)
    : undefined;
  validateSettlementRelationTargets(mode, settlement, creatorRelationTargets);
  await assertLeaseOwned();
  await assertTimelineStillActive(world.id, timeline.id);
  const afterModel = await prisma.chapter.findUniqueOrThrow({
    where: { id: chapterId },
    select: { settleState: true },
  });
  if (parseState(afterModel.settleState) === "pantheon") {
    yield { step: "pantheon", detail: "诸神行动落定" };
    await assertLeaseOwned();
    await withSettlementLeaseFence(worldId, token, async (tx) => {
      await applyPantheonTurns(tx, timeline.id, chapter.index, settlement.pantheonTurns, mode);
      await setState(tx, chapterId, "extract");
    });
  }

  const current = await prisma.chapter.findUniqueOrThrow({
    where: { id: chapterId },
    select: { settleState: true },
  });
  const startIdx = STEP_ORDER.indexOf(parseState(current.settleState));

  if (startIdx <= STEP_ORDER.indexOf("extract")) {
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    yield { step: "extract" };
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    await withSettlementLeaseFence(worldId, token, async (tx) => {
      await applyExtraction(tx, timeline.id, chapterId, chapterText, settlement.extraction, mode);
      await setState(tx, chapterId, "chronicle");
    });
  }

  if (startIdx <= STEP_ORDER.indexOf("chronicle")) {
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    yield { step: "chronicle" };
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    await withSettlementLeaseFence(worldId, token, async (tx) => {
      await applyChronicle(tx, timeline.id, chapterId, chapter.index, chapter.title, settlement.chronicle);
      await setState(tx, chapterId, "decay");
    });
  }

  if (startIdx <= STEP_ORDER.indexOf("decay")) {
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    yield { step: "decay" };
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    await withSettlementLeaseFence(worldId, token, async (tx) => {
      const staleBefore = chapter.index - 3;
      if (staleBefore > 0) {
        const [entities, recent] = await Promise.all([
          tx.entity.findMany({
            where: {
              timelineId: timeline.id,
              heat: "active",
              isChosen: false,
              starred: false,
              scenePresence: false,
            },
            select: { id: true },
          }),
          tx.chronicleEntry.findMany({
            where: { timelineId: timeline.id, chapterIndex: { gt: staleBefore } },
            select: { entityIds: true },
          }),
        ]);
        const recentIds = new Set(recent.flatMap((entry) => entry.entityIds));
        const toDormant = entities.filter((entity) => !recentIds.has(entity.id)).map((entity) => entity.id);
        if (toDormant.length) {
          await tx.entity.updateMany({
            where: { id: { in: toDormant } },
            data: { heat: "dormant" },
          });
        }
      }
      await setState(tx, chapterId, "snapshot");
    });
  }

  if (startIdx <= STEP_ORDER.indexOf("snapshot")) {
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    yield { step: "snapshot" };
    await assertLeaseOwned();
    await assertTimelineStillActive(world.id, timeline.id);
    await withSettlementLeaseFence(worldId, token, async (tx) => {
      const [gods, entities] = await Promise.all([
        tx.god.findMany({ where: { timelineId: timeline.id } }),
        tx.entity.findMany({
          where: { timelineId: timeline.id },
          include: { sections: true },
        }),
      ]);
      await assertSettlementOwnerInTransaction(tx, worldId, token);
      await tx.chapter.update({
        where: { id: chapterId },
        data: {
          snapshot: { gods, entities, pendingSettlement: settlement } as unknown as Prisma.InputJsonValue,
          settleState: "settled",
        },
      });
      await tx.chapter.upsert({
        where: { timelineId_index: { timelineId: timeline.id, index: chapter.index + 1 } },
        create: { timelineId: timeline.id, index: chapter.index + 1 },
        update: {},
      });
      await assertSettlementOwnerInTransaction(tx, worldId, token);
    });
  }
  yield { step: "done" };
}

type SettlementWorld = {
  id: string;
  mode: string;
  activeTimelineId: string | null;
  themeCard: Prisma.JsonValue | null;
  fusionAxiom: Prisma.JsonValue | null;
};

function assertActiveReality(activeTimelineId: string | null, timelineId: string): void {
  if (activeTimelineId !== timelineId) throw new Error("该现实已被冻结");
}

async function assertTimelineStillActive(worldId: string, timelineId: string): Promise<void> {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
    select: { activeTimelineId: true },
  });
  assertActiveReality(world?.activeTimelineId ?? null, timelineId);
}

async function assertTimelineStillActiveInTransaction(
  tx: SettlementTransaction,
  worldId: string,
  timelineId: string,
): Promise<void> {
  const world = await tx.world.findUnique({
    where: { id: worldId },
    select: { activeTimelineId: true },
  });
  assertActiveReality(world?.activeTimelineId ?? null, timelineId);
}

function modelLeaseExpiry(state: string): number | null {
  if (!state.startsWith(MODEL_STATE_PREFIX)) return null;
  const expiry = Number(state.slice(MODEL_STATE_PREFIX.length).split(":", 1)[0]);
  return Number.isFinite(expiry) ? expiry : 0;
}

async function claimSettlementModel(
  chapterId: string,
  timelineId: string,
  worldId: string,
  token: string,
  mode: WorldMode,
): Promise<SettlementModelClaim> {
  while (true) {
    const attempt = await withSettlementLeaseFence(worldId, token, async (tx) => {
      await assertTimelineStillActiveInTransaction(tx, worldId, timelineId);
      const current = await tx.chapter.findUniqueOrThrow({
        where: { id: chapterId },
        select: { snapshot: true, settleState: true },
      });
      const pending = readPendingSettlement(current.snapshot, mode);
      if (pending) return { kind: "claim", claim: { owner: false, settlement: pending } } as const;
      if (current.settleState === "settled") {
        throw new Error("章节已经完成结算，但缺少可恢复的结算响应");
      }

      const leaseExpiry = modelLeaseExpiry(current.settleState);
      if (leaseExpiry !== null && leaseExpiry > Date.now()) return { kind: "wait" } as const;

      const leaseState = `${MODEL_STATE_PREFIX}${Date.now() + MODEL_LEASE_MS}:${crypto.randomUUID()}`;
      const claimed = await tx.chapter.updateMany({
        where: { id: chapterId, timelineId, settleState: current.settleState },
        data: { settleState: leaseState },
      });
      return claimed.count === 1
        ? { kind: "claim", claim: { owner: true, leaseState } } as const
        : { kind: "retry" } as const;
    });
    if (attempt.kind === "claim") return attempt.claim;
    if (attempt.kind === "wait") await new Promise((resolve) => setTimeout(resolve, MODEL_WAIT_MS));
  }
}

function readPendingSettlement(snapshot: Prisma.JsonValue | null, mode: WorldMode): ModeAwareChapterSettlement | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const pending = (snapshot as Record<string, unknown>).pendingSettlement;
  const parsed = chapterSettlementSchema(mode).safeParse(pending);
  return parsed.success ? parsed.data : null;
}

function labelledChapterMessages(messages: Awaited<ReturnType<typeof chapterProse>>["messages"], mode: WorldMode): string {
  return messages.map((message) => {
    const content = message.role === "player" ? `${mode === "creator" ? "【天外观测】" : "【玩家神谕】"}${message.content}` : message.content;
    return `[${message.id} | ${message.index} | ${message.scale}]\n${content}`;
  }).join("\n\n");
}

async function buildSettlementContext(
  timelineId: string,
  chapterText: Awaited<ReturnType<typeof chapterProse>>,
  scaleNote: string,
  world: SettlementWorld,
  mode: WorldMode,
  reality?: RealityState,
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
  const theme = mode === "creator" && reality
    ? reality.theme
    : (world.themeCard ?? {}) as { eraSystem?: string };
  const fusionAxiom = mode === "creator" && reality
    ? reality.fusionAxiom
    : world.fusionAxiom;
  const raceName = new Map(entities.map((entity) => [entity.id, entity.name]));

  return {
    mode,
    chapterMessages: labelledChapterMessages(chapterText.messages, mode),
    scaleNote,
    eraSystem: theme.eraSystem ?? "纪元",
    currentYearLabel: mode === "creator" && reality
      ? reality.currentEra
      : lastEntry?.yearLabel ?? "元年",
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
    fusionAxiom: fusionAxiom ? JSON.stringify(fusionAxiom) : undefined,
  };
}

async function applyPantheonTurns(
  db: SettlementTransaction,
  timelineId: string,
  chapterIndex: number,
  turns: ModeAwareChapterSettlement["pantheonTurns"],
  mode: WorldMode,
) {
  const gods = await db.god.findMany({
    where: { timelineId, tier: "major", isPlayer: false },
    orderBy: { createdAt: "asc" },
  });
  const relationTargets = mode === "creator"
    ? await relationTargetResolver(timelineId)
    : undefined;
  const already = await db.chronicleEntry.findMany({
    where: { timelineId, chapterIndex, source: "pantheon" },
    select: { godIds: true },
  });
  const acted = new Set(already.flatMap((entry) => entry.godIds));
  const turnByName = new Map(turns.map((turn) => [turn.godName, turn]));

  for (const god of gods) {
    if (acted.has(god.id)) continue;
    const turn = turnByName.get(god.name);
    if (!turn) {
      await db.chronicleEntry.create({
        data: {
          timelineId, chapterIndex, yearLabel: "",
          text: `${god.name}静观本章风云，未有所动。`,
          entityIds: [], godIds: [god.id], revealed: false, source: "pantheon",
        },
      });
      continue;
    }
    await db.chronicleEntry.create({
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
      await db.omenQueue.createMany({
        data: omens.map((text) => ({ timelineId, godId: god.id, text })),
      });
    }
    const agenda = (god.agenda ?? {}) as Record<string, unknown>;
    if (turn.agendaUpdate.shortTermGoals) agenda.shortTermGoals = turn.agendaUpdate.shortTermGoals;
    if (turn.agendaUpdate.schemes) agenda.schemes = turn.agendaUpdate.schemes;
    if ("stanceToPlayer" in turn.agendaUpdate && turn.agendaUpdate.stanceToPlayer) {
      agenda.stanceToPlayer = turn.agendaUpdate.stanceToPlayer;
    }
    const relations = (god.relations ?? {}) as Record<string, unknown>;
    for (const relation of turn.relationsUpdate) {
      const targetId = mode === "creator"
        ? relationTargets!.resolve(relation.target)
        : relation.target;
      relations[targetId] = { label: relation.label, note: relation.note };
    }
    await db.god.update({
      where: { id: god.id },
      data: {
        agenda: agenda as Prisma.InputJsonValue,
        relations: relations as Prisma.InputJsonValue,
      },
    });
  }
}
async function applyChronicle(
  db: SettlementTransaction,
  timelineId: string,
  chapterId: string,
  chapterIndex: number,
  currentTitle: string | null,
  chronicle: ModeAwareChapterSettlement["chronicle"],
) {
  const [entityMap, godMap] = await Promise.all([
    entityNameMap(timelineId),
    godNameMap(timelineId),
  ]);
  {
    const existing = await db.chronicleEntry.findMany({
      where: { timelineId, chapterIndex, source: "narrative", revealed: true },
      select: { yearLabel: true, text: true },
    });
    const existingKeys = new Set(existing.map((entry) => `${entry.yearLabel}\u0000${entry.text}`));
    for (const entry of chronicle.entries) {
      const key = `${entry.yearLabel}\u0000${entry.text}`;
      if (existingKeys.has(key)) continue;
      await db.chronicleEntry.create({
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
    await db.chapter.update({
      where: { id: chapterId },
      data: {
        summary: chronicle.epilogue,
        title: currentTitle ?? chronicle.chapterTitle,
      },
    });
  }
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

type RelationTargetResolver = {
  resolve(target: string): string;
};

async function relationTargetResolver(timelineId: string): Promise<RelationTargetResolver> {
  const [gods, entities] = await Promise.all([
    prisma.god.findMany({ where: { timelineId }, select: { id: true, name: true, aliases: true } }),
    prisma.entity.findMany({ where: { timelineId }, select: { name: true, aliases: true } }),
  ]);
  const godIdsByName = new Map<string, Set<string>>();
  for (const god of gods) {
    for (const name of [god.name, ...god.aliases]) {
      const ids = godIdsByName.get(name) ?? new Set<string>();
      ids.add(god.id);
      godIdsByName.set(name, ids);
    }
  }
  const entityNames = new Set(entities.flatMap((entity) => [entity.name, ...entity.aliases]));
  return {
    resolve(target: string): string {
      const ids = godIdsByName.get(target);
      if (ids?.size === 1) return [...ids][0]!;
      if (ids && ids.size > 1) throw new Error(`神明关系目标“${target}”存在歧义`);
      if (entityNames.has(target)) throw new Error(`神明关系目标“${target}”是实体，不是神明`);
      throw new Error(`无法解析神明关系目标“${target}”`);
    },
  };
}

function validateSettlementRelationTargets(
  mode: WorldMode,
  settlement: ModeAwareChapterSettlement,
  resolver?: RelationTargetResolver,
): void {
  if (mode !== "creator") return;
  if (!resolver) throw new Error("Creator 结算缺少神明关系解析器");
  for (const turn of settlement.pantheonTurns) {
    for (const relation of turn.relationsUpdate) resolver.resolve(relation.target);
  }
  for (const update of settlement.extraction.godUpdates) {
    for (const relation of update.relationChanges ?? []) resolver.resolve(relation.target);
  }
}

async function godNameMap(timelineId: string): Promise<Map<string, string>> {
  const list = await prisma.god.findMany({
    where: { timelineId },
    select: { id: true, name: true, aliases: true },
  });
  const map = new Map<string, string>();
  for (const god of list) {
    map.set(god.name, god.id);
    for (const alias of god.aliases) map.set(alias, god.id);
  }
  return map;
}

/** 应用单次模型响应中的状态抽取；不再发起模型调用。 */
async function applyExtraction(
  db: SettlementTransaction,
  timelineId: string,
  chapterId: string,
  chapterText: Awaited<ReturnType<typeof chapterProse>>,
  extraction: Extraction,
  mode: WorldMode,
) {
  const normalizedExtraction: Extraction = {
    ...extraction,
    newGods: extraction.newGods ?? [],
    majorCharacterPromotions: extraction.majorCharacterPromotions ?? [],
  };
  const tx = db;
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
    const relationTargets = mode === "creator"
      ? await relationTargetResolver(timelineId)
      : undefined;
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
      for (const relation of gu.relationChanges ?? []) {
        const targetId = mode === "creator"
          ? relationTargets!.resolve(relation.target)
          : relation.target;
        relations[targetId] = { label: relation.label, note: relation.note };
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

}

function emblemSeed(name: string): string {
  let h = 5381;
  for (const ch of name) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}
