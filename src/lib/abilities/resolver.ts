import type {
  AbilityInput,
  AbilityKind,
  AbilityMastery,
  AbilityState,
  AbilityVisibility,
  EffectiveAbility,
} from "./types";

/** The minimal shape accepted from forms, fixtures, and persisted ability records. */
type ResolvableAbility = Partial<AbilityInput> &
  Pick<AbilityInput, "id" | "name" | "kind">;

export interface ResolveEffectiveAbilitiesInput {
  raceAbilities?: readonly ResolvableAbility[];
  characterAbilities?: readonly ResolvableAbility[];
}

const unavailableStates = new Set<AbilityState>(["sealed", "lost", "deprecated"]);

function toAbilityInput(ability: ResolvableAbility): AbilityInput {
  return {
    id: ability.id,
    name: ability.name,
    kind: ability.kind as AbilityKind,
    effect: ability.effect ?? "",
    trigger: ability.trigger ?? "",
    cost: ability.cost ?? "",
    limitations: ability.limitations ?? "",
    mastery: (ability.mastery ?? "unawakened") as AbilityMastery,
    state: (ability.state ?? "normal") as AbilityState,
    visibility: (ability.visibility ?? "known") as AbilityVisibility,
    rumorText: ability.rumorText ?? null,
    sourceAbilityId: ability.sourceAbilityId ?? null,
    lockedFields: ability.lockedFields ?? [],
    version: ability.version ?? 0,
  };
}

function isUsable(ability: AbilityInput): boolean {
  return (
    ability.mastery !== "unawakened" && !unavailableStates.has(ability.state)
  );
}

/**
 * Resolves a character's currently usable abilities without querying any storage.
 *
 * Race templates grant only racial_innate abilities. A character ability linked by
 * sourceAbilityId replaces its matching innate template, which also allows a lost
 * override to suppress that inherited ability. Racial traditions must be present
 * on the character record before they can become effective.
 */
export function resolveEffectiveAbilities({
  raceAbilities = [],
  characterAbilities = [],
}: ResolveEffectiveAbilitiesInput): EffectiveAbility[] {
  const innateTemplates = raceAbilities.filter(
    (ability) => ability.kind === "racial_innate",
  );
  const innateIds = new Set(innateTemplates.map((ability) => ability.id));
  const overridesBySourceId = new Map<string, ResolvableAbility>();

  for (const ability of characterAbilities) {
    if (
      ability.kind === "racial_innate" &&
      ability.sourceAbilityId !== null &&
      ability.sourceAbilityId !== undefined &&
      innateIds.has(ability.sourceAbilityId)
    ) {
      overridesBySourceId.set(ability.sourceAbilityId, ability);
    }
  }

  const inheritedOrOverridden = innateTemplates.map((template) => {
    const override = overridesBySourceId.get(template.id);
    const selected = toAbilityInput(override ?? template);

    return {
      ...selected,
      sourceAbilityId: selected.sourceAbilityId ?? template.id,
      inherited: override === undefined,
    } satisfies EffectiveAbility;
  });

  const characterSpecific = characterAbilities
    .filter((ability) => {
      if (ability.kind !== "racial_innate") {
        return true;
      }

      return (
        ability.sourceAbilityId === null ||
        ability.sourceAbilityId === undefined ||
        !innateIds.has(ability.sourceAbilityId)
      );
    })
    .filter((ability) => ability.kind !== "racial_innate" || !ability.sourceAbilityId)
    .map((ability) => ({
      ...toAbilityInput(ability),
      inherited: false,
    } satisfies EffectiveAbility));

  return [...inheritedOrOverridden, ...characterSpecific].filter(isUsable);
}
