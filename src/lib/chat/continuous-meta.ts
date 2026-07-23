import { z } from "zod";

export const SettlementReasonSchema = z.enum([
  "major_event",
  "ability_change",
  "important_death",
  "faction_change",
  "rank_change",
  "identity_change",
  "relation_restructure",
  "era_change",
  "multi_entity_change",
]);

export const TemporalPatchSchema = z.object({
  era: z.string().trim().min(1).max(120).optional(),
  time: z.string().trim().min(1).max(160).optional(),
}).strict().refine(
  (value) => value.era !== undefined || value.time !== undefined,
  "时间变化至少包含 era 或 time",
);

export const ImmediateChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set_observer_focus"),
    focusType: z.enum(["world", "place", "entity", "god", "avatar"]),
    focusId: z.string().trim().min(1).nullable(),
  }).strict(),
  z.object({
    kind: z.literal("set_scene_presence"),
    entityId: z.string().trim().min(1),
    present: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("set_active_avatar"),
    entityId: z.string().trim().min(1).nullable(),
  }).strict(),
  z.object({
    kind: z.literal("set_entity_section"),
    entityId: z.string().trim().min(1),
    key: z.enum([
      "whereabouts",
      "holder",
      "affiliation",
      "relationToPlayer",
      "majorEvents",
    ]),
    content: z.string().trim().min(1).max(1000),
  }).strict(),
]);

export const AbilityRevealSchema = z.object({
  abilityId: z.string().trim().min(1),
  visibility: z.enum(["rumored", "known"]),
  evidence: z.string().trim().min(1),
}).strict();

export const ContinuousNarratorMetaSchema = z.object({
  suggestions: z.array(z.string().trim().min(1)).max(4).default([]),
  operation: z.enum(["continue", "retroactive_rewrite"]).default("continue"),
  temporalState: TemporalPatchSchema.optional(),
  immediateChanges: z.array(ImmediateChangeSchema).max(12).default([]),
  significantEvent: z.boolean().default(false),
  settlementReasons: z.array(SettlementReasonSchema).max(9).default([]),
  revealedEventIds: z.array(z.string()).optional(),
  abilityReveals: z.array(AbilityRevealSchema).optional(),
}).strict();

export type ContinuousNarratorMeta = z.infer<typeof ContinuousNarratorMetaSchema>;
export type ImmediateChange = z.infer<typeof ImmediateChangeSchema>;
export type SettlementReason = z.infer<typeof SettlementReasonSchema>;

export function emptyContinuousMeta(): ContinuousNarratorMeta {
  return {
    suggestions: [],
    operation: "continue",
    immediateChanges: [],
    significantEvent: false,
    settlementReasons: [],
  };
}

