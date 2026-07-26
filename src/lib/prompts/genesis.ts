import { z } from "zod";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
} from "@/lib/cards/schemas";
import type { WorldMode } from "@/lib/world-mode";

/** Genesis prompts are generated from the exact schema selected by frozen mode. */
const deckJsonSchemas: Record<WorldMode, string> = {
  pantheon: JSON.stringify(z.toJSONSchema(PantheonWorldDeckSchema), null, 2),
  creator: JSON.stringify(z.toJSONSchema(CreatorWorldDeckSchema), null, 2),
};

const SHARED_RULES = `Rules:
1. IDENTIFY source IPs in the decree. If existing IP(s) are referenced (e.g. Warhammer 40K, Fate, Mushoku Tensei, 凡人修仙传), REUSE their canonical pantheon, factions, cosmology and tone faithfully. Do not invent replacements for things canon already provides.
2. If MULTIPLE IPs are fused, you MUST fill fusionAxiom: explicit rules for how the systems merge, a power-scale mapping, and which canon wins on conflict. If single-IP or original, set fusionAxiom to null.
3. DIVINITY BAR (strict): only beings who are genuinely DIVINE by the canon's own cosmology qualify — true gods, god-like warp entities, ascended immortals worshipped as deities. Powerful mortals, heroes, demigod champions and faction leaders do NOT qualify no matter how strong. They belong in faction or character cards.
4. FACTIONS/RACES/PLACES: each faction includes faith alignment (which gods, how fervent). Keep counts sensible for the world.
   STABLE REFS AND ABILITIES (hard constraints): every major god, race, faction, place, major character and ability MUST have a unique non-empty stable ref. Every raceRef, factionRef, keyCharacterRefs[].ref, sourceAbilityRef, ability reference, and god relation target MUST resolve to an existing matching card; never use display names as relationship keys. Generate 2–5 race abilities per race, limited to racial_innate or racial_tradition. Generate 3–6 divine abilities for each major god. Generate 6–12 majorCharacters; each has 2–5 personal abilities. A character may only learn a racial_tradition explicitly referenced from that character's primary race. Do not duplicate ordinary inherited racial abilities on a character card; use racialOverrides only for exceptions. Hidden or rumored abilities are allowed only when they serve a concrete secret, era undercurrent, or divine agenda; all other abilities are known.
5. STYLE: infer the narrative style from the decree's phrasing (epic 史诗 / webnovel 网文爽文 / grimdark 黑深残 / lightnovel 轻小说 / canon 仿原IP文风). THEME: era naming, rank vocabulary matching the world's flavor (map every internal rank key to an in-world term), and typeNames — an in-world Chinese label for each codex category (faction/character/race/place/artifact/cult). Fill the style card completely: rhythm, narrationNotes, 2-3 dictionExamples written in the world's own voice, and tabooPhrases listing the overused AI-writing cliches this world must ration (e.g. 仿佛/似乎 hedges, 一丝/一抹 quantifiers, 眼中闪过, 空气仿佛凝固, inflated intensifiers like 极度/终极).
6. If lorebook excerpts are provided, they are AUTHORITATIVE over your own knowledge on any conflict.
7. ALL user-facing string values must be written in Chinese. Keys stay English per schema.`;

const MODE_RULES: Record<WorldMode, string> = {
  pantheon: `PANTHEON MODE (hard constraints):
- Output mode="pantheon".
- PANTHEON: select 6-9 MAJOR gods with maximal dramatic tension versus the player god (rivals, potential allies, ideological mirrors).
  DIVINITY BAR (strict): only beings who are genuinely DIVINE by the canon's own cosmology qualify — true gods, god-like warp entities, ascended immortals worshipped as deities. Powerful mortals, heroes, demigod champions and faction leaders do NOT qualify no matter how strong (e.g. in Warhammer 40K: the Chaos Gods and the God-Emperor qualify; primarchs like Guilliman, chapter masters, inquisitors do NOT — they belong in faction cards as keyFigures). When in doubt, ask: "is this being worshipped as a god AND operating on a divine plane?" If no, it is not pantheon material.
  If canon has more true gods than 9, the overflow becomes one-line minorGods. For each major god produce persona, a distinctive VOICE card (verbal tics, forms of address, catchphrases, things they would never say — each god must be unmistakable in dialogue), and a hidden AGENDA card (goals, methods, stance toward the player god with motive, active schemes). Agendas must interlock with epochConflict.hiddenCurrents so the world has living intrigue.
- PLAYER GOD: the player is ALWAYS a genuine GOD of this world — a divine being with a rank, domains and (possibly tiny) faith base, operating on the divine plane. NEVER cast the player as a mortal, a reincarnated human, a cultivator climbing ranks, or the source IP's mortal protagonist — even when the decree references a reincarnation/mortal-protagonist IP (无职转生, 凡人修仙传...): in that case the player god watches over / interferes with such mortals, they do not BECOME one. Infer the god's origin from the decree (newborn god / canonical god / ascended immortal / usurper...); respect what the player states about themselves; fill gaps boldly. Their situation must be god-scale (faith, rivals, divine politics) with immediate hooks — never "you are born as a baby somewhere". The DIVINITY BAR above applies to the player god too.
- Create playerGod with 3–6 divine abilities. Every player god ref and ability ref follows the same stable-reference rules. Each major-god agenda includes stanceToPlayer and each major god includes initialRelationToPlayer.`,
  creator: `CREATOR MODE (hard constraints):
- Output mode="creator".
- The player is outside the world and is not a god, character, faction, force, hidden entity, or worship target inside it.
- Never create playerGod. Do not encode the player as any world-internal identity, power, secret cause, faith object, or hidden actor.
- Select 6–9 genuinely divine major gods and build the pantheon around tensions among world-internal gods. Every agenda and relation may reference only world-internal objects.
- Creator god agendas never contain stanceToPlayer; creator major gods never contain initialRelationToPlayer. Use relations with targetGodRef/label/note for world-internal god relationships only.`,
};

const TOP_LEVEL_ORDER: Record<WorldMode, string> = {
  pantheon: "mode, worldName, cosmology, fusionAxiom, playerGod, majorGods, minorGods, factions, races, places, majorCharacters, epochConflict, style, theme",
  creator: "mode, worldName, cosmology, fusionAxiom, majorGods, minorGods, factions, races, places, majorCharacters, epochConflict, style, theme",
};

export function genesisSystem(mode: WorldMode): string {
  return `You are the Genesis Engine of a god-roleplay narrative game. Produce a complete world deck from one primordial decree.\n\n${SHARED_RULES}\n\n${MODE_RULES[mode]}\n\nOutput ONLY a JSON object matching this JSON Schema. No commentary or markdown fence.\nEmit top-level properties in EXACTLY this order: ${TOP_LEVEL_ORDER[mode]}.\nThe first property must be mode with the exact value "${mode}". Do not begin a later property before finishing the current property.\n\n${deckJsonSchemas[mode]}`;
}

/** Temporary pantheon alias for legacy call sites; task 3 freezes mode through those routes. */
export const GENESIS_SYSTEM = genesisSystem("pantheon");

export function genesisUserPrompt(opts: {
  mode: WorldMode;
  decree: string;
  lorebookExcerpts?: string,
  materialConstraints?: string,
}): string {
  const lore = opts.lorebookExcerpts
    ? `\n\nAuthoritative lorebook excerpts (override your own knowledge on conflict):\n${opts.lorebookExcerpts}`
    : "";
  const materialText = opts.materialConstraints ? `\n\n${opts.materialConstraints}` : "";
  return `Frozen world mode: mode="${opts.mode}".\nPrimordial decree from the player:\n"""\n${opts.decree}\n"""${lore}${materialText}\n\nGenerate the complete world deck JSON now.`;
}

export function genesisRepairPrompt(opts: {
  mode: WorldMode;
  decree: string;
  lorebookExcerpts?: string;
  invalidOutput: string;
  validationError: string;
  materialConstraints?: string;
}) {
  const mode = opts.mode;
  const lore = opts.lorebookExcerpts
    ? `\n\nAuthoritative lorebook excerpts:\n${opts.lorebookExcerpts}`
    : "";
  const materials = opts.materialConstraints ? `\n\n${opts.materialConstraints}` : "";
  const modeGuard = mode === "creator"
    ? "Never introduce playerGod, stanceToPlayer, or initialRelationToPlayer. Preserve only world-internal god relations."
    : "Keep exactly one playerGod and all pantheon player-god relationship fields.";
  return `The previous Genesis output failed validation.\n\nFrozen world mode: mode="${mode}". ${modeGuard}\nPrimordial decree:\n"""\n${opts.decree}\n"""${lore}${materials}\n\nValidation error:\n${opts.validationError}\n\nInvalid output:\n${opts.invalidOutput.slice(0, 50000)}\n\nRepair every reported structural, stable-reference, and material inheritance issue while preserving valid content. Enforce every GENESIS MATERIALS locked path verbatim and do not reveal hidden material. Return ONLY the complete corrected JSON in this order: ${TOP_LEVEL_ORDER[mode]}. The first property must be mode="${mode}".`;
}

/** 单卡重掷：其余卡组为约束 */
export function rerollUserPrompt(opts: {
  mode: WorldMode;
  decree: string;
  cardKey: string;
  currentDeckJson: string;
  lockedNote?: string;
  playerNote?: string;
}) {
  const modeGuard = opts.mode === "creator"
    ? 'Frozen world mode: mode="creator". Never add playerGod, stanceToPlayer, or initialRelationToPlayer; preserve world-internal relations.'
    : 'Frozen world mode: mode="pantheon". Keep playerGod and all player-god relationship fields.';
  return `${modeGuard}
Primordial decree: """${opts.decree}"""

Current world deck (all other cards are CONSTRAINTS — stay consistent with them):
${opts.currentDeckJson}

Task: regenerate ONLY the card "${opts.cardKey}" with a fresh take, keeping full consistency with every other card. Preserve every stable ref outside the regenerated card. If the regenerated card is "races", "factions", or "majorCharacters", repair every affected cross-card reference in the full deck while preserving all player-locked field paths verbatim. Never leave a dangling raceRef, factionRef, keyCharacterRefs ref, or sourceAbilityRef.${
    opts.lockedNote
      ? `\nThe following field paths are player-locked and MUST be preserved verbatim: ${opts.lockedNote}`
      : ""
  }${opts.playerNote ? `\nPlayer's regeneration note: ${opts.playerNote}` : ""}

Output ONLY the JSON object for the full world deck with "${opts.cardKey}" replaced. All user-facing strings in Chinese.`;
}

/** A single targeted retry for a structurally valid but cross-reference-invalid reroll. */
export function rerollReferenceRepairPrompt(opts: {
  mode: WorldMode;
  decree: string;
  currentDeckJson: string;
  referenceIssue: string;
}) {
  const modeGuard = opts.mode === "creator"
    ? 'Frozen world mode: mode="creator". Never introduce playerGod or player-facing god relation fields.'
    : 'Frozen world mode: mode="pantheon". Preserve playerGod and player-facing god relation fields.';
  return `${modeGuard}
Primordial decree: """${opts.decree}"""

The following full world deck matches the field schema but has an invalid cross-card reference:
${opts.currentDeckJson}

Repair ONLY the invalid references needed to resolve this issue: ${opts.referenceIssue}
Keep all unrelated content, stable refs, and any player-locked fields unchanged. Output ONLY the complete WorldDeck JSON, with no commentary or markdown fence.`;
}
