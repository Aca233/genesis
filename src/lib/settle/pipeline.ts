import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  applyAbilityExtractionInTransaction,
  type AbilityExtractionTx,
} from "@/lib/abilities/extraction";
import {
  assignAutomaticIcon,
  type IconAssignmentTx,
} from "@/lib/icons/assignment";
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
  type ChapterSettlement,
  type ModeAwareChapterSettlement,
} from "@/lib/prompts/settlement";
import {
  applySettlementActivity,
  type SettlementActivityTx,
} from "@/lib/world-activity/settlement";
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
const ENTITY_CONTEXT_MAX_SECTIONS = 8;
const ENTITY_CONTEXT_MAX_TITLE_LENGTH = 80;
const ENTITY_CONTEXT_MAX_SECTION_TEXT_LENGTH = 800;

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
        message.role === "player" ? `${mode === "creator" ? "【创世主意图】" : "【玩家神谕】"}${message.content}` : message.content,
      )
      .join("\n\n"),
    messages,
  };
}

export type SettlementOperationLease = {
  worldId: string;
  token: string;
  claimed: true;
  /**
   * 发起结算的用户(多租户 Phase A 归因;槽位解析亦按此用户)。
   * 未传时回退 "local"(单用户遗留;第 4 波 iso-07 由路由传真实值)。
   */
  userId?: string;
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
    if (!chapter) throw new Error("内部记录段不存在");
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
    yield* settleChapterWithLease(chapterId, worldId, token, leaseGuard.assertOwned, lease?.userId ?? "local");
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
  userId: string,
): AsyncGenerator<SettleProgress> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { timeline: { include: { world: true } } },
  });
  if (!chapter) throw new Error("内部记录段不存在");
  if (chapter.settleState === "settled") {
    yield { step: "done" };
    return;
  }

  const timeline = chapter.timeline;
  const world = timeline.world;
  const mode = WorldModeSchema.parse(world.mode);
  const observerTime = timeline.observerState && typeof timeline.observerState === "object" && !Array.isArray(timeline.observerState)
    ? (timeline.observerState as { timeLabel?: unknown }).timeLabel
    : null;
  const realityEra = timeline.realityState && typeof timeline.realityState === "object" && !Array.isArray(timeline.realityState)
    ? (timeline.realityState as { currentEra?: unknown }).currentEra
    : null;
  // 新契约世界（realityState 携带 anchorOrdinal，时间一致设计稿 §12）：结算时间
  // 标签缺失直接失败，禁用「未名纪元/此刻」回退；旧世界保持原有回退值不变。
  const anchorOrdinalValue = timeline.realityState && typeof timeline.realityState === "object" && !Array.isArray(timeline.realityState)
    ? (timeline.realityState as { anchorOrdinal?: unknown }).anchorOrdinal
    : null;
  const temporalFailFast = typeof anchorOrdinalValue === "number";
  let settlementTimeLabel: string;
  if (typeof observerTime === "string" && observerTime.trim()) {
    settlementTimeLabel = observerTime.trim();
  } else if (temporalFailFast) {
    throw new Error("新契约世界的观察状态缺少 timeLabel：结算时间回退已禁用");
  } else {
    settlementTimeLabel = "此刻";
  }
  let settlementEraLabel: string;
  if (typeof realityEra === "string" && realityEra.trim()) {
    settlementEraLabel = realityEra.trim();
  } else if (temporalFailFast) {
    throw new Error("新契约世界的现实状态缺少 currentEra：结算时间回退已禁用");
  } else {
    settlementEraLabel = "未名纪元";
  }
  assertActiveReality(world.activeTimelineId, timeline.id);
  const parsedReality = RealityStateSchema.safeParse(timeline.realityState);
  if (mode === "creator" && !parsedReality.success) throw new Error("创世主现实状态无效");
  const chapterText = await chapterProse(chapterId, mode);
  const scaleInfo = await dominantScale(chapterId);

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
          scaleInfo.note,
          scaleInfo.wide,
          world,
          mode,
          parsedReality.success ? parsedReality.data : undefined,
          temporalFailFast ? settlementTimeLabel : null,
        );
        settlement = await completeStructured("backstage", {
          task: "settlement",
          userId,
          system: settlementSystem(mode),
          user: settlementUserPrompt(context),
          schema: chapterSettlementSchema(mode),
          maxTokens: 16000,
          maxAttempts: 1,
          transportMaxAttempts: 1,
          allowTransportFallback: false,
          // v4：输出 schema 新增 chronicle.eraDigest，防旧缓存响应缺该字段形状。
          cache: { namespace: `settlement:v4:${mode}` },
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
          if (stored.count !== 1) throw new Error("世界整理占用已失效");
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
      await applyPantheonTurns(
        tx,
        timeline.id,
        chapter.index,
        settlementTimeLabel,
        settlement.pantheonTurns,
        mode,
      );
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
    // 结算前在册的神选者名单：寿数检查覆盖率以此为准（本窗口新受印者下窗口才入列）。
    const expectedChosenNames = (await prisma.entity.findMany({
      where: { timelineId: timeline.id, isChosen: true },
      select: { name: true },
    })).map((entity) => entity.name);
    await withSettlementLeaseFence(worldId, token, async (tx) => {
      await applyExtraction(tx, {
        worldId: world.id,
        timelineId: timeline.id,
        chapterId,
        chapterIndex: chapter.index,
        timeLabel: settlementTimeLabel,
        eraLabel: settlementEraLabel,
        chapterText,
        extraction: settlement.extraction,
        mode,
        expectedChosenNames,
        divineCostAudit: mode !== "creator"
          ? (settlement as ChapterSettlement).divineCostAudit
          : undefined,
        wideScale: scaleInfo.wide,
      });
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
      const chronicleEntries = await applyChronicle(
        tx,
        timeline.id,
        chapterId,
        chapter.index,
        settlement.chronicle,
      );
      await applySettlementActivity(tx as unknown as SettlementActivityTx, {
        worldId: world.id,
        timelineId: timeline.id,
        chapterId,
        sourceMessageId: chapterText.messages.at(-1)?.id ?? chapterId,
        worldActivity: settlement.worldActivity,
        chronicleEntries,
      });
      // 将临之事状态维护属编年史应用的一部分，不设独立 SettleStep——
      // SSE 阶段契约与前端结算状态映射保持不变。?? [] 防御引入前的旧 pendingSettlement 快照。
      await applyCanonEventUpdates(
        tx,
        timeline.id,
        chapterId,
        chapter.index,
        chapterText.messages.at(-1)?.id ?? chapterId,
        settlement.canonEventUpdates ?? [],
      );
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
      // 快照 v2：补齐能力/关系/事件/征兆/时间态，使万神殿检查点回溯可完整还原。
      // 现有读者只取 pendingSettlement（readPendingSettlement）；克隆时整份 JSON 经
      // remapRuntimeJson 重映射图内 ID（征兆行 ID 刻意不存——clone 不预映射征兆 ID）。
      const [gods, entities, abilities, entityRelations, worldEvents, omens, canonEvents, timelineState] = await Promise.all([
        tx.god.findMany({ where: { timelineId: timeline.id } }),
        tx.entity.findMany({
          where: { timelineId: timeline.id },
          include: { sections: true },
        }),
        tx.ability.findMany({ where: { timelineId: timeline.id } }),
        tx.entityRelation.findMany({ where: { timelineId: timeline.id } }),
        tx.worldEvent.findMany({ where: { timelineId: timeline.id } }),
        tx.omenQueue.findMany({
          where: { timelineId: timeline.id },
          select: { godId: true, text: true, kind: true, consumed: true, createdAt: true },
        }),
        tx.canonEvent.findMany({ where: { timelineId: timeline.id } }),
        tx.timeline.findUniqueOrThrow({
          where: { id: timeline.id },
          select: { realityState: true, observerState: true },
        }),
      ]);
      await assertSettlementOwnerInTransaction(tx, worldId, token);
      await tx.chapter.update({
        where: { id: chapterId },
        data: {
          snapshot: {
            snapshotVersion: 2,
            gods,
            entities,
            abilities,
            entityRelations,
            worldEvents,
            omens,
            canonEvents,
            temporal: {
              realityState: timelineState.realityState,
              observerState: timelineState.observerState,
            },
            pendingSettlement: settlement,
          } as unknown as Prisma.InputJsonValue,
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
    const content = message.role === "player" ? `${mode === "creator" ? "【创世主意图】" : "【玩家神谕】"}${message.content}` : message.content;
    return `[${message.id} | ${message.index} | ${message.scale}]\n${content}`;
  }).join("\n\n");
}

async function buildSettlementContext(
  timelineId: string,
  chapterText: Awaited<ReturnType<typeof chapterProse>>,
  scaleNote: string,
  wide: boolean,
  world: SettlementWorld,
  mode: WorldMode,
  reality?: RealityState,
  /**
   * 新契约世界（时间一致设计稿 §12）已通过 fail-fast 校验的观察时间标签；
   * 旧世界传 null。用它取代「元年」种子：新世界首次结算尚无编年史条目，
   * 若在此直接抛错会击穿每个新世界的第一次结算，故改注入真实锚点时间——
   * 「元年」这一虚构回退对新契约世界不可达。
   */
  anchorTimeLabel: string | null = null,
): Promise<Parameters<typeof settlementUserPrompt>[0]> {
  const [entities, gods, abilities, lastEntry, worldActivity, pantheonHistory, entityRelations, canonEventRows, chosenMortalRows] = await Promise.all([
    prisma.entity.findMany({
      where: { timelineId },
      select: {
        id: true, name: true, type: true, aliases: true, summary: true,
        lockedPaths: true, raceId: true, scenePresence: true,
        sections: {
          where: { revealed: true, playerLocked: false },
          select: { key: true, content: true },
          orderBy: { key: "asc" },
          take: ENTITY_CONTEXT_MAX_SECTIONS,
        },
      },
      orderBy: { updatedAt: "desc" },
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
      orderBy: { updatedAt: "desc" },
      take: EXTRACTION_MAX_ABILITIES,
    }),
    prisma.chronicleEntry.findFirst({
      where: { timelineId, revealed: true },
      orderBy: { createdAt: "desc" },
    }),
    settlementActivityContext(
      timelineId,
      chapterText.messages.map((message) => message.id),
    ),
    // 每神近期幕后行动史回喂：排除「静观本章风云」填充条目，供结算推进而非复读既往线头
    prisma.chronicleEntry.findMany({
      where: {
        timelineId,
        source: "pantheon",
        text: { not: { contains: "静观本章风云" } },
      },
      select: { godIds: true, yearLabel: true, text: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    // 关系图谱回喂：已存关系随实体卡注入，抽取端只报增量，不复读未变关系
    prisma.entityRelation.findMany({
      where: { timelineId },
      select: { sourceEntityId: true, targetEntityId: true, label: true, note: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    // 将临之事回喂：仅取 pending/eligible——altered/cancelled/occurred 已裁决，
    // 线头不再消耗上下文预算；author_only 内容只进结算审计面，绝不入叙事上下文。
    prisma.canonEvent.findMany({
      where: { timelineId, status: { in: ["pending", "eligible"] } },
      orderBy: { ordinal: "asc" },
    }),
    // 神选者寿数确定性检查：连同 lifespan 栏目（含迷雾中的）供结算逐一表态
    prisma.entity.findMany({
      where: { timelineId, isChosen: true },
      select: {
        id: true,
        name: true,
        sections: {
          where: { key: "lifespan" },
          select: { content: true, revealed: true },
        },
      },
    }),
  ]);
  // 纪元落幕检测：窗口内叙述者消息带纪元变更信号时，装配 ERA TO CLOSE 语料供总纲压缩
  let eraToClose: string | undefined;
  if (eraClosedInWindow(chapterText.messages)) {
    const lastDigest = await prisma.chronicleEntry.findFirst({
      where: { timelineId, source: "era_digest" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const eraEntries = await prisma.chronicleEntry.findMany({
      where: {
        timelineId,
        revealed: true,
        source: { not: "era_digest" },
        ...(lastDigest ? { createdAt: { gt: lastDigest.createdAt } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 120,
      select: { yearLabel: true, text: true },
    });
    // 开局首个检查点就换纪元时无可总纲
    if (eraEntries.length) eraToClose = assembleEraToClose(eraEntries);
  }
  const theme = mode === "creator" && reality
    ? reality.theme
    : (world.themeCard ?? {}) as { eraSystem?: string };
  const fusionAxiom = mode === "creator" && reality
    ? reality.fusionAxiom
    : world.fusionAxiom;
  const raceName = new Map(entities.map((entity) => [entity.id, entity.name]));
  // 与 formatEntitySectionContext 同款的 text 提取；缺栏或非文本内容记「未记」
  const lifespanText = (content: Prisma.JsonValue): string | null => {
    if (!content || typeof content !== "object" || Array.isArray(content)) return null;
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" && text.trim()
      ? text.trim().slice(0, ENTITY_CONTEXT_MAX_SECTION_TEXT_LENGTH)
      : null;
  };
  const chosenMortals = chosenMortalRows.map((mortal) => {
    const section = mortal.sections[0];
    const text = section ? lifespanText(section.content) : null;
    return `${mortal.name} [${mortal.id}] lifespan=${text ?? "未记"}${section?.revealed === false ? "（迷雾中）" : ""}`;
  }).join("\n");

  return {
    mode,
    chapterMessages: labelledChapterMessages(chapterText.messages, mode),
    scaleNote,
    eraSystem: theme.eraSystem ?? "纪元",
    currentYearLabel: mode === "creator" && reality
      ? reality.currentEra
      : lastEntry?.yearLabel ?? anchorTimeLabel ?? "元年",
    entities: entities.map((entity) => {
      const locked = new Set(entity.lockedPaths);
      const sections = entity.sections
        .filter((section) => !locked.has(section.key))
        .map((section) => formatEntitySectionContext(section.key, section.content))
        .filter((section): section is string => section !== null);
      // raceName 即已加载实体的 id→name 映射；关系目标不在映射内（未入取数窗口）则不展示
      const relationRows = entity.type === "character"
        ? entityRelations
          .filter((relation) => relation.sourceEntityId === entity.id && raceName.has(relation.targetEntityId))
          .slice(0, 6)
        : [];
      return [
        `${entity.name} [${entity.id}] (${entity.type}) race=${entity.raceId ? raceName.get(entity.raceId) ?? entity.raceId : "—"} aliases=[${entity.aliases.join("、")}] present=${entity.scenePresence}: ${entity.summary}`,
        ...(sections.length ? ["  EXISTING VISIBLE UNLOCKED SECTIONS:", ...sections] : []),
        ...(relationRows.length
          ? [`  EXISTING RELATIONS (current stored graph — emit relationChanges ONLY for a change to or departure from these): ${relationRows.map((relation) => `→(${relation.label}) ${raceName.get(relation.targetEntityId)}：${relation.note.slice(0, 60)}`).join("；")}`]
          : []),
      ].join("\n");
    }).join("\n\n"),
    gods: gods.filter((god) => god.tier === "major" && !god.isPlayer).map((god) => {
      const recentActions = pantheonHistory
        .filter((entry) => entry.godIds.includes(god.id))
        .slice(0, 3);
      const historyLine = recentActions.length
        ? `\nRECENT OFFSTAGE ACTIONS (advance or conclude, do not repeat): ${recentActions.map((entry) => `${entry.yearLabel}：${entry.text}`).join(" / ")}`
        : "";
      return `${god.name} [${god.id}] rank=${god.rank}\n${JSON.stringify({
        persona: god.persona, voice: god.voice, agenda: god.agenda, relations: god.relations,
        domains: god.domains, faithScope: god.faithScope,
      })}${historyLine}`;
    }).join("\n\n"),
    abilities: abilities.map((ability) => {
      const owner = ability.entity?.name ?? ability.god?.name ?? "未知拥有者";
      const source = ability.sourceAbility ? `${ability.sourceAbility.name} [${ability.sourceAbilityId}]` : "—";
      return `[${ability.id}] ${owner}·${ability.name} kind=${ability.kind} mastery=${ability.mastery} state=${ability.state} visibility=${ability.visibility} source=${source} locked=[${ability.lockedFields.join(", ")}] effect=${ability.effect} trigger=${ability.trigger} cost=${ability.cost} limitations=${ability.limitations}`;
    }).join("\n"),
    lockedPaths: entities.flatMap((entity) => entity.lockedPaths.map((path) => `${entity.name}.${path}`)).join(", "),
    worldActivity,
    fusionAxiom: fusionAxiom ? JSON.stringify(fusionAxiom) : undefined,
    eraToClose,
    canonEvents: canonEventRows.length
      ? canonEventRows.map((event) =>
        `[${event.ref}] ordinal=${event.ordinal} status=${event.status} | ${event.title}（${event.timeLabel}）: ${event.summary} | prerequisites=${JSON.stringify(event.prerequisites)}${event.blockers ? ` | blockers=${JSON.stringify(event.blockers)}` : ""}`,
      ).join("\n")
      : undefined,
    timeBudget: wide ? scaleNote : undefined,
    chosenMortals: chosenMortalRows.length ? chosenMortals : undefined,
  };
}

/**
 * 检查点窗口内是否发生纪元落幕：任一叙述者消息的 meta 带 temporalState.era
 * 或 settlementReasons 含 era_change（两信号均由 finalize 落库）。
 */
function eraClosedInWindow(
  messages: Awaited<ReturnType<typeof chapterProse>>["messages"],
): boolean {
  return messages.some((message) => {
    if (message.role !== "narrator") return false;
    const meta = message.meta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
    const record = meta as Record<string, unknown>;
    const temporal = record.temporalState;
    if (
      temporal && typeof temporal === "object" && !Array.isArray(temporal)
      && typeof (temporal as { era?: unknown }).era === "string"
      && (temporal as { era: string }).era.trim()
    ) return true;
    return Array.isArray(record.settlementReasons)
      && record.settlementReasons.includes("era_change");
  });
}

const ERA_TO_CLOSE_HEADER = "The chronicle lines below belong to the era that ended within this checkpoint. Distill them into chronicle.eraDigest.";
const ERA_TO_CLOSE_MAX_CHARS = 8000;
const ERA_TO_CLOSE_HEAD_LINES = 20;

/** 超预算时保留前 20 行 + 从尾部回填，两段之间以单独一行 `…` 标记省略。 */
function assembleEraToClose(entries: { yearLabel: string; text: string }[]): string {
  const lines = entries.map((entry) => `[${entry.yearLabel}] ${entry.text}`);
  const full = [ERA_TO_CLOSE_HEADER, ...lines].join("\n");
  if (full.length <= ERA_TO_CLOSE_MAX_CHARS) return full;
  const head = lines.slice(0, ERA_TO_CLOSE_HEAD_LINES);
  const rest = lines.slice(ERA_TO_CLOSE_HEAD_LINES);
  let budget = ERA_TO_CLOSE_MAX_CHARS - [ERA_TO_CLOSE_HEADER, ...head, "…"].join("\n").length;
  const tail: string[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = rest[i]!.length + 1; // 换行
    if (cost > budget) break;
    tail.unshift(rest[i]!);
    budget -= cost;
  }
  return [ERA_TO_CLOSE_HEADER, ...head, "…", ...tail].join("\n");
}

function formatEntitySectionContext(key: string, content: Prisma.JsonValue): string | null {
  if (!content || typeof content !== "object" || Array.isArray(content)) return null;
  const record = content as Record<string, unknown>;
  if (typeof record.text !== "string" || record.text.trim().length === 0) return null;
  const title = typeof record.title === "string" && record.title.trim().length > 0
    ? record.title.trim().slice(0, ENTITY_CONTEXT_MAX_TITLE_LENGTH)
    : key;
  const text = record.text.trim().slice(0, ENTITY_CONTEXT_MAX_SECTION_TEXT_LENGTH);
  return `  - ${key} | ${title}: ${text}`;
}

async function settlementActivityContext(
  timelineId: string,
  checkpointMessageIds: string[],
): Promise<string> {
  const [activities, events] = await Promise.all([
    checkpointMessageIds.length
      ? prisma.worldActivity.findMany({
        where: {
          timelineId,
          sourceMessageId: { in: checkpointMessageIds },
          recordType: "activity",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 40,
      })
      : Promise.resolve([]),
    prisma.worldEvent.findMany({
      where: { timelineId, resolvedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 20,
    }),
  ]);
  return [
    "CHECKPOINT ACTIVITIES:",
    ...(activities.length
      ? activities.map((activity) =>
        `${activity.id} | ${activity.kind} | visibility=${activity.visibility} | subjects=[${activity.subjectIds.join(",")}] | ${activity.text}`,
      )
      : ["—"]),
    "UNRESOLVED EVENTS:",
    ...(events.length
      ? events.map((event) =>
        `${event.id} | ${event.kind} | ${event.phase} | visibility=${event.visibility} | participants=[${event.participantIds.join(",")}] | ${event.title}: ${event.summary}`,
      )
      : ["—"]),
  ].join("\n");
}

async function applyPantheonTurns(
  db: SettlementTransaction,
  timelineId: string,
  chapterIndex: number,
  timeLabel: string,
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
          timelineId, chapterIndex, yearLabel: timeLabel,
          text: `${god.name}静观本章风云，未有所动。`,
          entityIds: [], godIds: [god.id], revealed: false, source: "pantheon",
        },
      });
      continue;
    }
    await db.chronicleEntry.create({
      data: {
        timelineId, chapterIndex, yearLabel: timeLabel, text: turn.action.description,
        entityIds: [], godIds: [god.id], revealed: false, source: "pantheon",
      },
    });
    // 主动事件与普通征兆分型入队：kind 列承担判别，type 风味留在钩子行文本身，
    // 队列文本不再携带任何前缀标记。
    const queueRows = [
      ...(turn.omen ? [{ text: turn.omen, kind: "omen" }] : []),
      ...(turn.proactiveEvent
        ? [{ text: turn.proactiveEvent.openingHook, kind: "proactive" }]
        : []),
    ];
    if (queueRows.length) {
      await db.omenQueue.createMany({
        data: queueRows.map((row) => ({
          timelineId, godId: god.id, text: row.text, kind: row.kind,
        })),
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
  chronicle: ModeAwareChapterSettlement["chronicle"],
) {
  const [entityMap, godMap] = await Promise.all([
    entityNameMap(timelineId),
    godNameMap(timelineId),
  ]);
  const activityEntries = chronicle.entries.map((entry) => ({
    yearLabel: entry.yearLabel,
    text: entry.text,
    subjectIds: [
      ...entry.entityNames.map((name) => entityMap.get(name)),
      ...entry.godNames.map((name) => godMap.get(name)),
    ].filter((id): id is string => id !== undefined),
  }));
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
        title: null,
      },
    });
    // 纪元总纲入库：幂等键 = source + yearLabel，结算断点重跑不重写。
    // digest 不并入返回的 activityEntries——它不是检查点动态，不进 applySettlementActivity。
    const digest = chronicle.eraDigest;
    if (digest?.text?.trim()) {
      const dup = await db.chronicleEntry.findMany({
        where: { timelineId, source: "era_digest", yearLabel: digest.closedEra.slice(0, 120) },
        take: 1,
        select: { yearLabel: true },
      });
      if (!dup.length) {
        await db.chronicleEntry.create({
          data: {
            timelineId,
            chapterIndex,
            yearLabel: digest.closedEra.slice(0, 120),
            text: digest.text.slice(0, 600),
            entityIds: [],
            godIds: [],
            revealed: true,
            source: "era_digest",
          },
        });
      }
    }
  }
  return activityEntries;
}

/**
 * 将临之事状态机应用（canon_events 由卡组物化，结算侧只做状态维护）：
 * - 合法迁移：pending→eligible/altered/cancelled/occurred；eligible→occurred/altered/cancelled。
 *   非法迁移静默跳过——这同时使结算断点重跑幂等：重跑看到已迁移的状态即跳过。
 * - eligible 且带 rumor 时落一条 public 传闻 WorldActivity（稳定 ID 幂等守卫），
 *   它经 buildWorldActivityContext 流入叙事者 CURRENT WORLD ACTIVITY 块与动态抽屉，
 *   即玩家侧半透出的全部——author_only 字段本身永不进入叙事上下文（docs §3.4/§8.1）。
 * 刻意不做（导演内核接手前的边界）：occurred 不自动建 WorldEvent——事件经正文与
 * 结算 worldActivity 机制自然成真；altered/cancelled 不产传闻——改道说明留在
 * divergenceNote 作者侧；任何 canon 字段都不注入叙事者提示词。
 */
async function applyCanonEventUpdates(
  db: SettlementTransaction,
  timelineId: string,
  chapterId: string,
  chapterIndex: number,
  sourceMessageId: string,
  updates: readonly {
    ref: string;
    status: "eligible" | "altered" | "cancelled" | "occurred";
    note: string;
    rumor?: string | null;
  }[],
): Promise<void> {
  if (!updates.length) return;
  const LEGAL: Record<string, ReadonlySet<string>> = {
    pending: new Set(["eligible", "altered", "cancelled", "occurred"]),
    eligible: new Set(["occurred", "altered", "cancelled"]),
  };
  // 传闻行的纪元/时刻标签解析与 world-activity/settlement.ts createProgressOnce 同款
  // （helpers 为私有作用域，此处内联同构实现，不跨模块引私有函数）。
  const timelineRow = await db.timeline.findUnique({
    where: { id: timelineId },
    select: { realityState: true, observerState: true },
  });
  const jsonRecord = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  // 新契约世界（realityState 携带 anchorOrdinal，设计稿 §12）禁用时间回退；
  // 旧世界保持「未名纪元/此刻」回退值不变。
  const canonTemporalFailFast =
    typeof jsonRecord(timelineRow?.realityState).anchorOrdinal === "number";
  const labelOr = (value: unknown, fallback: string, missingMessage: string): string => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (canonTemporalFailFast) throw new Error(missingMessage);
    return fallback;
  };
  const eraLabel = labelOr(
    jsonRecord(timelineRow?.realityState).currentEra,
    "未名纪元",
    "新契约世界的现实状态缺少 currentEra：将临之事传闻时间回退已禁用",
  );
  const timeLabel = labelOr(
    jsonRecord(timelineRow?.observerState).timeLabel,
    "此刻",
    "新契约世界的观察状态缺少 timeLabel：将临之事传闻时间回退已禁用",
  );

  for (const update of updates) {
    const row = await db.canonEvent.findUnique({
      where: { timelineId_ref: { timelineId, ref: update.ref } },
    });
    if (!row) {
      console.error("将临之事更新被拒绝", { chapterId, ref: update.ref, reason: "不存在" });
      continue;
    }
    if (!LEGAL[row.status]?.has(update.status)) continue;
    await db.canonEvent.update({
      where: { id: row.id },
      data: {
        status: update.status,
        ...(update.status === "altered" || update.status === "cancelled"
          ? { divergenceNote: update.note }
          : {}),
        ...(update.status === "occurred" ? { occurredChapterIndex: chapterIndex } : {}),
      },
    });
    if (update.status === "eligible" && update.rumor) {
      const rumorId = `canon-rumor:${chapterId}:${row.ref}`;
      if (!await db.worldActivity.findUnique({ where: { id: rumorId } })) {
        await db.worldActivity.create({
          data: {
            id: rumorId,
            timelineId,
            eventId: null,
            recordType: "activity",
            kind: "rumor",
            text: update.rumor,
            visibility: "public",
            actorId: null,
            targetIds: [],
            subjectIds: [],
            sourceMessageId,
            eraLabel,
            timeLabel,
          },
        });
      }
    }
  }
}

// ───────────────────────── 辅助 ─────────────────────────

async function dominantScale(chapterId: string): Promise<{ note: string; wide: boolean }> {
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
  return { note: zh[top] ?? top, wide: ["years", "era", "epoch"].includes(top) };
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
  opts: {
    worldId: string;
    timelineId: string;
    chapterId: string;
    chapterIndex: number;
    timeLabel: string;
    eraLabel: string;
    chapterText: Awaited<ReturnType<typeof chapterProse>>;
    extraction: Extraction;
    mode: WorldMode;
    /** 结算前在册的神选者正名；寿数检查覆盖率据此审计 */
    expectedChosenNames: string[];
    divineCostAudit?: ChapterSettlement["divineCostAudit"];
    wideScale: boolean;
  },
) {
  const { worldId, timelineId, chapterId, chapterText, extraction, mode } = opts;
  const normalizedExtraction: Extraction = {
    ...extraction,
    newGods: extraction.newGods ?? [],
    majorCharacterPromotions: extraction.majorCharacterPromotions ?? [],
    chosenLifespanChecks: extraction.chosenLifespanChecks ?? [],
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
      await assignAutomaticIcon(tx as unknown as IconAssignmentTx, {
        worldId,
        timelineId,
        subjectType: "entity",
        subjectId: created.id,
        iconConcept: ne.iconConcept,
      });
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

    // 人物关系是方向性的。只接受当前现实中可唯一解析的 character 正名或别名。
    const currentCharacters = await tx.entity.findMany({
      where: { timelineId, type: "character" },
      select: { id: true, name: true, aliases: true },
    });
    const characterIdsByName = new Map<string, Set<string>>();
    for (const character of currentCharacters) {
      for (const name of [character.name, ...character.aliases]) {
        const ids = characterIdsByName.get(name) ?? new Set<string>();
        ids.add(character.id);
        characterIdsByName.set(name, ids);
      }
    }
    for (const update of normalizedExtraction.entityUpdates) {
      const source = byName.get(update.name);
      if (source?.type !== "character") continue;
      for (const relation of update.relationChanges ?? []) {
        const targetIds = characterIdsByName.get(relation.target);
        if (targetIds?.size !== 1) continue;
        const targetId = [...targetIds][0]!;
        await tx.entityRelation.upsert({
          where: {
            sourceEntityId_targetEntityId: {
              sourceEntityId: source.id,
              targetEntityId: targetId,
            },
          },
          create: {
            timelineId,
            sourceEntityId: source.id,
            targetEntityId: targetId,
            label: relation.label,
            note: relation.note,
          },
          update: {
            timelineId,
            label: relation.label,
            note: relation.note,
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
      await assignAutomaticIcon(tx as unknown as IconAssignmentTx, {
        worldId,
        timelineId,
        subjectType: "god",
        subjectId: created.id,
        iconConcept: newGod.iconConcept,
      });
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
    for (const created of result.createdAbilities) {
      await assignAutomaticIcon(tx as unknown as IconAssignmentTx, {
        worldId,
        timelineId,
        subjectType: "ability",
        subjectId: created.abilityId,
        iconConcept: created.iconConcept,
      });
    }

    // ── 成长里程碑入史：觉醒/异变/迈入 expert·master 的公开能力事件落编年史与动态 ──
    // 幂等：milestoneId 复用能力事件 dedupeKey；断点重跑（replay applied=false）
    // 与 worldActivity 幂等守卫双保险，与 setState("chronicle") 同事务原子提交。
    const playerGod = godRecords.find((god) => god.isPlayer) ?? null;
    const entityById = new Map(currentEntities.map((entity) => [entity.id, entity] as const));
    const chosenNameSet = new Set(opts.expectedChosenNames);
    for (const change of result.applied) {
      if (change.applied !== true) continue;
      const event = change.event;
      const masteryMilestone = event.after.mastery !== event.before.mastery
        && (event.after.mastery === "expert" || event.after.mastery === "master");
      if (event.type !== "awakened" && event.type !== "mutated" && !masteryMilestone) continue;
      const abilityRow = await tx.ability.findUnique({ where: { id: event.abilityId } });
      if (!abilityRow || abilityRow.visibility !== "known") continue;
      const ownerEntity = abilityRow.entityId ? entityById.get(abilityRow.entityId) : undefined;
      const chosenOwner = ownerEntity !== undefined && chosenNameSet.has(ownerEntity.name);
      const playerGodOwner = playerGod !== null && abilityRow.godId === playerGod.id;
      if (!chosenOwner && !playerGodOwner) continue;
      const milestoneId = `milestone:${event.dedupeKey}`;
      if (await tx.worldActivity.findUnique({ where: { id: milestoneId } })) continue;
      const ownerName = chosenOwner ? ownerEntity!.name : playerGod!.name;
      const abilityName = event.after.name;
      const text = event.type === "awakened"
        ? `${ownerName}觉醒「${abilityName}」，自此非复往日。`
        : event.type === "mutated"
          ? `${ownerName}之「${abilityName}」发生异变，祸福未可知。`
          : event.after.mastery === "expert"
            ? `${ownerName}修习「${abilityName}」有成，技近乎道。`
            : `${ownerName}之「${abilityName}」臻于化境，当世无出其右。`;
      await tx.chronicleEntry.create({
        data: {
          timelineId,
          chapterIndex: opts.chapterIndex,
          yearLabel: opts.timeLabel,
          text,
          entityIds: chosenOwner ? [ownerEntity!.id] : [],
          godIds: playerGodOwner ? [abilityRow.godId!] : [],
          revealed: true,
          source: "narrative",
        },
      });
      await tx.worldActivity.create({
        data: {
          id: milestoneId,
          timelineId,
          eventId: null,
          recordType: "activity",
          kind: "discovery",
          text,
          visibility: "public",
          actorId: chosenOwner ? ownerEntity!.id : null,
          targetIds: [],
          subjectIds: chosenOwner ? [ownerEntity!.id] : [],
          sourceMessageId: chapterText.messages.at(-1)?.id ?? chapterId,
          eraLabel: opts.eraLabel,
          timeLabel: opts.timeLabel,
        },
      });
    }

    // ── 神选者寿数钩子：nearing_end 的世间征兆原文入玩家神征兆队列（kind 默认 omen）──
    // deceased/updated/unchanged 不做数据库动作：寿数栏目更新走既有 entityUpdates 通道。
    for (const check of normalizedExtraction.chosenLifespanChecks ?? []) {
      if (check.verdict !== "nearing_end" || playerGod === null) continue;
      await tx.omenQueue.create({
        data: { timelineId, godId: playerGod.id, text: check.note },
      });
    }
    if (opts.wideScale) {
      const covered = new Set((normalizedExtraction.chosenLifespanChecks ?? []).map((check) => check.name));
      const missing = opts.expectedChosenNames.filter((name) => !covered.has(name));
      if (missing.length) console.warn("神选者寿数检查缺席", { missing });
    }

    // ── 神权代价审计：dodged 的暗记原样入征兆队列，让逃掉的代价日后在世间显形 ──
    for (const audit of opts.divineCostAudit ?? []) {
      if (audit.verdict !== "dodged" || playerGod === null) continue;
      await tx.omenQueue.create({
        data: { timelineId, godId: playerGod.id, text: audit.note },
      });
    }
}

function emblemSeed(name: string): string {
  let h = 5381;
  for (const ch of name) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}
