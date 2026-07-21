import { z } from "zod";

export const MaterialKindSchema = z.enum([
  "player_god", "major_god", "character", "race", "faction", "place",
  "ability", "cosmology", "fusion_axiom", "epoch_conflict", "style", "theme",
]);
export type MaterialKind = z.infer<typeof MaterialKindSchema>;

export const MaterialOriginSchema = z.enum(["deck", "runtime", "edited"]);
export type MaterialOrigin = z.infer<typeof MaterialOriginSchema>;
export const ReuseModeSchema = z.enum(["remix", "inherit", "locked"]);
export type ReuseMode = z.infer<typeof ReuseModeSchema>;
export const DependencyDecisionSchema = z.enum(["include", "rebuild", "omit"]);
export type DependencyDecision = z.infer<typeof DependencyDecisionSchema>;

export const MaterialDependencySchema = z.object({
  key: z.string().min(1),
  relation: z.enum(["race", "faction", "ability_source", "owner", "card_ref"]),
  targetKind: MaterialKindSchema,
  targetRef: z.string().min(1),
  required: z.boolean().default(true),
  label: z.string().min(1),
});
export type MaterialDependency = z.infer<typeof MaterialDependencySchema>;

export const AbilityOwnerTargetSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("selected"), materialVersionId: z.string().min(1) }),
  z.object({ mode: z.literal("model"), allowCreateOwner: z.boolean() }),
]);
export type AbilityOwnerTarget = z.infer<typeof AbilityOwnerTargetSchema>;

export const MaterialSelectionItemSchema = z.object({
  materialCardId: z.string().min(1),
  materialVersionId: z.string().min(1),
  mode: ReuseModeSchema,
  fullLock: z.boolean().default(false),
  dependencyDecisions: z.record(z.string(), DependencyDecisionSchema).default({}),
  abilityOwner: AbilityOwnerTargetSchema.nullable().default(null),
  priority: z.number().int().nonnegative(),
  compressed: z.boolean().default(false),
});
export type MaterialSelectionItem = z.infer<typeof MaterialSelectionItemSchema>;

export const GenesisMaterialSnapshotItemSchema = z.object({
  selection: MaterialSelectionItemSchema,
  card: z.object({
    id: z.string(), kind: MaterialKindSchema, name: z.string(), summary: z.string(),
    sourceWorldName: z.string(), sourceKind: z.string(), sourceRef: z.string(),
  }),
  version: z.object({
    id: z.string(), version: z.number().int().positive(), name: z.string(),
    content: z.unknown(), dependencies: z.array(MaterialDependencySchema),
    schemaVersion: z.number().int().positive(),
  }),
});
export const GenesisMaterialSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(GenesisMaterialSnapshotItemSchema),
  estimatedChars: z.number().int().nonnegative(),
});
export type GenesisMaterialSnapshot = z.infer<typeof GenesisMaterialSnapshotSchema>;
export type GenesisMaterialSnapshotItem = z.infer<typeof GenesisMaterialSnapshotItemSchema>;
