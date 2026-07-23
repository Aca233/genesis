import { z } from "zod";
import type { WorldMode } from "@/lib/world-mode";
import { StrictExtractionSchema, ChronicleSchema } from "./extractor";
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

function settlementSchema(turn: typeof SettlementPantheonTurnSchema | typeof SettlementCreatorTurnSchema) {
  return z.object({
    pantheonTurns: z.array(turn),
    extraction: StrictExtractionSchema,
    chronicle: ChronicleSchema,
  });
}

export const ChapterSettlementSchema = settlementSchema(SettlementPantheonTurnSchema);
export const CreatorChapterSettlementSchema = z.object({
  pantheonTurns: z.array(SettlementCreatorTurnSchema),
  extraction: CreatorStrictExtractionSchema,
  chronicle: ChronicleSchema,
});

export function chapterSettlementSchema(mode: WorldMode) {
  return mode === "creator" ? CreatorChapterSettlementSchema : ChapterSettlementSchema;
}

export type ChapterSettlement = z.infer<typeof ChapterSettlementSchema>;
export type CreatorChapterSettlement = z.infer<typeof CreatorChapterSettlementSchema>;
export type ModeAwareChapterSettlement = ChapterSettlement | CreatorChapterSettlement;

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

Global rules:
- Output one JSON object only. No markdown or commentary. All user-facing strings are Chinese.
- Never invent IDs. Use exact known names and ability IDs from input.
- Respect player-locked sections and ability fields.
- For new entities, only named story-relevant entities qualify. New characters may reference only an exact known/new race name.
- New abilities require explicit learned/awakened evidence; characters may create personal, gods divine, races racial_innate/racial_tradition.
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
== FULL LABELLED CHECKPOINT WINDOW MESSAGES ==
${opts.chapterMessages || "—"}


Return the one complete world-settlement JSON now.`;
}
