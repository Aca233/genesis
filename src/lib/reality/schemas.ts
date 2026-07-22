import { z } from "zod";
import {
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
} from "@/lib/abilities/types";
import type { WorldDeck } from "@/lib/cards/schemas";
import {
  CosmologyCardSchema,
  FusionAxiomCardSchema,
  RankSchema,
  RelationLabelSchema,
  StableRefSchema,
  StyleCardSchema,
  ThemeCardSchema,
} from "@/lib/cards/schemas";

export const EstablishedFactSchema = z.object({
  ref: StableRefSchema,
  text: z.string().min(1),
  establishedByRewriteId: z.string().nullable(),
}).strict();

export const RealityStateSchema = z.object({
  theme: ThemeCardSchema,
  style: StyleCardSchema,
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable(),
  currentEra: z.string(),
  establishedFacts: z.array(EstablishedFactSchema),
}).strict();

export const ObserverStateSchema = z.object({
  focusType: z.enum(["world", "place", "entity", "god", "avatar"]),
  focusId: z.string().nullable(),
  timeLabel: z.string(),
  viewpoint: z.enum(["omniscient", "limited"]),
  activeAvatarId: z.string().nullable(),
}).strict();

export type RealityState = z.infer<typeof RealityStateSchema>;
export type ObserverState = z.infer<typeof ObserverStateSchema>;

export function initialRealityState(deck: WorldDeck): RealityState {
  return RealityStateSchema.parse({
    theme: deck.theme,
    style: deck.style,
    cosmology: deck.cosmology,
    fusionAxiom: deck.fusionAxiom,
    currentEra: deck.epochConflict.yearLabel,
    establishedFacts: [],
  });
}

export function initialObserverState(deck: WorldDeck): ObserverState {
  return ObserverStateSchema.parse({
    focusType: "world",
    focusId: null,
    timeLabel: deck.epochConflict.yearLabel,
    viewpoint: "omniscient",
    activeAvatarId: null,
  });
}

/** Stable summary shown for the root node in the reality tree. */
export function initialBranchSummary(deck: WorldDeck): string {
  const { epochName, yearLabel, overtConflicts } = deck.epochConflict;
  const conflicts = overtConflicts.join("；");
  return `${epochName} · ${yearLabel}${conflicts ? `：${conflicts}` : ""}`;
}


// ───────────────────────── Absolute reality rewrites ─────────────────────────

export const RewriteScopeSchema = z.enum([
  "prospective",
  "retroactive",
  "memory_only",
]);
export type RewriteScope = z.infer<typeof RewriteScopeSchema>;

/**
 * Returns the deepest semantic effect represented by a decree. Historical
 * changes dominate memory changes, which dominate current/future changes.
 */
export function normalizeRewriteScope(
  scopes?: readonly (RewriteScope | null | undefined)[],
): RewriteScope {
  if (scopes?.includes("retroactive")) return "retroactive";
  if (scopes?.includes("memory_only")) return "memory_only";
  return "prospective";
}

const NonEmptyIdSchema = z.string().trim().min(1);
const ChineseBranchNameSchema = z.string()
  .regex(/^\p{Script=Han}{4,10}$/u, "分支名必须为 4–10 个中文字符");

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

export const RealityCardPatchSchema = z.object({
  section: z.enum([
    "theme",
    "style",
    "cosmology",
    "fusionAxiom",
    "currentEra",
    "establishedFacts",
  ]),
  value: z.unknown(),
}).strict().refine(
  (patch) => Object.prototype.hasOwnProperty.call(patch, "value"),
  { path: ["value"], message: "现实卡补丁必须显式提供 value" },
);

const RewriteGodRelationSchema = z.object({
  targetRef: StableRefSchema,
  label: RelationLabelSchema,
  note: z.string(),
}).strict();

export const RewriteGodSchema = z.object({
  name: z.string().trim().min(1),
  aliases: z.array(z.string()),
  tier: z.enum(["major", "minor"]),
  rank: RankSchema,
  domains: z.array(z.string()),
  persona: z.unknown().nullable(),
  voice: z.unknown().nullable(),
  agenda: z.unknown().nullable(),
  relations: z.array(RewriteGodRelationSchema),
  faithScope: z.string().nullable(),
}).strict();

const RewriteGodChangesSchema = RewriteGodSchema.partial()
  .refine(hasKeys, "神明更新 changes 不得为空");

export const GodPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    tempRef: StableRefSchema,
    value: RewriteGodSchema,
  }).strict(),
  z.object({
    op: z.literal("update"),
    targetId: NonEmptyIdSchema,
    changes: RewriteGodChangesSchema,
  }).strict(),
  z.object({
    op: z.literal("remove"),
    targetId: NonEmptyIdSchema,
  }).strict(),
]);

const RewriteEntitySectionSchema = z.object({
  key: z.string().trim().min(1),
  content: z.unknown(),
  revealed: z.boolean(),
  rumorText: z.string().nullable(),
}).strict().refine(
  (section) => Object.prototype.hasOwnProperty.call(section, "content"),
  { path: ["content"], message: "实体栏目必须显式提供 content" },
);

export const RewriteEntitySchema = z.object({
  type: z.enum(["faction", "character", "race", "place", "artifact", "cult"]),
  name: z.string().trim().min(1),
  aliases: z.array(z.string()),
  summary: z.string(),
  raceRef: StableRefSchema.nullable(),
  heat: z.enum(["active", "dormant"]),
  isMajorCharacter: z.boolean(),
  isCreatorAvatar: z.boolean(),
  sections: z.array(RewriteEntitySectionSchema),
}).strict();

const RewriteEntityChangesSchema = RewriteEntitySchema.partial()
  .refine(hasKeys, "实体更新 changes 不得为空");

export const EntityPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    tempRef: StableRefSchema,
    value: RewriteEntitySchema,
  }).strict(),
  z.object({
    op: z.literal("update"),
    targetId: NonEmptyIdSchema,
    changes: RewriteEntityChangesSchema,
  }).strict(),
  z.object({
    op: z.literal("remove"),
    targetId: NonEmptyIdSchema,
  }).strict(),
]);

export const RewriteAbilitySchema = z.object({
  name: z.string().trim().min(1),
  kind: AbilityKindSchema,
  effect: z.string(),
  trigger: z.string(),
  cost: z.string(),
  limitations: z.string(),
  mastery: AbilityMasterySchema,
  state: AbilityStateSchema,
  visibility: AbilityVisibilitySchema,
  rumorText: z.string().nullable(),
  bloodlineJustification: z.string().nullable(),
  sourceAbilityRef: StableRefSchema.nullable(),
  lockedFields: z.array(z.string()),
}).strict();

export const ObserverFocusTypeSchema = z.enum([
  "world",
  "place",
  "entity",
  "god",
  "avatar",
]);

const SetObserverFocusActionSchema = z.object({
  action: z.literal("set_focus"),
  focusType: ObserverFocusTypeSchema,
  focusId: NonEmptyIdSchema.nullable(),
}).strict().superRefine((action, ctx) => {
  const isWorld = action.focusType === "world";
  if (isWorld !== (action.focusId === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["focusId"],
      message: isWorld
        ? "世界焦点不能携带 focusId"
        : "非世界焦点必须携带 focusId",
    });
  }
});

export const ObserverActionSchema = z.discriminatedUnion("action", [
  SetObserverFocusActionSchema,
  z.object({
    action: z.literal("set_viewpoint"),
    viewpoint: z.enum(["omniscient", "limited"]),
  }).strict(),
  z.object({
    action: z.literal("create_avatar"),
    name: z.string().trim().min(1).max(80),
    identity: z.string().max(500),
    appearance: z.string().max(1000),
    raceId: NonEmptyIdSchema.nullable(),
    abilities: z.array(RewriteAbilitySchema).max(12),
  }).strict(),
  z.object({
    action: z.literal("enter_avatar"),
    avatarId: NonEmptyIdSchema,
  }).strict(),
  z.object({ action: z.literal("exit_avatar") }).strict(),
  z.object({
    action: z.literal("withdraw_avatar"),
    avatarId: NonEmptyIdSchema,
  }).strict(),
]);

export type ObserverAction = z.infer<typeof ObserverActionSchema>;

const RewriteAbilityChangesSchema = RewriteAbilitySchema.partial()
  .refine(hasKeys, "能力更新 changes 不得为空");

export const AbilityPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    tempRef: StableRefSchema,
    ownerRef: StableRefSchema,
    value: RewriteAbilitySchema,
  }).strict(),
  z.object({
    op: z.literal("update"),
    targetId: NonEmptyIdSchema,
    ownerRef: StableRefSchema.optional(),
    changes: RewriteAbilityChangesSchema,
  }).strict(),
  z.object({
    op: z.literal("remove"),
    targetId: NonEmptyIdSchema,
  }).strict(),
]);

export const RewriteChronicleSchema = z.object({
  chapterIndex: z.number().int().nonnegative(),
  yearLabel: z.string(),
  text: z.string(),
  entityRefs: z.array(StableRefSchema),
  godRefs: z.array(StableRefSchema),
  revealed: z.boolean(),
  revealedAtChapter: z.number().int().nonnegative().nullable(),
  source: z.enum(["narrative", "pantheon", "manual", "rewrite"]),
}).strict();

const RewriteChronicleChangesSchema = RewriteChronicleSchema.partial()
  .refine(hasKeys, "编年史更新 changes 不得为空");

export const ChroniclePatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    tempRef: StableRefSchema,
    value: RewriteChronicleSchema,
  }).strict(),
  z.object({
    op: z.literal("update"),
    targetId: NonEmptyIdSchema,
    changes: RewriteChronicleChangesSchema,
  }).strict(),
  z.object({
    op: z.literal("remove"),
    targetId: NonEmptyIdSchema,
  }).strict(),
]);

export const MemoryPatchSchema = z.object({
  entityId: NonEmptyIdSchema,
  operation: z.enum(["replace", "append", "remove"]),
  text: z.string(),
}).strict();

export const RewriteSubcommandSchema = z.object({
  decree: z.string().trim().min(1),
  scope: RewriteScopeSchema.default("prospective"),
  effectivePoint: z.string().trim().min(1),
}).strict();

export const RewritePlanSchema = z.object({
  scope: RewriteScopeSchema.default("prospective"),
  interpretation: z.string().trim().min(1),
  effectivePoint: z.string().trim().min(1),
  branchName: ChineseBranchNameSchema,
  realityCardPatches: z.array(RealityCardPatchSchema),
  godPatches: z.array(GodPatchSchema),
  entityPatches: z.array(EntityPatchSchema),
  abilityPatches: z.array(AbilityPatchSchema),
  chroniclePatches: z.array(ChroniclePatchSchema),
  memoryPatches: z.array(MemoryPatchSchema),
  causalConsequences: z.array(z.string().trim().min(1)),
  narrationFocus: z.string().trim().min(1),
  subcommands: z.array(RewriteSubcommandSchema).min(1),
}).strict().superRefine((plan, ctx) => {
  const createPatches = [
    ...plan.godPatches,
    ...plan.entityPatches,
    ...plan.abilityPatches,
    ...plan.chroniclePatches,
  ].filter((patch) => patch.op === "create");
  const seen = new Set<string>();
  for (const patch of createPatches) {
    if (seen.has(patch.tempRef)) {
      ctx.addIssue({
        code: "custom",
        message: `创建补丁 tempRef 必须唯一：${patch.tempRef}`,
      });
    }
    seen.add(patch.tempRef);
  }
});

export type RewritePlan = z.infer<typeof RewritePlanSchema>;
