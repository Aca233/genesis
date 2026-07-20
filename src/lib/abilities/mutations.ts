import { z } from "zod";
import { ScaleSchema } from "../cards/schemas";
import {
  AbilityEventTypeSchema,
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
  normalizePersistedAbility,
  type AbilityChangeInput,
  type AbilityEventType,
  type AbilityInput,
  type AbilityVisibility,
  type PersistedAbilityRecord,
} from "./types";
import {
  AbilityValidationError,
  assertUnlockedFields,
  assertValidTransition,
  type AbilityOwnershipInput,
  type AbilityValidationTx,
  validateAbilityOwnership,
} from "./validator";

export class AbilityOptimisticConflictError extends Error {
  override name = "AbilityOptimisticConflictError";
}

export interface AbilityStoredRecord extends PersistedAbilityRecord {
  timelineId: string;
  entityId: string | null;
  godId: string | null;
}

export interface AbilityEventRecord {
  id: string;
  abilityId: string;
  chapterId: string;
  messageId: string | null;
  type: AbilityEventType;
  before: AbilityInput;
  after: AbilityInput;
  evidence: string;
  scale: string;
  dedupeKey: string;
}

type AbilityPatch = Partial<Omit<AbilityInput, "id" | "version">>;

export interface AbilityChangeEventInput {
  type: AbilityEventType;
  chapterId: string;
  messageId?: string | null;
  evidence: string;
  scale: string;
  dedupeKey: string;
}

export interface ApplyAbilityChangeInput {
  abilityId: string;
  version: number;
  patch: AbilityPatch;
  event: AbilityChangeEventInput;
}

export interface AbilityMutationTx extends Omit<AbilityValidationTx, "ability"> {
  ability: {
    findUnique(args: { where: { id: string } }): Promise<AbilityStoredRecord | null>;
    findFirst(args: {
      where: {
        entityId: string;
        sourceAbilityId: string;
        kind: { in: readonly ["racial_innate", "racial_tradition"] };
        state: { notIn: readonly ["lost", "deprecated"] };
        id: { not: string };
      };
    }): Promise<AbilityStoredRecord | null>;
    update(args: {
      where: { id_version: { id: string; version: number } };
      data: AbilityPatch & { version: { increment: number } };
    }): Promise<AbilityStoredRecord>;
  };
  chapter: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; timelineId: string } | null>;
  };
  message: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; chapterId: string; scale: string } | null>;
  };
  abilityEvent: {
    findUnique(args: { where: { dedupeKey: string } }): Promise<AbilityEventRecord | null>;
    create(args: {
      data: Omit<AbilityEventRecord, "id">;
    }): Promise<AbilityEventRecord>;
  };
}

/** Minimal PrismaClient-like boundary: every public mutation runs in one transaction. */
export interface AbilityMutationClient {
  $transaction<T>(operation: (tx: AbilityMutationTx) => Promise<T>): Promise<T>;
}

export interface AppliedAbilityChange {
  applied: boolean;
  ability?: AbilityInput;
  event: AbilityEventRecord;
}

function ownershipInput(
  ability: AbilityStoredRecord,
  normalized: AbilityInput,
): AbilityOwnershipInput {
  return {
    id: ability.id,
    timelineId: ability.timelineId,
    entityId: ability.entityId,
    godId: ability.godId,
    sourceAbilityId: normalized.sourceAbilityId,
    kind: normalized.kind,
    bloodlineJustification: normalized.bloodlineJustification,
  };
}

function patchToChangeInput(
  ability: AbilityInput,
  patch: AbilityPatch,
): AbilityChangeInput {
  return { id: ability.id, version: ability.version, ...patch };
}

function createAfter(ability: AbilityInput, patch: AbilityPatch): AbilityInput {
  return {
    ...ability,
    ...patch,
    version: ability.version + 1,
  };
}

const AbilityPatchSchema = z.object({
  name: z.string(),
  kind: AbilityKindSchema,
  effect: z.string(),
  trigger: z.string(),
  cost: z.string(),
  limitations: z.string(),
  mastery: AbilityMasterySchema,
  state: AbilityStateSchema,
  visibility: AbilityVisibilitySchema,
  rumorText: z.string().nullable(),
  bloodlineJustification: z.string().nullable(),
  sourceAbilityId: z.string().nullable(),
  lockedFields: z.array(z.string()),
}).partial().strict();

const AbilityChangeEventSchema = z.object({
  type: AbilityEventTypeSchema,
  chapterId: z.string().min(1),
  messageId: z.string().min(1).nullable().optional(),
  evidence: z.string(),
  scale: ScaleSchema,
  dedupeKey: z.string().min(1),
}).strict();

const ApplyAbilityChangeSchema = z.object({
  abilityId: z.string().min(1),
  version: z.number().int().positive(),
  patch: AbilityPatchSchema,
  event: AbilityChangeEventSchema,
}).strict();

const RevealAbilitySchema = z.object({
  abilityId: z.string().min(1),
  version: z.number().int().positive(),
  visibility: z.enum(["rumored", "known"]),
  rumorText: z.string().nullable().optional(),
  event: AbilityChangeEventSchema.omit({ type: true }),
}).strict();

const masteryRanks = ["unawakened", "novice", "adept", "expert", "master"] as const;
const comparableFields: readonly (keyof Omit<AbilityInput, "id" | "version">)[] = [
  "name", "kind", "effect", "trigger", "cost", "limitations", "mastery", "state",
  "visibility", "rumorText", "bloodlineJustification", "sourceAbilityId", "lockedFields",
];

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(before: AbilityInput, after: AbilityInput): string[] {
  return comparableFields.filter((field) => !sameValue(before[field], after[field]));
}

function assertMonotonicLocks(before: AbilityInput, patch: AbilityPatch): void {
  if (patch.lockedFields === undefined) {
    return;
  }
  if (!before.lockedFields.every((field) => patch.lockedFields!.includes(field))) {
    throw new AbilityValidationError("lockedFields 只能追加，不能移除或改写既有锁定字段");
  }
}

function assertEventTransition(
  before: AbilityInput,
  after: AbilityInput,
  type: AbilityEventType,
): void {
  const changes = changedFields(before, after);
  const requireState = (state: AbilityInput["state"]) => {
    if (after.state !== state) {
      throw new AbilityValidationError(`${type} 事件必须将 state 设为 ${state}`);
    }
  };

  switch (type) {
    case "improved": {
      const beforeRank = masteryRanks.indexOf(before.mastery);
      const afterRank = masteryRanks.indexOf(after.mastery);
      if (afterRank !== beforeRank + 1 || before.state !== after.state || changes.length !== 1 || changes[0] !== "mastery") {
        throw new AbilityValidationError("improved 事件只能将 mastery 提升一阶，且不能改变其他字段或 state");
      }
      return;
    }
    case "lost":
      requireState("lost");
      return;
    case "sealed":
      requireState("sealed");
      return;
    case "restored":
      if ((before.state !== "lost" && before.state !== "sealed") || after.state !== "normal") {
        throw new AbilityValidationError("restored 事件只能将 lost 或 sealed 能力恢复为 normal");
      }
      return;
    case "impaired":
      requireState("impaired");
      return;
    case "deprecated":
      requireState("deprecated");
      return;
    case "awakened":
      if (before.mastery !== "unawakened" || after.mastery !== "novice" || before.state !== after.state) {
        throw new AbilityValidationError("awakened 事件必须将 unawakened 提升为 novice，且不能改变 state");
      }
      return;
    case "learned":
      if (after.mastery === "unawakened" || before.state !== after.state) {
        throw new AbilityValidationError("learned 事件必须拥有已觉醒 mastery，且不能改变 state");
      }
      return;
    case "revealed":
      if (before.state !== after.state || before.mastery !== after.mastery || changes.some((field) => field !== "visibility" && field !== "rumorText")) {
        throw new AbilityValidationError("revealed 事件只能改变 visibility 或 rumorText");
      }
      return;
    case "mutated":
      return;
  }
}

async function assertEventEvidence(
  tx: AbilityMutationTx,
  ability: AbilityStoredRecord,
  event: AbilityChangeEventInput,
): Promise<string> {
  const evidence = event.evidence.trim();
  if (evidence === "") {
    throw new AbilityValidationError("evidence 不能为空");
  }
  const chapter = await tx.chapter.findUnique({ where: { id: event.chapterId } });
  if (chapter === null) {
    throw new AbilityValidationError("能力事件章节不存在");
  }
  if (chapter.timelineId !== ability.timelineId) {
    throw new AbilityValidationError("能力事件章节必须与能力处于同一时间线");
  }
  if (event.messageId !== undefined && event.messageId !== null) {
    const message = await tx.message.findUnique({ where: { id: event.messageId } });
    if (message === null) {
      throw new AbilityValidationError("能力事件消息不存在");
    }
    if (message.chapterId !== chapter.id) {
      throw new AbilityValidationError("能力事件消息必须属于指定章节");
    }
    if (message.scale !== event.scale) {
      throw new AbilityValidationError("能力事件 scale 必须与消息尺度一致");
    }
  }
  return evidence;
}

async function assertNoDuplicateDerivedSource(
  tx: AbilityMutationTx,
  stored: AbilityStoredRecord,
  after: AbilityInput,
): Promise<void> {
  if (
    stored.entityId === null ||
    after.sourceAbilityId === null ||
    (after.kind !== "racial_innate" && after.kind !== "racial_tradition")
  ) {
    return;
  }
  const duplicate = await tx.ability.findFirst({
    where: {
      entityId: stored.entityId,
      sourceAbilityId: after.sourceAbilityId,
      kind: { in: ["racial_innate", "racial_tradition"] },
      state: { notIn: ["lost", "deprecated"] },
      id: { not: stored.id },
    },
  });
  if (duplicate !== null) {
    throw new AbilityValidationError("同一人物不能拥有重复的活跃种族能力来源");
  }
}

function isSourceUniquenessError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002" || !Array.isArray(candidate.meta?.target)) {
    return false;
  }
  const target = candidate.meta.target;
  return (
    target.includes("entity_id") &&
    target.includes("source_ability_id")
  );
}

function throwConflict(): never {
  throw new AbilityOptimisticConflictError("能力已被其他变更更新，请刷新后重试");
}

/**
 * Atomically applies a validated ability patch and its evidence event. The
 * injected transaction must encompass both writes; the id+version condition
 * makes concurrent writers fail cleanly instead of overwriting one another.
 */
async function applyAbilityChangeInTx(
  tx: AbilityMutationTx,
  input: ApplyAbilityChangeInput,
): Promise<AppliedAbilityChange> {
  const existingEvent = await tx.abilityEvent.findUnique({
    where: { dedupeKey: input.event.dedupeKey },
  });
  if (existingEvent !== null) {
    return { applied: false, event: existingEvent };
  }

  const stored = await tx.ability.findUnique({ where: { id: input.abilityId } });
  if (stored === null) {
    throw new AbilityValidationError("能力不存在");
  }

  const before = normalizePersistedAbility(stored);
  if (stored.version !== input.version || before.version !== input.version) {
    throwConflict();
  }

  const after = createAfter(before, input.patch);
  assertUnlockedFields(before, patchToChangeInput(before, input.patch));
  assertMonotonicLocks(before, input.patch);
  assertValidTransition(before, after, input.event.type);
  assertEventTransition(before, after, input.event.type);
  await validateAbilityOwnership(tx, ownershipInput(stored, after));
  await assertNoDuplicateDerivedSource(tx, stored, after);
  const evidence = await assertEventEvidence(tx, stored, input.event);

  let updated: AbilityStoredRecord;
  try {
    updated = await tx.ability.update({
      where: { id_version: { id: input.abilityId, version: input.version } },
      data: { ...input.patch, version: { increment: 1 } },
    });
  } catch (error) {
    if (error instanceof AbilityValidationError) {
      throw error;
    }
    if (isSourceUniquenessError(error)) {
      throw new AbilityValidationError("同一人物不能拥有重复的活跃种族能力来源");
    }
    throwConflict();
  }

  const event = await tx.abilityEvent.create({
    data: {
      abilityId: updated.id,
      chapterId: input.event.chapterId,
      messageId: input.event.messageId ?? null,
      type: input.event.type,
      before,
      after: normalizePersistedAbility(updated),
      evidence,
      scale: input.event.scale,
      dedupeKey: input.event.dedupeKey,
    },
  });

  return { applied: true, ability: normalizePersistedAbility(updated), event };
}

/** Parses and applies a change inside a caller-owned transaction. */
export async function applyAbilityChangeInTransaction(
  tx: AbilityMutationTx,
  input: unknown,
): Promise<AppliedAbilityChange> {
  const parsed = ApplyAbilityChangeSchema.parse(input);
  return applyAbilityChangeInTx(tx, parsed);
}

/** Parses untrusted input before opening one transaction for ability and event writes. */
export async function applyAbilityChange(
  client: AbilityMutationClient,
  input: unknown,
): Promise<AppliedAbilityChange> {
  return client.$transaction((tx) => applyAbilityChangeInTransaction(tx, input));
}

export interface RevealAbilityInput {
  abilityId: string;
  version: number;
  visibility: Extract<AbilityVisibility, "rumored" | "known">;
  rumorText?: string | null;
  event: Omit<AbilityChangeEventInput, "type">;
}

/** Reveals an ability through the normal mutation pipeline and a revealed event. */
async function revealAbilityInTx(
  tx: AbilityMutationTx,
  input: RevealAbilityInput,
): Promise<AppliedAbilityChange> {
  const existingEvent = await tx.abilityEvent.findUnique({
    where: { dedupeKey: input.event.dedupeKey },
  });
  if (existingEvent !== null) {
    return { applied: false, event: existingEvent };
  }

  if (
    input.visibility === "rumored" &&
    (input.rumorText === null || input.rumorText === undefined || input.rumorText.trim() === "")
  ) {
    throw new AbilityValidationError("hidden -> rumored 必须提供非空 rumorText");
  }

  const stored = await tx.ability.findUnique({ where: { id: input.abilityId } });
  if (stored === null) {
    throw new AbilityValidationError("能力不存在");
  }
  const current = normalizePersistedAbility(stored);

  if (input.visibility === "rumored" && current.visibility !== "hidden") {
    throw new AbilityValidationError("只有 hidden 能力可以变为 rumored");
  }
  if (
    input.visibility === "known" &&
    current.visibility !== "hidden" &&
    current.visibility !== "rumored"
  ) {
    throw new AbilityValidationError("只有 hidden 或 rumored 能力可以变为 known");
  }

  return applyAbilityChangeInTx(tx, {
    abilityId: input.abilityId,
    version: input.version,
    patch: {
      visibility: input.visibility,
      ...(input.visibility === "rumored" ? { rumorText: input.rumorText ?? null } : {}),
    },
    event: { ...input.event, type: "revealed" },
  });
}

/** Parses reveal requests and applies their ability/event mutation atomically. */
export async function revealAbility(
  client: AbilityMutationClient,
  input: unknown,
): Promise<AppliedAbilityChange> {
  const parsed = RevealAbilitySchema.parse(input);
  return client.$transaction((tx) => revealAbilityInTx(tx, parsed));
}
