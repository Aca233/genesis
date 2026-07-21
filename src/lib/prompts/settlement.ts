import { z } from "zod";
import { StrictExtractionSchema, ChronicleSchema } from "./extractor";
import { PantheonTurnSchema } from "./pantheon";

export const SettlementPantheonTurnSchema = PantheonTurnSchema.extend({
  godName: z.string().trim().min(1).describe("必须是输入中的非玩家主要神正名"),
});

/** One chapter-close model response: divine turns, state deltas and chronicle. */
export const ChapterSettlementSchema = z.object({
  pantheonTurns: z.array(SettlementPantheonTurnSchema),
  extraction: StrictExtractionSchema,
  chronicle: ChronicleSchema,
});

export type ChapterSettlement = z.infer<typeof ChapterSettlementSchema>;

const settlementJsonSchema = JSON.stringify(z.toJSONSchema(ChapterSettlementSchema), null, 2);

export function settlementSystem(): string {
  return `You are the single chapter-settlement engine for a god-roleplay narrative game.
Read the entire labelled chapter and world state once, then produce ALL end-of-chapter consequences in one JSON object.

Tasks inside the same response:
1. pantheonTurns: give every listed non-player major god exactly one offstage action. Respect rank order, persona, agenda, relations, abilities and earlier gods' consequences. A deliberate stillness is valid.
2. extraction: extract only state deltas explicitly supported by labelled chapter messages. Ability changes require one exact evidenceMessageIndex and a verbatim evidence excerpt of at least 12 Chinese characters.
3. chronicle: write 2-3 public historian entries, an epilogue and a 4-8 character chapter title. Never expose hidden pantheon actions, abilities, agendas or relations.

Global rules:
- Output one JSON object only. No markdown or commentary. All user-facing strings are Chinese.
- Never invent IDs. Use exact known names and ability IDs from input.
- Respect player-locked sections and ability fields.
- For new entities, only named story-relevant entities qualify. New characters may reference only an exact known/new race name.
- New abilities require explicit learned/awakened evidence; characters may create personal, gods divine, races racial_innate/racial_tradition.
- Every listed non-player major god must appear once in pantheonTurns; do not add unlisted gods.
- An omen is subtle and mortal-perceivable. A proactive event is required when an action directly targets the player god.

Output schema:
${settlementJsonSchema}`;
}

export function settlementUserPrompt(opts: {
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
  return `== ERA ==
${opts.eraSystem}（当前：${opts.currentYearLabel}）

== CHAPTER SCALE ==
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
== FULL LABELLED CHAPTER MESSAGES ==
${opts.chapterMessages || "—"}


Return the one complete chapter-settlement JSON now.`;
}
