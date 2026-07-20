import {
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
    update(args: {
      where: { id_version: { id: string; version: number } };
      data: AbilityPatch & { version: { increment: number } };
    }): Promise<AbilityStoredRecord>;
  };
  abilityEvent: {
    findUnique(args: { where: { dedupeKey: string } }): Promise<AbilityEventRecord | null>;
    create(args: {
      data: Omit<AbilityEventRecord, "id">;
    }): Promise<AbilityEventRecord>;
  };
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

function throwConflict(): never {
  throw new AbilityOptimisticConflictError("能力已被其他变更更新，请刷新后重试");
}

/**
 * Atomically applies a validated ability patch and its evidence event. The
 * injected transaction must encompass both writes; the id+version condition
 * makes concurrent writers fail cleanly instead of overwriting one another.
 */
export async function applyAbilityChange(
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
  assertValidTransition(before, after, input.event.type);
  await validateAbilityOwnership(tx, ownershipInput(stored, after));

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
      evidence: input.event.evidence,
      scale: input.event.scale,
      dedupeKey: input.event.dedupeKey,
    },
  });

  return { applied: true, ability: normalizePersistedAbility(updated), event };
}

export interface RevealAbilityInput {
  abilityId: string;
  version: number;
  visibility: Extract<AbilityVisibility, "rumored" | "known">;
  rumorText?: string | null;
  event: Omit<AbilityChangeEventInput, "type">;
}

/** Reveals an ability through the normal mutation pipeline and a revealed event. */
export async function revealAbility(
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

  return applyAbilityChange(tx, {
    abilityId: input.abilityId,
    version: input.version,
    patch: {
      visibility: input.visibility,
      ...(input.visibility === "rumored" ? { rumorText: input.rumorText ?? null } : {}),
    },
    event: { ...input.event, type: "revealed" },
  });
}
