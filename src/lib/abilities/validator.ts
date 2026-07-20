import type {
  AbilityChangeInput,
  AbilityEventType,
  AbilityInput,
  AbilityKind,
} from "./types";

export class AbilityValidationError extends Error {
  override name = "AbilityValidationError";
}

export interface AbilityOwnershipInput {
  id: string;
  timelineId: string;
  entityId: string | null;
  godId: string | null;
  sourceAbilityId: string | null;
  kind: AbilityKind;
}

interface AbilityOwnerRecord {
  id: string;
  timelineId: string;
}

interface EntityOwnerRecord extends AbilityOwnerRecord {
  type: string;
  raceId: string | null;
}

interface AbilitySourceRecord {
  id: string;
  timelineId: string;
  entityId: string | null;
  godId: string | null;
  sourceAbilityId: string | null;
  kind: string;
}

export interface AbilityValidationTx {
  entity: {
    findUnique(args: { where: { id: string } }): Promise<EntityOwnerRecord | null>;
  };
  god: {
    findUnique(args: { where: { id: string } }): Promise<AbilityOwnerRecord | null>;
  };
  ability: {
    findUnique(args: { where: { id: string } }): Promise<AbilitySourceRecord | null>;
  };
}

function fail(message: string): never {
  throw new AbilityValidationError(message);
}

function assertSameTimeline(
  record: AbilityOwnerRecord,
  timelineId: string,
  label: string,
): void {
  if (record.timelineId !== timelineId) {
    fail(`${label}必须与能力处于同一时间线`);
  }
}

function assertRaceTemplate(input: AbilityOwnershipInput): void {
  if (input.kind !== "racial_innate" && input.kind !== "racial_tradition") {
    fail("种族模板能力只能是 racial_innate 或 racial_tradition");
  }
  if (input.sourceAbilityId !== null) {
    fail("种族模板能力不能携带 sourceAbilityId");
  }
}

function assertCharacterDerivedAbility(
  input: AbilityOwnershipInput,
  entity: EntityOwnerRecord,
): void {
  if (input.kind === "personal" || input.kind === "divine") {
    if (input.sourceAbilityId !== null) {
      fail(`${input.kind} 能力的 sourceAbilityId 必须为空`);
    }
    return;
  }

  if (input.sourceAbilityId === null) {
    fail("人物派生种族能力必须指定 sourceAbilityId");
  }
  if (entity.raceId === null) {
    fail("人物派生种族能力需要人物主种族");
  }
}

/**
 * Checks the ownership and provenance rules before an ability is created or
 * changed. The caller supplies a transaction-shaped reader so these checks
 * run against the same snapshot as the write.
 */
export async function validateAbilityOwnership(
  tx: AbilityValidationTx,
  input: AbilityOwnershipInput,
): Promise<void> {
  const ownerCount = Number(input.entityId !== null) + Number(input.godId !== null);
  if (ownerCount !== 1) {
    fail("能力必须且只能属于一个人物实体或神明");
  }

  if (input.entityId !== null) {
    const entity = await tx.entity.findUnique({ where: { id: input.entityId } });
    if (entity === null) {
      fail("能力所属实体不存在");
    }
    assertSameTimeline(entity, input.timelineId, "能力所属实体");

    if (entity.type === "race") {
      assertRaceTemplate(input);
      return;
    }

    if (entity.type === "character") {
      assertCharacterDerivedAbility(input, entity);
    } else if (input.sourceAbilityId !== null) {
      fail("非人物实体能力不能携带 sourceAbilityId");
    }
  }

  if (input.godId !== null) {
    const god = await tx.god.findUnique({ where: { id: input.godId } });
    if (god === null) {
      fail("能力所属神明不存在");
    }
    assertSameTimeline(god, input.timelineId, "能力所属神明");
    if (input.kind !== "divine") {
      fail("神明能力必须是 divine");
    }
    if (input.sourceAbilityId !== null) {
      fail("divine 能力的 sourceAbilityId 必须为空");
    }
    return;
  }

  if (input.sourceAbilityId === null) {
    return;
  }

  const source = await tx.ability.findUnique({
    where: { id: input.sourceAbilityId },
  });
  if (source === null) {
    fail("能力来源不存在");
  }
  assertSameTimeline(source, input.timelineId, "能力来源");

  if (source.entityId === null || source.godId !== null) {
    fail("人物派生种族能力的来源必须是种族模板能力");
  }
  if (source.kind !== input.kind || source.sourceAbilityId !== null) {
    fail("人物派生种族能力的来源必须是同类型的种族模板能力");
  }

  const owner = await tx.entity.findUnique({ where: { id: input.entityId! } });
  if (owner === null || owner.type !== "character" || owner.raceId === null) {
    fail("人物派生种族能力需要人物主种族");
  }
  if (source.entityId !== owner.raceId) {
    if (input.kind === "racial_tradition") {
      fail("族群技艺来源必须属于人物主种族");
    }
    fail("种族先天来源必须属于人物主种族");
  }

  const sourceRace = await tx.entity.findUnique({ where: { id: source.entityId } });
  if (sourceRace === null || sourceRace.type !== "race") {
    fail("人物派生种族能力的来源必须是种族模板能力");
  }
  assertSameTimeline(sourceRace, input.timelineId, "能力来源种族");
}

/** Rejects any attempted write to a field protected by the player. */
export function assertUnlockedFields(
  existing: Pick<AbilityInput, "lockedFields">,
  patch: AbilityChangeInput,
): void {
  for (const [field, value] of Object.entries(patch)) {
    if (field === "id" || field === "version" || value === undefined) {
      continue;
    }
    const locked = existing.lockedFields.find(
      (path) =>
        field === path || field.startsWith(`${path}.`) || path.startsWith(`${field}.`),
    );
    if (locked !== undefined) {
      fail(`字段 "${locked}" 已被锁定，不能修改`);
    }
  }
}

/**
 * A terminal state may only be restored through a `restored` event, preventing
 * a regular patch from silently resurrecting lost or deprecated abilities.
 */
export function assertValidTransition(
  before: Pick<AbilityInput, "state">,
  after: Pick<AbilityInput, "state">,
  eventType?: AbilityEventType,
): void {
  const wasTerminal = before.state === "lost" || before.state === "deprecated";
  if (wasTerminal && after.state !== before.state && eventType !== "restored") {
    fail("lost 或 deprecated 能力只能通过 restored 事件恢复");
  }
}

export interface AbilityDeckReferences {
  abilityIds?: readonly string[];
  entityIds?: readonly string[];
  godIds?: readonly string[];
}

/** Ensures deck references are explicit, non-empty and non-duplicated. */
export function validateDeckReferences(deck: AbilityDeckReferences): void {
  for (const [label, ids] of Object.entries(deck)) {
    if (ids === undefined) {
      continue;
    }
    const seen = new Set<string>();
    for (const id of ids) {
      if (id.trim() === "") {
        fail(`${label} 不能包含空引用`);
      }
      if (id.trim() !== id) {
        fail(`${label} 不能包含首尾空白引用`);
      }
      if (seen.has(id)) {
        fail(`${label} 不能包含重复引用 "${id}"`);
      }
      seen.add(id);
    }
  }
}
