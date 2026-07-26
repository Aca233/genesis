import { z } from "zod";
import type { WorldMode } from "@/lib/world-mode";
import { ActivityVisibilitySchema } from "@/lib/world-activity/contracts";
import { StrictExtractionSchema, ChronicleSchema, IconConceptSchema } from "./extractor";
import { PantheonTurnSchema } from "./pantheon";

export const SettlementPantheonTurnSchema = PantheonTurnSchema.extend({
  godName: z.string().trim().min(1).describe("必须是输入中的非玩家主要神正名"),
});

const CreatorAgendaUpdateSchema = z.object({
  shortTermGoals: z.array(z.string()).nullish(),
  schemes: z.array(z.string()).nullish(),
}).strict();

const CreatorRelationUpdateSchema = PantheonTurnSchema.shape.relationsUpdate.element.extend({
  target: z.string().trim().min(1).describe(
    "必须是输入中世界内部神明的精确正名或别名；不得使用实体名、ID 或 Creator",
  ),
});

export const SettlementCreatorTurnSchema = SettlementPantheonTurnSchema.extend({
  agendaUpdate: CreatorAgendaUpdateSchema.describe(
    "Creator 世界的议程增量；只能更新世界内部目标和计谋，不存在 stanceToPlayer",
  ),
  relationsUpdate: z.array(CreatorRelationUpdateSchema).describe(
    "世界内部神际关系变化；target 只能是输入中的神明正名或别名",
  ),
  proactiveEvent: z.object({
    type: z.string().describe("dream|envoy|miracle|summons|other"),
    openingHook: z.string().describe("下章由世界内部神明或实体触发的事件钩子（中文）"),
  }).nullable(),
});

const CreatorNewEntitySchema = StrictExtractionSchema.shape.newEntities.element.extend({
  isChosen: z.literal(false).describe("Creator 模式无世界内玩家角色，必须为 false"),
});
const CreatorEntityUpdateSchema = StrictExtractionSchema.shape.entityUpdates.element.extend({
  becameChosen: z.literal(false).nullish(),
});
const CreatorGodUpdateSchema = StrictExtractionSchema.shape.godUpdates.element.extend({
  relationChanges: z.array(CreatorRelationUpdateSchema).nullish().describe(
    "世界内部神际关系变化；target 只能是输入中的神明正名或别名",
  ),
  rankChange: StrictExtractionSchema.shape.godUpdates.element.shape.rankChange.describe(
    "世界内部神明的位阶变更提案，须有本章剧情依据",
  ),
});
const CreatorStrictExtractionSchema = StrictExtractionSchema.extend({
  newEntities: z.array(CreatorNewEntitySchema).describe(
    "值得入册的新实体；Creator 模式不得创建世界内玩家角色或选者",
  ),
  newGods: StrictExtractionSchema.shape.newGods.describe(
    "本章首次明确出现、值得入册的世界内部新神",
  ),
  entityUpdates: z.array(CreatorEntityUpdateSchema).describe("既有世界内部实体的增量"),
  godUpdates: z.array(CreatorGodUpdateSchema).describe("世界内部诸神状态变化，仅写有变化者"),
});

const SettlementIdentifierSchema = z.string().trim().min(1).max(200);
const SettlementEventKindSchema = z.enum([
  "war",
  "conspiracy",
  "disaster",
  "religious_conflict",
  "faction_shift",
  "world_crisis",
]);
const SettlementEventPhaseSchema = z.enum([
  "emerging",
  "developing",
  "escalating",
  "resolved",
]);

export const SettlementEventMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    sourceActivityIds: z.array(SettlementIdentifierSchema).min(1).max(20),
    kind: SettlementEventKindSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(2000),
    phase: z.enum(["emerging", "escalating"]),
    participantIds: z.array(SettlementIdentifierSchema).min(1).max(30),
    visibility: ActivityVisibilitySchema,
    iconConcept: IconConceptSchema.optional(),
  }).strict(),
  z.object({
    operation: z.literal("advance"),
    eventId: SettlementIdentifierSchema,
    phase: SettlementEventPhaseSchema,
    summary: z.string().trim().min(1).max(2000),
    participantIds: z.array(SettlementIdentifierSchema).min(1).max(30),
    visibility: ActivityVisibilitySchema,
    progressText: z.string().trim().min(1).max(1000),
  }).strict(),
  z.object({
    operation: z.literal("derive"),
    parentEventId: SettlementIdentifierSchema,
    title: z.string().trim().min(1).max(160),
    kind: SettlementEventKindSchema,
    summary: z.string().trim().min(1).max(2000),
    participantIds: z.array(SettlementIdentifierSchema).min(1).max(30),
    visibility: ActivityVisibilitySchema,
    iconConcept: IconConceptSchema.optional(),
  }).strict(),
]);

export const SettlementWorldActivitySchema = z.object({
  mergeActivityIds: z.array(SettlementIdentifierSchema).max(30).default([]),
  eventMutations: z.array(SettlementEventMutationSchema).max(8).default([]),
}).strict();

function settlementSchema(turn: typeof SettlementPantheonTurnSchema | typeof SettlementCreatorTurnSchema) {
  return z.object({
    pantheonTurns: z.array(turn),
    extraction: StrictExtractionSchema,
    chronicle: ChronicleSchema,
    worldActivity: SettlementWorldActivitySchema.default({
      mergeActivityIds: [],
      eventMutations: [],
    }),
  });
}

export const ChapterSettlementSchema = settlementSchema(SettlementPantheonTurnSchema);
export const CreatorChapterSettlementSchema = z.object({
  pantheonTurns: z.array(SettlementCreatorTurnSchema),
  extraction: CreatorStrictExtractionSchema,
  chronicle: ChronicleSchema,
  worldActivity: SettlementWorldActivitySchema.default({
    mergeActivityIds: [],
    eventMutations: [],
  }),
});

export function chapterSettlementSchema(mode: WorldMode) {
  return mode === "creator" ? CreatorChapterSettlementSchema : ChapterSettlementSchema;
}

export type ChapterSettlement = z.infer<typeof ChapterSettlementSchema>;
export type CreatorChapterSettlement = z.infer<typeof CreatorChapterSettlementSchema>;
export type ModeAwareChapterSettlement = ChapterSettlement | CreatorChapterSettlement;
export type SettlementWorldActivity = z.infer<typeof SettlementWorldActivitySchema>;
export type SettlementEventMutation = z.infer<typeof SettlementEventMutationSchema>;

const settlementJsonSchemas: Record<WorldMode, string> = {
  pantheon: JSON.stringify(z.toJSONSchema(ChapterSettlementSchema), null, 2),
  creator: JSON.stringify(z.toJSONSchema(CreatorChapterSettlementSchema), null, 2),
};

export function settlementSystem(mode: WorldMode): string {
  const turnRules = mode === "creator"
    ? `The player is the world-external Creator/observer, not a god or target inside the world.
- pantheonTurns are world-internal turns: each action and proactive event may target only world-internal gods or entities.
- Observation requests do not cause events by themselves. Never target, address, worship, oppose, rank, embody, or constrain the Creator.
- Agenda updates may change shortTermGoals and schemes, but must never produce stanceToPlayer.
- Every relationsUpdate.target and extraction.godUpdates[].relationChanges[].target must be an exact god name or alias listed in the input, never an entity name, ID, or the Creator.`
    : `The player is a god inside the world.
- A proactive event is required when an action directly targets the player god.`;
  return `You are the world-settlement engine for a continuous god-roleplay narrative.
Read the entire labelled checkpoint window and world state once, then produce all durable consequences in one JSON object. Internal checkpoint windows are not player-visible chapters.

Mode rules:
${turnRules}

Tasks inside the same response:
1. pantheonTurns: give every listed non-player major god exactly one offstage action. Respect rank order, persona, agenda, relations, abilities and earlier gods' consequences. A deliberate stillness is valid.
2. extraction: extract only state deltas explicitly supported by labelled chapter messages. Ability changes require one exact evidenceMessageIndex and a verbatim evidence excerpt of at least 12 Chinese characters.
3. chronicle: write 2-3 public historian entries and an epilogue. The legacy chapterTitle field is internal compatibility data only: return an empty string. Never expose hidden pantheon actions, abilities, agendas or relations.
4. worldActivity: merge duplicate activities, promote multiple related ordinary activities into an important event, advance or resolve an unresolved event, or derive a new event from one. Return empty arrays when no durable correction is justified.

Global rules:
- Output one JSON object only. No markdown or commentary. All user-facing strings are Chinese.
- Never invent IDs. Use exact known names and ability IDs from input.
- Never guess an activity or event ID from its title. worldActivity may reference only exact IDs listed in CHECKPOINT WORLD ACTIVITY.
- A create mutation must cite the exact related sourceActivityIds. An advance or derive mutation must cite an exact unresolved event ID.
- Do not create unrelated news. Every worldActivity mutation must follow from the checkpoint messages, listed activities, or listed unresolved events.
- For each create or derive worldActivity event, emit iconConcept as a semantic catalog token or short natural-language motif when possible. Never emit an Iconify ID, SVG, XML, HTML, or path data.
- Respect player-locked sections and ability fields.
- For an existing entity section, emit a whole section replacement only when the labelled prose explicitly changed it. Preserve still-valid supplied facts and Never invent missing details.
- For a character relation, use relationChanges only on a character entityUpdate and target an exact known character name or alias. Relations are directional; never infer the reverse relation. Emit only relations explicitly changed or established by the labelled prose, and Never invent a relation from proximity.
- For new entities, only named story-relevant entities qualify. New characters may reference only an exact known/new race name.
- New abilities require explicit learned/awakened evidence; characters may create personal, gods divine, races racial_innate/racial_tradition.
- 若正文明确写出某角色成功研发、正式命名或首次稳定施展一种可复用的法术、战技或工程战斗技术，应作为新能力抽取；单次环境偶发、临时工具效果或未成功设想不得登记为能力。
- Every listed non-player major god must appear once in pantheonTurns; do not add unlisted gods.
- An omen is subtle and mortal-perceivable.

Output schema:
${settlementJsonSchemas[mode]}`;
}

export function settlementUserPrompt(opts: {
  mode: WorldMode;
  chapterMessages: string;
  scaleNote: string;
  eraSystem: string;
  currentYearLabel: string;
  entities: string;
  gods: string;
  abilities: string;
  lockedPaths: string;
  worldActivity?: string;
  fusionAxiom?: string;
}): string {
  return `== WORLD MODE ==
${opts.mode}

== ERA ==
${opts.eraSystem}（当前：${opts.currentYearLabel}）

== CHECKPOINT WINDOW SCALE ==
${opts.scaleNote}

== NON-PLAYER MAJOR GODS AND PRIVATE CARDS ==
${opts.gods || "—"}

== KNOWN ENTITIES ==
${opts.entities || "—"}

== KNOWN ABILITIES (binding) ==
${opts.abilities || "—"}

== PLAYER-LOCKED SECTIONS ==
${opts.lockedPaths || "—"}
${opts.fusionAxiom ? `\n== FUSION AXIOM ==\n${opts.fusionAxiom}\n` : ""}
== CHECKPOINT WORLD ACTIVITY ==
${opts.worldActivity || "—"}

== FULL LABELLED CHECKPOINT WINDOW MESSAGES ==
${opts.chapterMessages || "—"}


Return the one complete world-settlement JSON now.`;
}
