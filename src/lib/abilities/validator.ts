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
  if (before.state === "deprecated" && after.state !== before.state) {
    fail("deprecated 能力不可恢复或转换状态");
  }
  if (before.state === "lost" && after.state !== before.state && eventType !== "restored") {
    fail("lost 能力只能通过 restored 事件恢复");
  }
}

export interface WorldDeckRef {
  ref: string;
}

export interface WorldDeckAbilityRef extends WorldDeckRef {
  kind: string;
}

/** Structural contract for the final WorldDeck reference graph (Task 5 independent). */
export interface WorldDeckReferenceGraph {
  mode?: "pantheon" | "creator";
  playerGod?: WorldDeckRef;
  majorGods?: Array<WorldDeckRef & { relations?: Array<{ targetGodRef: string | WorldDeckRef }> }>;
  races: Array<WorldDeckRef & { abilities: WorldDeckAbilityRef[] }>;
  factions: Array<WorldDeckRef & { keyCharacterRefs: WorldDeckRef[] }>;
  majorCharacters: Array<
    WorldDeckRef & {
      raceRef: string | WorldDeckRef;
      factionMemberships: Array<{ factionRef: string | WorldDeckRef }>;
      learnedTraditionRefs: Array<{ sourceAbilityRef: string | WorldDeckRef }>;
      racialOverrides: Array<{
        sourceAbilityRef: string | WorldDeckRef;
        bloodlineJustification?: string | null;
      }>;
    }
  >;
}

type DeckRecord = Record<string, unknown>;

interface DeckAbilitySource {
  raceRef: string;
  kind: string;
}

function isRecord(value: unknown): value is DeckRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deckList(deck: DeckRecord, field: string): unknown[] {
  const value = deck[field];
  if (!Array.isArray(value)) {
    fail(`${field} 必须是数组`);
  }
  return value;
}

function record(value: unknown, label: string): DeckRecord {
  if (!isRecord(value)) {
    fail(`${label} 必须是对象`);
  }
  return value;
}

function referenceRef(value: unknown, label: string): string {
  const ref = typeof value === "string" ? value : isRecord(value) ? value.ref : undefined;
  if (typeof ref !== "string" || ref.trim() === "" || ref.trim() !== ref) {
    fail(`${label} 必须是非空且无首尾空白的 ref`);
  }
  return ref;
}

function fieldRef(recordValue: DeckRecord, field: string, label: string): string {
  if (recordValue[field] === undefined) {
    fail(`${label}缺失`);
  }
  return referenceRef(recordValue[field], label);
}

function assertUnique(refs: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) {
      fail(`${label} 不能包含重复 ref "${ref}"`);
    }
    seen.add(ref);
  }
}

function requireReference(ref: string, available: ReadonlySet<string>, label: string): void {
  if (!available.has(ref)) {
    fail(`${label}引用 "${ref}" 不存在`);
  }
}

/**
 * Validates the final nested WorldDeck reference graph without importing the
 * future Task 5 Zod schema. Every error is a readable domain validation error.
 */
export function validateDeckReferences(deck: WorldDeckReferenceGraph): void {
  const root = record(deck, "WorldDeck");

  if (root.mode === "creator") {
    if (root.playerGod !== undefined) {
      fail("creator 模式不能包含 playerGod");
    }
    const majorGods = deckList(root, "majorGods").map((rawGod, index) => {
      const god = record(rawGod, `majorGods[${index}]`);
      return { ref: fieldRef(god, "ref", `majorGods[${index}].ref`), value: god };
    });
    assertUnique(majorGods.map(({ ref }) => ref), "majorGods");
    const majorGodRefs = new Set(majorGods.map(({ ref }) => ref));
    for (const [godIndex, god] of majorGods.entries()) {
      const relationTargets = deckList(god.value, "relations").map((rawRelation, relationIndex) => {
        const relation = record(rawRelation, `majorGods[${godIndex}].relations[${relationIndex}]`);
        return fieldRef(relation, "targetGodRef", `majorGods[${godIndex}].relations[${relationIndex}].targetGodRef`);
      });
      assertUnique(relationTargets, `majorGods[${godIndex}].relations`);
      for (const targetRef of relationTargets) {
        if (targetRef === god.ref) fail(`主神关系不能引用自身 "${god.ref}"`);
        requireReference(targetRef, majorGodRefs, "主神关系");
      }
    }
  }

  const races = new Set<string>();
  const abilities = new Map<string, DeckAbilitySource>();

  const raceRefs: string[] = [];
  for (const [raceIndex, rawRace] of deckList(root, "races").entries()) {
    const race = record(rawRace, `races[${raceIndex}]`);
    const raceRef = fieldRef(race, "ref", `races[${raceIndex}].ref`);
    raceRefs.push(raceRef);
    races.add(raceRef);

    const abilityRefs: string[] = [];
    for (const [abilityIndex, rawAbility] of deckList(race, "abilities").entries()) {
      const ability = record(rawAbility, `races[${raceIndex}].abilities[${abilityIndex}]`);
      const abilityRef = fieldRef(ability, "ref", `races[${raceIndex}].abilities[${abilityIndex}].ref`);
      abilityRefs.push(abilityRef);
      if (abilities.has(abilityRef)) {
        fail(`abilities 不能包含重复 ref "${abilityRef}"`);
      }
      if (typeof ability.kind !== "string") {
        fail(`races[${raceIndex}].abilities[${abilityIndex}].kind 缺失`);
      }
      abilities.set(abilityRef, { raceRef, kind: ability.kind });
    }
    assertUnique(abilityRefs, `races[${raceIndex}].abilities`);
  }
  assertUnique(raceRefs, "races");

  const factions = new Map<string, DeckRecord>();
  const factionRefs: string[] = [];
  for (const [index, rawFaction] of deckList(root, "factions").entries()) {
    const faction = record(rawFaction, `factions[${index}]`);
    const factionRef = fieldRef(faction, "ref", `factions[${index}].ref`);
    factionRefs.push(factionRef);
    factions.set(factionRef, faction);
  }
  assertUnique(factionRefs, "factions");

  const characters = new Map<string, { raceRef: string; value: DeckRecord }>();
  const characterRefs: string[] = [];
  for (const [index, rawCharacter] of deckList(root, "majorCharacters").entries()) {
    const character = record(rawCharacter, `majorCharacters[${index}]`);
    const characterRef = fieldRef(character, "ref", `majorCharacters[${index}].ref`);
    const raceRef = fieldRef(character, "raceRef", `majorCharacters[${index}].raceRef`);
    characterRefs.push(characterRef);
    requireReference(raceRef, races, "种族");
    characters.set(characterRef, { raceRef, value: character });
  }
  assertUnique(characterRefs, "majorCharacters");

  for (const [factionRef, faction] of factions) {
    const keyRefs = deckList(faction, "keyCharacterRefs").map((value, index) =>
      referenceRef(value, `factions[${factionRef}].keyCharacterRefs[${index}]`),
    );
    assertUnique(keyRefs, `factions[${factionRef}].keyCharacterRefs`);
    keyRefs.forEach((ref) => requireReference(ref, new Set(characters.keys()), "关键人物"));
  }

  for (const [characterRef, character] of characters) {
    const memberships = deckList(character.value, "factionMemberships").map((value, index) => {
      const membership = record(value, `majorCharacters[${characterRef}].factionMemberships[${index}]`);
      return fieldRef(membership, "factionRef", `majorCharacters[${characterRef}].factionMemberships[${index}].factionRef`);
    });
    assertUnique(memberships, `majorCharacters[${characterRef}].factionMemberships`);
    memberships.forEach((ref) => requireReference(ref, new Set(factions.keys()), "势力"));

    const validateSources = (
      field: "learnedTraditionRefs" | "racialOverrides",
      expectedKind: "racial_tradition" | "racial_innate",
      mustMatchRace: boolean,
    ) => {
      const references = deckList(character.value, field).map((value, index) => {
        const override = record(value, `majorCharacters[${characterRef}].${field}[${index}]`);
        return {
          sourceRef: fieldRef(override, "sourceAbilityRef", `majorCharacters[${characterRef}].${field}[${index}].sourceAbilityRef`),
          bloodlineJustification: override.bloodlineJustification,
        };
      });
      assertUnique(references.map(({ sourceRef }) => sourceRef), `majorCharacters[${characterRef}].${field}`);
      for (const { sourceRef, bloodlineJustification } of references) {
        const source = abilities.get(sourceRef);
        if (source === undefined) {
          fail(`能力来源引用 "${sourceRef}" 不存在`);
        }
        if (source.kind !== expectedKind) {
          fail(`${field} 只能引用 ${expectedKind} 能力`);
        }
        if (mustMatchRace && source.raceRef !== character.raceRef) {
          fail(`族群技艺来源必须属于人物主种族 "${character.raceRef}"`);
        }
        if (
          field === "racialOverrides" &&
          source.raceRef !== character.raceRef &&
          (typeof bloodlineJustification !== "string" || bloodlineJustification.trim() === "")
        ) {
          fail("跨种族 racial_innate 覆写必须提供非空 bloodlineJustification");
        }
      }
    };

    validateSources("learnedTraditionRefs", "racial_tradition", true);
    validateSources("racialOverrides", "racial_innate", false);
  }
}
