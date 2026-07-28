import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { cloneTimelineGraph } from "./clone";
import {
  WorldOperationConflictError,
  claimWorldOperation,
  releaseWorldOperation,
  type WorldOperationClient,
} from "./operation-lock";
import { parseRealityBranchName } from "./tree";

/**
 * 万神殿检查点回溯分叉：把世界整体冻结复制回某个已结算章节的快照时刻。
 * 复用创世主分叉机制（cloneTimelineGraph）克隆整条时间线，再在克隆体上
 * 截断检查点之后的历史并按 v2 快照还原众神/众生/能力/事件/征兆/时间态；
 * 原现实冻结保留，可经现实树随时回望。
 */

export class CheckpointForkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointForkConflictError";
  }
}

export class CheckpointForkNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckpointForkNotFoundError";
  }
}

// ───────────────────────── 快照 v2 行结构 ─────────────────────────
// looseObject：未来新增列自动透传，不因未知字段拒绝回溯。

const GodRowSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  tier: z.string(),
  rank: z.string(),
  domains: z.array(z.string()),
  isPlayer: z.boolean(),
  agendaRevealed: z.boolean(),
  faithScope: z.string().nullable(),
  codexEntityId: z.string().nullable(),
  persona: z.unknown(),
  voice: z.unknown(),
  agenda: z.unknown(),
  relations: z.unknown(),
});

const EntitySectionRowSchema = z.looseObject({
  key: z.string(),
  content: z.unknown(),
  revealed: z.boolean(),
  rumorText: z.string().nullable(),
  playerLocked: z.boolean(),
});

const EntityRowSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  emblemSeed: z.string(),
  imageUrl: z.string().nullable(),
  starred: z.boolean(),
  isChosen: z.boolean(),
  isMajorCharacter: z.boolean(),
  isCreatorAvatar: z.boolean(),
  scenePresence: z.boolean(),
  raceId: z.string().nullable(),
  heat: z.string(),
  summary: z.string(),
  lockedPaths: z.array(z.string()),
  materialRef: z.string().nullable(),
  sections: z.array(EntitySectionRowSchema),
});

const AbilityRowSchema = z.looseObject({
  id: z.string(),
  entityId: z.string().nullable(),
  godId: z.string().nullable(),
  sourceAbilityId: z.string().nullable(),
  name: z.string(),
  kind: z.string(),
  effect: z.string(),
  trigger: z.string(),
  cost: z.string(),
  limitations: z.string(),
  mastery: z.string(),
  state: z.string(),
  visibility: z.string(),
  rumorText: z.string().nullable(),
  bloodlineJustification: z.string().nullable(),
  lockedFields: z.array(z.string()),
  version: z.number(),
  materialRef: z.string().nullable(),
});

const RelationRowSchema = z.looseObject({
  id: z.string(),
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  label: z.string(),
  note: z.string(),
});

const EventRowSchema = z.looseObject({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  phase: z.string(),
  visibility: z.string(),
  participantIds: z.array(z.string()),
  originActivityId: z.string().nullable(),
  latestMessageId: z.string(),
  parentEventId: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});

const OmenRowSchema = z.looseObject({
  godId: z.string(),
  text: z.string(),
  kind: z.string().optional(),
  consumed: z.boolean(),
  createdAt: z.string(),
});

const CanonEventRowSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
});

export const CheckpointSnapshotSchema = z.looseObject({
  snapshotVersion: z.literal(2),
  gods: z.array(GodRowSchema),
  entities: z.array(EntityRowSchema),
  abilities: z.array(AbilityRowSchema),
  entityRelations: z.array(RelationRowSchema),
  worldEvents: z.array(EventRowSchema),
  omens: z.array(OmenRowSchema),
  // 旧存档快照无此字段:缺席时跳过将临之事回滚(与既有行为一致)
  canonEvents: z.array(CanonEventRowSchema).optional(),
  temporal: z.looseObject({
    realityState: z.unknown(),
    observerState: z.unknown(),
  }),
});

export type CheckpointSnapshot = z.infer<typeof CheckpointSnapshotSchema>;

function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined
    ? Prisma.DbNull
    : structuredClone(value) as Prisma.InputJsonValue;
}

function sectionJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined
    ? Prisma.JsonNull
    : structuredClone(value) as Prisma.InputJsonValue;
}

export type CheckpointForkInput = {
  userId: string;
  worldId: string;
  sourceChapterId: string;
  expectedActiveId: string;
  branchName?: string;
  idempotencyKey: string;
};

async function replayByIdempotencyKey(
  db: PrismaClient,
  idempotencyKey: string,
): Promise<{ activeId: string; timelineId: string } | null> {
  const existing = await db.realityRewrite.findUnique({
    where: { idempotencyKey },
    select: { resultTimelineId: true },
  });
  if (existing === null) return null;
  if (existing.resultTimelineId === null) {
    throw new CheckpointForkConflictError("幂等键已用于另一项操作");
  }
  return { activeId: existing.resultTimelineId, timelineId: existing.resultTimelineId };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * 在世界"switch"操作租约与可串行化事务保护下，把万神殿世界回溯到某个
 * 已结算检查点：克隆当前时间线 → 截断检查点之后的历史 → 按快照还原 →
 * 绑定合成 RealityRewrite 行并切换活动现实。幂等键可安全重放。
 */
export async function forkPantheonCheckpoint(
  db: PrismaClient,
  input: CheckpointForkInput,
): Promise<{ activeId: string; timelineId: string }> {
  const replayed = await replayByIdempotencyKey(db, input.idempotencyKey);
  if (replayed !== null) return replayed;

  const token = crypto.randomUUID();
  const operationDb = db as unknown as WorldOperationClient;
  const claim = await claimWorldOperation(operationDb, input.worldId, "switch", token);
  if (!claim.acquired) throw new WorldOperationConflictError(claim.activeKind);

  try {
    return await db.$transaction(
      (tx) => forkWhileLeased(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replayedAfterRace = await replayByIdempotencyKey(db, input.idempotencyKey);
      if (replayedAfterRace !== null) return replayedAfterRace;
      throw new CheckpointForkConflictError("幂等键已用于另一项操作");
    }
    throw error;
  } finally {
    await releaseWorldOperation(operationDb, input.worldId, "switch", token);
  }
}

async function forkWhileLeased(
  tx: Prisma.TransactionClient,
  input: CheckpointForkInput,
): Promise<{ activeId: string; timelineId: string }> {
  // (1) 世界与并发前置
  const world = await tx.world.findFirst({
    where: { id: input.worldId, userId: input.userId },
    select: { mode: true, activeTimelineId: true },
  });
  if (world === null) throw new CheckpointForkNotFoundError("世界不存在");
  if (world.mode !== "pantheon") {
    throw new CheckpointForkConflictError("仅万神殿模式可回溯检查点");
  }
  if (world.activeTimelineId === null || world.activeTimelineId !== input.expectedActiveId) {
    throw new CheckpointForkConflictError("当前现实已变化，请刷新后重试");
  }
  const activeId = world.activeTimelineId;

  // (2) 检查点章节与快照
  const chapter = await tx.chapter.findFirst({
    where: { id: input.sourceChapterId, timelineId: activeId },
    select: { id: true, index: true, settleState: true, snapshot: true },
  });
  if (chapter === null) throw new CheckpointForkNotFoundError("检查点不存在");
  if (chapter.settleState !== "settled") {
    throw new CheckpointForkConflictError("该检查点尚未结算完成");
  }
  const parsedSource = CheckpointSnapshotSchema.safeParse(chapter.snapshot);
  if (!parsedSource.success) {
    throw new CheckpointForkConflictError("该检查点是旧版存档快照，尚不支持回溯");
  }
  const k = chapter.index;
  const labelEntry = await tx.chronicleEntry.findFirst({
    where: { timelineId: activeId, chapterIndex: k, yearLabel: { not: "" } },
    orderBy: { createdAt: "asc" },
    select: { yearLabel: true },
  });
  const timeLabel = labelEntry?.yearLabel.trim() || `第${k}卷`;

  // (3) 合成改写行：scope 必须是合法 RewriteScopeSchema 值（toRealityRewriteDto 会解析）；
  // status "completed" 使其既不可被 claimRealityRewriteTask 认领，也不进入改写进度面板。
  const rewrite = await tx.realityRewrite.create({
    data: {
      worldId: input.worldId,
      sourceTimelineId: activeId,
      sourceChapterId: chapter.id,
      decree: `回到「${timeLabel}」，自那一刻重新来过`,
      scope: "prospective",
      status: "completed",
      idempotencyKey: input.idempotencyKey,
    },
  });

  // (4) 整线克隆（校验 sourceChapterId 归属并写入 forkChapter = k）
  const cloned = await cloneTimelineGraph(tx, {
    sourceTimelineId: activeId,
    worldId: input.worldId,
    rewriteId: rewrite.id,
    branchName: parseRealityBranchName(input.branchName ?? `回溯 · ${timeLabel}`),
    branchSummary: `自「${timeLabel}」（第${k}卷）检查点分叉；此后的历史归于旧现实。`,
  });
  const clonedId = cloned.timelineId;

  // (5) 重新读取克隆体上的检查点章节：其快照已被 remapRuntimeJson 重映射为
  // 克隆图 ID，之后所有还原一律使用这一份，绝不使用源快照。
  const clonedChapter = await tx.chapter.findUniqueOrThrow({
    where: { timelineId_index: { timelineId: clonedId, index: k } },
    select: { snapshot: true },
  });
  const parsedCloned = CheckpointSnapshotSchema.safeParse(clonedChapter.snapshot);
  if (!parsedCloned.success) {
    throw new CheckpointForkConflictError("检查点快照克隆后无法解析，回溯已取消");
  }
  const snapshot = parsedCloned.data;

  // (6) 截断并还原
  // (6a) 先收集将被删除章节（index > k）的消息 ID
  const deletedMessages = await tx.message.findMany({
    where: { chapter: { timelineId: clonedId, index: { gt: k } } },
    select: { id: true },
  });
  const deletedMessageIds = deletedMessages.map((row) => row.id);

  // (6b) sourceMessageId 无外键，须手动清理检查点之后产生的动态
  if (deletedMessageIds.length > 0) {
    await tx.worldActivity.deleteMany({
      where: { timelineId: clonedId, sourceMessageId: { in: deletedMessageIds } },
    });
  }

  // (6c) 世界事件：删除快照之外的事件，再按快照还原（父/源边分两遍恢复，
  // 与 clone.ts 的事件图两遍写入次序一致）
  const snapshotEventIds = new Set(snapshot.worldEvents.map((event) => event.id));
  await tx.worldEvent.deleteMany({
    where: { timelineId: clonedId, id: { notIn: [...snapshotEventIds] } },
  });
  for (const event of snapshot.worldEvents) {
    await tx.worldEvent.update({
      where: { id: event.id },
      data: {
        kind: event.kind,
        title: event.title,
        summary: event.summary,
        phase: event.phase,
        visibility: event.visibility,
        participantIds: [...event.participantIds],
        originActivityId: null,
        latestMessageId: event.latestMessageId,
        parentEventId: null,
        resolvedAt: event.resolvedAt === null ? null : new Date(event.resolvedAt),
      },
    });
  }
  for (const event of snapshot.worldEvents) {
    if (event.parentEventId === null && event.originActivityId === null) continue;
    await tx.worldEvent.update({
      where: { id: event.id },
      data: {
        parentEventId: event.parentEventId,
        originActivityId: event.originActivityId,
      },
    });
  }

  // (6d) 截断章节（级联消息与能力事件），并开新的续写章
  await tx.chapter.deleteMany({ where: { timelineId: clonedId, index: { gt: k } } });
  await tx.chapter.create({
    data: { timelineId: clonedId, index: k + 1, settleState: "open" },
  });

  // (6e) 编年史：删除检查点之后的条目，重新隐藏此后才揭示的暗记
  await tx.chronicleEntry.deleteMany({
    where: { timelineId: clonedId, chapterIndex: { gt: k } },
  });
  await tx.chronicleEntry.updateMany({
    where: { timelineId: clonedId, revealedAtChapter: { gt: k } },
    data: { revealed: false, revealedAtChapter: null },
  });

  // 预先收集克隆图中的现存 ID，供"快照之外即删除"判定
  const [clonedGods, clonedEntities, clonedAbilities] = await Promise.all([
    tx.god.findMany({ where: { timelineId: clonedId }, select: { id: true } }),
    tx.entity.findMany({ where: { timelineId: clonedId }, select: { id: true } }),
    tx.ability.findMany({ where: { timelineId: clonedId }, select: { id: true } }),
  ]);

  // (6f) 众神：删除检查点后新增的神（连带其征兆与图标分配），再按快照还原
  const snapshotGodIds = new Set(snapshot.gods.map((god) => god.id));
  for (const god of clonedGods) {
    if (snapshotGodIds.has(god.id)) continue;
    await tx.omenQueue.deleteMany({ where: { timelineId: clonedId, godId: god.id } });
    await tx.iconAssignment.deleteMany({
      where: { timelineId: clonedId, subjectType: "god", subjectId: god.id },
    });
    await tx.god.delete({ where: { id: god.id } });
  }
  for (const god of snapshot.gods) {
    // updateMany:检查点后被硬删的行在克隆图中不存在,容忍 0 命中(不复活孤行)
    await tx.god.updateMany({
      where: { id: god.id },
      data: {
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
        relations: nullableJson(god.relations),
        faithScope: god.faithScope,
        codexEntityId: god.codexEntityId,
      },
    });
  }

  // (6g) 众生：删除检查点后新增的实体（sections/abilities/memberships/relations 级联），
  // 再按快照还原实体与栏目
  const snapshotEntityIds = new Set(snapshot.entities.map((entity) => entity.id));
  for (const entity of clonedEntities) {
    if (snapshotEntityIds.has(entity.id)) continue;
    await tx.iconAssignment.deleteMany({
      where: { timelineId: clonedId, subjectType: "entity", subjectId: entity.id },
    });
    await tx.entity.delete({ where: { id: entity.id } });
  }
  for (const entity of snapshot.entities) {
    const restored = await tx.entity.updateMany({
      where: { id: entity.id },
      data: {
        type: entity.type,
        name: entity.name,
        aliases: [...entity.aliases],
        emblemSeed: entity.emblemSeed,
        imageUrl: entity.imageUrl,
        starred: entity.starred,
        isChosen: entity.isChosen,
        isMajorCharacter: entity.isMajorCharacter,
        isCreatorAvatar: entity.isCreatorAvatar,
        raceId: entity.raceId,
        heat: entity.heat,
        scenePresence: entity.scenePresence,
        summary: entity.summary,
        lockedPaths: [...entity.lockedPaths],
        materialRef: entity.materialRef,
      },
    });
    // 实体已在检查点后被硬删:跳过栏目还原,避免向不存在的外键建行
    if (restored.count === 0) continue;
    await tx.entitySection.deleteMany({ where: { entityId: entity.id } });
    for (const section of entity.sections) {
      await tx.entitySection.create({
        data: {
          entityId: entity.id,
          key: section.key,
          content: sectionJson(section.content),
          revealed: section.revealed,
          rumorText: section.rumorText,
          playerLocked: section.playerLocked,
        },
      });
    }
  }

  // (6h) 能力：删除快照之外的能力（部分可能已随神/实体级联删除，故用 deleteMany），
  // 再按快照还原——快照能力的归属者必然同存于快照，更新安全
  const snapshotAbilityIds = new Set(snapshot.abilities.map((ability) => ability.id));
  for (const ability of clonedAbilities) {
    if (snapshotAbilityIds.has(ability.id)) continue;
    await tx.iconAssignment.deleteMany({
      where: { timelineId: clonedId, subjectType: "ability", subjectId: ability.id },
    });
    await tx.ability.deleteMany({ where: { id: ability.id } });
  }
  for (const ability of snapshot.abilities) {
    await tx.ability.updateMany({
      where: { id: ability.id },
      data: {
        entityId: ability.entityId,
        godId: ability.godId,
        sourceAbilityId: ability.sourceAbilityId,
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
      },
    });
  }

  // (6i) 实体关系：无他表引用关系 ID，整体替换
  await tx.entityRelation.deleteMany({ where: { timelineId: clonedId } });
  for (const relation of snapshot.entityRelations) {
    await tx.entityRelation.create({
      data: {
        id: relation.id,
        timelineId: clonedId,
        sourceEntityId: relation.sourceEntityId,
        targetEntityId: relation.targetEntityId,
        label: relation.label,
        note: relation.note,
      },
    });
  }

  // (6j) 征兆：按 (godId, text, createdAt) 贪心匹配对账（与改写克隆的
  // 征兆映射算法一致）；匹配则还原 consumed，多余删除，缺失补建
  const clonedOmens = await tx.omenQueue.findMany({
    where: { timelineId: clonedId },
    select: { id: true, godId: true, text: true, consumed: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const usedClonedOmenIds = new Set<string>();
  for (const omen of snapshot.omens) {
    const snapshotTime = new Date(omen.createdAt).getTime();
    const matched = clonedOmens.find((candidate) =>
      !usedClonedOmenIds.has(candidate.id)
      && candidate.godId === omen.godId
      && candidate.text === omen.text
      && candidate.createdAt.getTime() === snapshotTime
    );
    if (matched !== undefined) {
      usedClonedOmenIds.add(matched.id);
      if (matched.consumed !== omen.consumed) {
        await tx.omenQueue.update({
          where: { id: matched.id },
          data: { consumed: omen.consumed },
        });
      }
    } else {
      await tx.omenQueue.create({
        data: {
          timelineId: clonedId,
          godId: omen.godId,
          text: omen.text,
          ...(omen.kind !== undefined ? { kind: omen.kind } : {}),
          consumed: omen.consumed,
          createdAt: new Date(omen.createdAt),
        },
      });
    }
  }
  for (const candidate of clonedOmens) {
    if (usedClonedOmenIds.has(candidate.id)) continue;
    await tx.omenQueue.delete({ where: { id: candidate.id } });
  }

  // (6j+) 将临之事回滚：状态机复归检查点时刻(旧快照缺字段则跳过,保持原状)
  if (snapshot.canonEvents !== undefined) {
    for (const canonEvent of snapshot.canonEvents) {
      await tx.canonEvent.updateMany({
        where: { id: canonEvent.id, timelineId: clonedId },
        data: { status: canonEvent.status },
      });
    }
  }

  // (6k) 时间态回拨：currentEra/timeLabel 复归检查点时刻
  await tx.timeline.update({
    where: { id: clonedId },
    data: {
      realityState: nullableJson(snapshot.temporal.realityState),
      observerState: nullableJson(snapshot.temporal.observerState),
    },
  });

  // (7) 绑定改写结果并 CAS 切换活动现实
  const bound = await tx.realityRewrite.updateMany({
    where: { id: rewrite.id, resultTimelineId: null },
    data: { resultTimelineId: clonedId },
  });
  if (bound.count !== 1) {
    throw new CheckpointForkConflictError("当前现实已变化，请刷新后重试");
  }
  const switched = await tx.world.updateMany({
    where: { id: input.worldId, activeTimelineId: input.expectedActiveId },
    data: { activeTimelineId: clonedId },
  });
  if (switched.count !== 1) {
    throw new CheckpointForkConflictError("当前现实已变化，请刷新后重试");
  }

  return { activeId: clonedId, timelineId: clonedId };
}
