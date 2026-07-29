import type { StructuralManifest } from "./preflight";
import type { GenesisV2StageId } from "./stage-registry";

export type GenesisV2ShadowValidation = {
  valid: boolean;
  issues: string[];
};

const FORBIDDEN_PROJECTION_KEYS = new Set(["World", "world", "worldId", "draftDeck"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

function expectedRefsForStage(
  stageId: GenesisV2StageId,
  manifest: StructuralManifest,
): Set<string> {
  const entityKinds = stageId === "pantheon_domain"
    ? new Set(["player_god", "major_god"])
    : stageId === "civilizations"
      ? new Set(["race", "faction", "place"])
      : stageId === "characters"
        ? new Set(["character"])
        : new Set<string>();
  const ownerKindsBySlotId = new Map(
    manifest.slots
      .filter((slot) => slot.category === "entity")
      .map((slot) => [slot.slotId, slot.kind]),
  );

  return new Set(manifest.slots
    .filter((slot) => {
      if (stageId === "blueprint") return false;
      if (stageId === "eras") return slot.category === "event";
      if (slot.category === "entity") return entityKinds.has(slot.kind);
      if (slot.category !== "ability" || !slot.ownerSlotId) return false;
      return entityKinds.has(ownerKindsBySlotId.get(slot.ownerSlotId) ?? "");
    })
    .map((slot) => slot.canonicalRef));
}

function addCardAndAbilityRefs(
  target: Set<string>,
  cards: Record<string, unknown>[],
): void {
  for (const card of cards) {
    const ref = stringField(card, "ref");
    if (ref) target.add(ref);
    for (const ability of records(card.abilities)) {
      const abilityRef = stringField(ability, "ref");
      if (abilityRef) target.add(abilityRef);
    }
  }
}

function actualRefsForStage(
  stageId: GenesisV2StageId,
  output: Record<string, unknown>,
): Set<string> {
  const refs = new Set<string>();
  if (stageId === "pantheon_domain") {
    const playerGod = isRecord(output.playerGod) ? [output.playerGod] : [];
    addCardAndAbilityRefs(refs, [...playerGod, ...records(output.majorGods)]);
  } else if (stageId === "civilizations") {
    addCardAndAbilityRefs(refs, records(output.races));
    addCardAndAbilityRefs(refs, records(output.factions));
    addCardAndAbilityRefs(refs, records(output.places));
  } else if (stageId === "eras") {
    addCardAndAbilityRefs(refs, records(output.canonEvents));
  } else if (stageId === "characters") {
    addCardAndAbilityRefs(refs, records(output.majorCharacters));
  }
  return refs;
}

export function validateGenesisV2ShadowOutput(input: {
  stageId: GenesisV2StageId;
  output: Record<string, unknown>;
  structuralManifest: StructuralManifest;
}): GenesisV2ShadowValidation {
  const issues: string[] = [];
  const registeredRefs = new Set(input.structuralManifest.slots.map((slot) => slot.canonicalRef));
  const immutableRefs = new Set(input.structuralManifest.slots
    .filter((slot) => slot.binding === "locked" || slot.binding === "full_lock")
    .map((slot) => slot.canonicalRef));

  for (const key of Object.keys(input.output)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(key)) issues.push(`FORBIDDEN_WORLD_PROJECTION:${key}`);
  }

  const slots = input.output.slots;
  if (slots !== undefined) {
    if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
      issues.push("INVALID_SLOT_MAP");
    } else {
      for (const ref of Object.keys(slots)) {
        if (!registeredRefs.has(ref)) issues.push(`UNREGISTERED_SLOT:${ref}`);
        if (immutableRefs.has(ref)) issues.push(`IMMUTABLE_SLOT_WRITE:${ref}`);
      }
    }
  }

  if (input.stageId === "civilizations" && slots && typeof slots === "object" && !Array.isArray(slots)) {
    for (const [ref, value] of Object.entries(slots)) {
      if (!ref.startsWith("race:") || !value || typeof value !== "object" || Array.isArray(value)) continue;
      const abilities = (value as Record<string, unknown>).abilities;
      if (!abilities || typeof abilities !== "object" || Array.isArray(abilities)
        || Object.keys(abilities).length < 2) {
        issues.push(`RACE_ABILITY_SLOTS_TOO_SMALL:${ref}`);
      }
    }
  }

  if (typeof input.output.mode === "string") {
    if (input.output.mode !== input.structuralManifest.mode) {
      issues.push(`MODE_MISMATCH:${input.output.mode}`);
    }

    if (input.stageId === "blueprint") {
      const briefs = isRecord(input.output.slotBriefs) ? new Set(Object.keys(input.output.slotBriefs)) : new Set<string>();
      const expected = new Set(input.structuralManifest.slots.map((slot) => slot.canonicalRef));
      for (const ref of [...expected].sort()) {
        if (!briefs.has(ref)) issues.push(`MISSING_SLOT_BRIEF:${ref}`);
      }
      for (const ref of [...briefs].sort()) {
        if (!expected.has(ref)) issues.push(`UNREGISTERED_SLOT_BRIEF:${ref}`);
      }
    } else {
      const expected = expectedRefsForStage(input.stageId, input.structuralManifest);
      const actual = actualRefsForStage(input.stageId, input.output);
      for (const ref of [...expected].sort()) {
        if (!actual.has(ref)) issues.push(`MISSING_REGISTERED_REF:${ref}`);
      }
      for (const ref of [...actual].sort()) {
        if (!expected.has(ref)) issues.push(`UNREGISTERED_REF:${ref}`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
