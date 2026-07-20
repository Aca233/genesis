import type {
  AbilityInput,
  AbilityProjection,
  KnownAbilityProjection,
  RumoredAbilityProjection,
} from "./types";

/**
 * Creates the player-safe DTO for one ability.
 *
 * This server-side projection deliberately omits private mechanics from rumors
 * and withholds hidden abilities altogether.
 */
export function projectAbilityForPlayer(
  ability: AbilityInput,
): AbilityProjection | null {
  switch (ability.visibility) {
    case "known":
      return toKnownProjection(ability);
    case "rumored":
      return toRumoredProjection(ability);
    case "hidden":
      return null;
  }
}

/** Projects a collection without exposing hidden abilities to a player. */
export function projectAbilitiesForPlayer(
  abilities: readonly AbilityInput[],
): AbilityProjection[] {
  return abilities.flatMap((ability) => {
    const projection = projectAbilityForPlayer(ability);
    return projection === null ? [] : [projection];
  });
}

function toKnownProjection(ability: AbilityInput): KnownAbilityProjection {
  return { ...ability, visibility: "known" };
}

function toRumoredProjection(ability: AbilityInput): RumoredAbilityProjection {
  return {
    id: ability.id,
    name: ability.name,
    kind: ability.kind,
    visibility: "rumored",
    rumorText: ability.rumorText,
    state: ability.state,
  };
}
