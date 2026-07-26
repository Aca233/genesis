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

// 将临之事状态机：结算侧仅允许 pending→eligible/altered/cancelled/occurred 与
// eligible→occurred/altered/cancelled；enum 刻意不含 pending——事件不可回退为未裁决。
const CanonEventStatusUpdateSchema = z.enum(["eligible", "altered", "cancelled", "occurred"]);
export const CanonEventUpdateSchema = z.object({
  ref: SettlementIdentifierSchema.describe("必须是 IMPENDING CANON EVENTS 中列出的精确 ref"),
  status: CanonEventStatusUpdateSchema,
  note: z.string().trim().min(1).max(300).describe(
    "作者侧一句判定因由（中文）；altered/cancelled 时说明改道原因与矛盾压力的新去向",
  ),
  rumor: z.string().trim().min(1).max(300).nullish().describe(
    "仅 status=eligible 时：凡人视角的传闻或预言一句（中文），绝不点破条件、机制或必然性",
  ),
}).strict();
export type CanonEventUpdate = z.infer<typeof CanonEventUpdateSchema>;

function settlementSchema(turn: typeof SettlementPantheonTurnSchema | typeof SettlementCreatorTurnSchema) {
  return z.object({
    pantheonTurns: z.array(turn),
    extraction: StrictExtractionSchema,
    chronicle: ChronicleSchema,
    worldActivity: SettlementWorldActivitySchema.default({
      mergeActivityIds: [],
      eventMutations: [],
    }),
    // .default([]) 保证本字段引入前持久化的 pendingSettlement 仍通过
    // readPendingSettlement 的 safeParse，断点续跑零影响。
    canonEventUpdates: z.array(CanonEventUpdateSchema).max(5).default([]),
  });
}

// 仅万神殿档：玩家神神权行使的代价审计。optional——引入前持久化的 pendingSettlement
// 仍通过 readPendingSettlement 的 safeParse，claimSettlementModel 断点恢复零影响。
export const ChapterSettlementSchema = settlementSchema(SettlementPantheonTurnSchema).extend({
  divineCostAudit: z.array(z.object({
    abilityName: z.string().trim().min(1),
    verdict: z.enum(["honored", "dodged"]),
    note: z.string().trim().min(1).max(200).describe(
      "dodged 时：该代价将如何在世间显形的一句中文暗记，将原样入征兆队列",
    ),
  }).strict()).max(4).optional(),
});
export const CreatorChapterSettlementSchema = z.object({
  pantheonTurns: z.array(SettlementCreatorTurnSchema),
  extraction: CreatorStrictExtractionSchema,
  chronicle: ChronicleSchema,
  worldActivity: SettlementWorldActivitySchema.default({
    mergeActivityIds: [],
    eventMutations: [],
  }),
  canonEventUpdates: z.array(CanonEventUpdateSchema).max(5).default([]),
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
1. pantheonTurns: give every listed non-player major god exactly one offstage action. Respect rank order, persona, agenda, relations, abilities and earlier gods' consequences. A deliberate stillness is valid. Each god's action must be written in that god's own temperament and diction per its supplied card — a drunk brawler god and a courtly dragon king must never share sentence patterns. Where RECENT OFFSTAGE ACTIONS are supplied for a god, advance, conclude or derail that thread first: never repeat an unfulfilled departure, preparation or observation beat from an earlier checkpoint.
2. extraction: extract only state deltas explicitly supported by labelled chapter messages. Ability changes require one exact evidenceMessageIndex and a verbatim evidence excerpt of at least 12 Chinese characters.
3. chronicle: write 2-3 public historian entries and an epilogue. The legacy chapterTitle field is internal compatibility data only: return an empty string. When an == ERA TO CLOSE == block is supplied, additionally fill chronicle.eraDigest: closedEra is the era being closed; text is one 150-400 character historian's summary of that entire era distilled from the listed entries (its defining conflicts, transformations and legacies). Otherwise omit eraDigest. Never expose hidden pantheon actions, abilities, agendas or relations.
4. worldActivity: merge duplicate activities, promote multiple related ordinary activities into an important event, advance or resolve an unresolved event, or derive a new event from one. Return empty arrays when no durable correction is justified.
5. canonEventUpdates: judge each entry under IMPENDING CANON EVENTS against this checkpoint window and the supplied world state. Promote pending→eligible only when every listed prerequisite plausibly holds now; mark altered or cancelled when established events have broken a prerequisite (the note names the break and where that social pressure flows instead); mark occurred only when the checkpoint prose actually depicted the event happening. A wide-span checkpoint (years and beyond) should re-examine every listed entry; a scene-scale checkpoint rarely changes more than one. Return [] when nothing changed.${mode === "creator" ? "" : `
6. divineCostAudit: for each divine ability the player god exercised inside the window, verify its supplied cost and limitations were actually paid or hit in the prose. Emit one item per exercised ability: honored when paid; dodged when the prose let it slide. For dodged, note must be a one-sentence in-world echo (世间暗记, e.g. 河谷的井水一夜转咸) through which the debt can later come due — it will be fed back verbatim as an omen. Omit the field when the player god exercised no divine ability.`}

Global rules:
- Output one JSON object only. No markdown or commentary. All user-facing strings are Chinese.
- Never let engine vocabulary (本章, 章节, 剧情, 检查点, 玩家, AI, 设定, 系统) or fourth-wall memes from player input enter any user-facing string (summaries, aliases, sections, chronicle text); re-express such content as in-world diction (e.g. a player's out-of-world joke becomes an in-world epithet).
- Never invent IDs. Use exact known names and ability IDs from input.
- Never guess an activity or event ID from its title. worldActivity may reference only exact IDs listed in CHECKPOINT WORLD ACTIVITY.
- A create mutation must cite the exact related sourceActivityIds. An advance or derive mutation must cite an exact unresolved event ID.
- Do not create unrelated news. Every worldActivity mutation must follow from the checkpoint messages, listed activities, or listed unresolved events.
- For each create or derive worldActivity event, emit iconConcept as a semantic catalog token or short natural-language motif when possible. Never emit an Iconify ID, SVG, XML, HTML, or path data.
- Respect player-locked sections and ability fields.
- For an existing entity section, emit a whole section replacement only when the labelled prose explicitly changed it. Preserve still-valid supplied facts and Never invent missing details.
- For a character relation, use relationChanges only on a character entityUpdate and target an exact known character name or alias. Relations are directional; never infer the reverse relation. Emit only relations explicitly changed or established by the labelled prose, and Never invent a relation from proximity. EXISTING RELATIONS lines show the stored graph; never re-emit an unchanged listed relation.
- For new entities, only named story-relevant entities qualify. New characters may reference only an exact known/new race name.
- New abilities require explicit learned/awakened evidence; characters may create personal, gods divine, races racial_innate/racial_tradition.
- 若正文明确写出某角色成功研发、正式命名或首次稳定施展一种可复用的法术、战技或工程战斗技术，应作为新能力抽取；单次环境偶发、临时工具效果或未成功设想不得登记为能力。
- Every listed non-player major god must appear once in pantheonTurns; do not add unlisted gods.
- An omen is subtle and mortal-perceivable.
- IMPENDING CANON EVENTS are author-only knowledge. Their titles, summaries and conditions must never appear verbatim in any user-facing string (chronicle text, summaries, sections, rumor); a rumor is a mortal-perceivable whisper — a distorted shadow of the truth, never a schedule. These candidates are pressure, not a script: never steer pantheonTurns, extraction or chronicle toward them without in-fiction cause.

Output schema:
${settlementJsonSchemas[mode]}`;
}

// TIME BUDGET 是导演内核（temporal spec §14）接手前的过渡性提示词投入：
// 仅在既有自由纪年标签下做推进裁决并禁止自造历法，不引入序数或可比时间。
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
  eraToClose?: string;
  canonEvents?: string;
  timeBudget?: string;
  chosenMortals?: string;
}): string {
  return `== WORLD MODE ==
${opts.mode}

== ERA ==
${opts.eraSystem}（当前：${opts.currentYearLabel}）
${opts.eraToClose ? `\n== ERA TO CLOSE (compress into chronicle.eraDigest) ==\n${opts.eraToClose}\n` : ""}
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
${opts.canonEvents ? `\n== IMPENDING CANON EVENTS (author-only; never quote verbatim) ==\n${opts.canonEvents}\n` : ""}
== CHECKPOINT WORLD ACTIVITY ==
${opts.worldActivity || "—"}
${opts.timeBudget ? `\n== TIME BUDGET ==\nThis checkpoint window spans ${opts.timeBudget}. Real in-world time has passed. For EVERY unresolved event listed in CHECKPOINT WORLD ACTIVITY and EVERY listed god's agenda shortTermGoals, decide what this span did to it: advanced (emit the matching worldActivity advance mutation or agendaUpdate), concluded (resolve or fulfil it), or lapsed (overtaken by time — reflect its quiet failure in that god's agendaUpdate). A span of years must not leave every thread frozen mid-step; leaving a listed item untouched is a deliberate choice, never a default. Express any dated outcome in the era format already supplied above; never invent a rival calendar or convert dates.\n` : ""}${opts.chosenMortals ? `\n== CHOSEN MORTALS (lifespan adjudication required) ==\n${opts.chosenMortals}\nReturn one extraction.chosenLifespanChecks item for EVERY chosen mortal listed. When the window spans years or the prose shows aging, decline, succession or death, also emit the matching entityUpdates lifespan sectionDelta (and died=true when applicable). unchanged is valid only with a reason.\n` : ""}
== FULL LABELLED CHECKPOINT WINDOW MESSAGES ==
${opts.chapterMessages || "—"}


Return the one complete world-settlement JSON now.`;
}
