import type { AbilityInput, AbilityState, EffectiveAbility } from "./types";

export interface ResolveEffectiveAbilitiesInput {
  raceAbilities?: readonly AbilityInput[];
  characterAbilities?: readonly AbilityInput[];
}

const unavailableStates = new Set<AbilityState>(["sealed", "lost", "deprecated"]);

function isUsable(ability: AbilityInput): boolean {
  return (
    ability.mastery !== "unawakened" && !unavailableStates.has(ability.state)
  );
}

function assertUniqueDerivedSources(
  characterAbilities: readonly AbilityInput[],
): void {
  const sourceIds = new Set<string>();

  for (const ability of characterAbilities) {
    if (
      (ability.kind !== "racial_innate" && ability.kind !== "racial_tradition") ||
      ability.sourceAbilityId === null
    ) {
      continue;
    }

    if (sourceIds.has(ability.sourceAbilityId)) {
      throw new Error(`重复能力来源 "${ability.sourceAbilityId}"`);
    }

    sourceIds.add(ability.sourceAbilityId);
  }
}

/**
 * Resolves a character's currently usable abilities without querying storage.
 * Inputs must already have passed through normalizePersistedAbility at the
 * persistence boundary.
 */
export function resolveEffectiveAbilities({
  raceAbilities = [],
  characterAbilities = [],
}: ResolveEffectiveAbilitiesInput): EffectiveAbility[] {
  assertUniqueDerivedSources(characterAbilities);

  const innateTemplates = raceAbilities.filter(
    (ability) => ability.kind === "racial_innate",
  );
  const innateIds = new Set(innateTemplates.map((ability) => ability.id));
  const overridesBySourceId = new Map<string, AbilityInput>();

  for (const ability of characterAbilities) {
    if (
      ability.kind !== "racial_innate" ||
      ability.sourceAbilityId === null ||
      !innateIds.has(ability.sourceAbilityId)
    ) {
      continue;
    }

    overridesBySourceId.set(ability.sourceAbilityId, ability);
  }

  const inheritedOrOverridden = innateTemplates.map((template) => {
    const override = overridesBySourceId.get(template.id);
    const selected = override ?? template;

    return {
      ...selected,
      sourceAbilityId: selected.sourceAbilityId ?? template.id,
      inherited: override === undefined,
    } satisfies EffectiveAbility;
  });

  const characterSpecific = characterAbilities
    .filter(
      (ability) =>
        !(
          ability.kind === "racial_innate" &&
          ability.sourceAbilityId !== null &&
          innateIds.has(ability.sourceAbilityId)
        ),
    )
    .map((ability) => ({ ...ability, inherited: false }) satisfies EffectiveAbility);

  return [...inheritedOrOverridden, ...characterSpecific].filter(isUsable);
}
