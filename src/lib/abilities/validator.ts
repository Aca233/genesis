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
  /** Required for a cross-primary-race racial_innate ability. */
  bloodlineJustification?: string | null;
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

  if (input.godId !== null) {
    const god = await tx.god.findUnique({ where: { id: input.godId } });
    if (god === null) {
      fail("能力所属神明不存在");
    }
    assertSameTimeline(god, input.timelineId, "能力所属神明");
    if (input.kind !== "divine") {
      fail("只有 divine 能力可以属于神明");
    }
    if (input.sourceAbilityId !== null) {
      fail("divine 能力的 sourceAbilityId 必须为空");
    }
    return;
  }

  const entity = await tx.entity.findUnique({ where: { id: input.entityId! } });
  if (entity === null) {
    fail("能力所属实体不存在");
  }
  assertSameTimeline(entity, input.timelineId, "能力所属实体");

  if (entity.type === "race") {
    assertRaceTemplate(input);
    return;
  }

  if (entity.type !== "character") {
    fail(`只有 character 实体可以拥有 ${input.kind} 能力`);
  }
  if (input.kind === "divine") {
    fail("divine 能力只能属于神明");
  }
  if (input.kind === "personal") {
    if (input.sourceAbilityId !== null) {
      fail("personal 能力的 sourceAbilityId 必须为空");
    }
    return;
  }

  assertCharacterDerivedAbility(input, entity);
  const source = await tx.ability.findUnique({
    where: { id: input.sourceAbilityId! },
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

  if (entity.raceId === null) {
    fail("人物派生种族能力需要人物主种族");
  }
  if (source.entityId !== entity.raceId) {
    if (input.kind === "racial_tradition") {
      fail("族群技艺来源必须属于人物主种族");
    }
    if (input.bloodlineJustification?.trim() === "" || input.bloodlineJustification === undefined || input.bloodlineJustification === null) {
      fail("跨主种族先天能力必须提供非空 bloodlineJustification");
    }
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

export type AbilityDeckReferences = Record<string, unknown>;

type DeckRecord = Record<string, unknown>;

function isRecord(value: unknown): value is DeckRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deckList(deck: DeckRecord, field: string): unknown[] {
  const value = deck[field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${field} 必须是数组`);
  }
  return value;
}

function referenceId(value: unknown, label: string): string {
  const id = typeof value === "string" ? value : isRecord(value) ? value.id : undefined;
  if (typeof id !== "string" || id.trim() === "" || id.trim() !== id) {
    fail(`${label} 必须是非空且无首尾空白的 ID 引用`);
  }
  return id;
}

function assertUnique(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      fail(`${label} 不能包含重复引用 "${id}"`);
    }
    seen.add(id);
  }
}

function requireReference(id: string, ids: ReadonlySet<string>, label: string): void {
  if (!ids.has(id)) {
    fail(`${label}引用 "${id}" 不存在`);
  }
}

function fieldReference(record: DeckRecord, names: readonly string[], label: string): string {
  for (const name of names) {
    if (record[name] !== undefined) {
      return referenceId(record[name], label);
    }
  }
  fail(`${label}缺失`);
}

/**
 * Validates the reference graph of the planned deck payload without coupling
 * this module to Task 5's future Zod type. String and `{ id }` references are
 * both accepted; malformed unknown input always produces a domain error.
 */
export function validateDeckReferences(deck: AbilityDeckReferences): void {
  if (!isRecord(deck)) {
    fail("deck 必须是对象");
  }

  // Retain validation for the compact legacy id arrays used by early callers.
  for (const field of ["abilityIds", "entityIds", "godIds"] as const) {
    const ids = deckList(deck, field).map((value, index) => referenceId(value, `${field}[${index}]`));
    assertUnique(ids, field);
  }

  const raceIds = deckList(deck, "races").map((value, index) => referenceId(value, `races[${index}]`));
  const factionIds = deckList(deck, "factions").map((value, index) => referenceId(value, `factions[${index}]`));
  assertUnique(raceIds, "races");
  assertUnique(factionIds, "factions");
  const races = new Set(raceIds);
  const factions = new Set(factionIds);

  const characters = new Set<string>();
  for (const [index, value] of deckList(deck, "majorCharacters").entries()) {
    if (!isRecord(value)) {
      fail(`majorCharacters[${index}] 必须是对象`);
    }
    const id = fieldReference(value, ["id", "character", "characterId"], `majorCharacters[${index}] 人物引用`);
    if (characters.has(id)) {
      fail(`majorCharacters 不能包含重复引用 "${id}"`);
    }
    characters.add(id);
    const raceId = fieldReference(value, ["race", "raceId"], `majorCharacters[${index}] 种族引用`);
    requireReference(raceId, races, "种族");
  }

  const abilities = new Map<string, string>();
  for (const [index, value] of deckList(deck, "abilities").entries()) {
    if (!isRecord(value)) {
      fail(`abilities[${index}] 必须是对象`);
    }
    const id = referenceId(value, `abilities[${index}]`);
    if (abilities.has(id)) {
      fail(`abilities 不能包含重复引用 "${id}"`);
    }
    if (typeof value.kind !== "string") {
      fail(`abilities[${index}].kind 缺失`);
    }
    abilities.set(id, value.kind);
  }

  const membershipKeys: string[] = [];
  for (const [index, value] of deckList(deck, "factionMemberships").entries()) {
    if (!isRecord(value)) {
      fail(`factionMemberships[${index}] 必须是对象`);
    }
    const characterId = fieldReference(value, ["character", "characterId"], `factionMemberships[${index}] 人物引用`);
    const factionId = fieldReference(value, ["faction", "factionId"], `factionMemberships[${index}] 势力引用`);
    requireReference(characterId, characters, "人物");
    requireReference(factionId, factions, "势力");
    membershipKeys.push(`${characterId}:${factionId}`);
  }
  assertUnique(membershipKeys, "factionMemberships");

  const keyCharacters = deckList(deck, "keyCharacterRefs").map((value, index) =>
    referenceId(value, `keyCharacterRefs[${index}]`),
  );
  assertUnique(keyCharacters, "keyCharacterRefs");
  keyCharacters.forEach((id) => requireReference(id, characters, "关键人物"));

  const validateAbilityRefs = (field: string, expectedKind: "racial_tradition" | "racial_innate") => {
    const keys: string[] = [];
    for (const [index, value] of deckList(deck, field).entries()) {
      if (!isRecord(value)) {
        fail(`${field}[${index}] 必须是对象`);
      }
      const characterId = fieldReference(value, ["character", "characterId"], `${field}[${index}] 人物引用`);
      const abilityId = fieldReference(value, ["ability", "abilityId"], `${field}[${index}] 能力引用`);
      requireReference(characterId, characters, "人物");
      if (!abilities.has(abilityId)) {
        fail(`能力引用 "${abilityId}" 不存在`);
      }
      if (abilities.get(abilityId) !== expectedKind) {
        fail(`${field} 只能引用 ${expectedKind} 能力`);
      }
      keys.push(`${characterId}:${abilityId}`);
    }
    assertUnique(keys, field);
  };

  validateAbilityRefs("learnedTraditionRefs", "racial_tradition");
  validateAbilityRefs("racialOverrides", "racial_innate");
}
