import { z } from "zod";

export const AbilityKindSchema = z.enum([
  "racial_innate",
  "racial_tradition",
  "personal",
  "divine",
]);
export type AbilityKind = z.infer<typeof AbilityKindSchema>;

export const AbilityMasterySchema = z.enum([
  "unawakened",
  "novice",
  "adept",
  "expert",
  "master",
]);
export type AbilityMastery = z.infer<typeof AbilityMasterySchema>;

export const AbilityStateSchema = z.enum([
  "normal",
  "enhanced",
  "impaired",
  "sealed",
  "lost",
  "deprecated",
]);
export type AbilityState = z.infer<typeof AbilityStateSchema>;

export const AbilityVisibilitySchema = z.enum(["known", "rumored", "hidden"]);
export type AbilityVisibility = z.infer<typeof AbilityVisibilitySchema>;

export const AbilityEventTypeSchema = z.enum([
  "awakened",
  "learned",
  "improved",
  "mutated",
  "impaired",
  "sealed",
  "restored",
  "lost",
  "revealed",
  "deprecated",
]);
export type AbilityEventType = z.infer<typeof AbilityEventTypeSchema>;

/** A complete persisted ability record, independent of whether it belongs to an entity or a god. */
export interface AbilityInput {
  id: string;
  name: string;
  kind: AbilityKind;
  effect: string;
  trigger: string;
  cost: string;
  limitations: string;
  mastery: AbilityMastery;
  state: AbilityState;
  visibility: AbilityVisibility;
  rumorText: string | null;
  sourceAbilityId: string | null;
  lockedFields: string[];
  version: number;
}

export type KnownAbilityProjection = AbilityInput;

export type RumoredAbilityProjection = Pick<
  AbilityInput,
  "id" | "name" | "kind" | "state" | "visibility" | "rumorText"
>;

/** The only forms that may be returned to a player: full known data or a limited rumor. */
export type AbilityProjection = KnownAbilityProjection | RumoredAbilityProjection;

/** A partial update must carry the record id and optimistic-lock version. */
export type AbilityChangeInput = Pick<AbilityInput, "id" | "version"> &
  Partial<Omit<AbilityInput, "id" | "version">>;

/** The resolved ability list marks defaults inherited from a character's primary race. */
export interface EffectiveAbility extends AbilityInput {
  inherited: boolean;
}
