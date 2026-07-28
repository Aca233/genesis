import type { StructuralManifest } from "./preflight";
import type { GenesisV2StageId } from "./stage-registry";

export type GenesisV2ShadowValidation = {
  valid: boolean;
  issues: string[];
};

const FORBIDDEN_PROJECTION_KEYS = new Set(["World", "world", "worldId", "draftDeck"]);

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

  return { valid: issues.length === 0, issues };
}
