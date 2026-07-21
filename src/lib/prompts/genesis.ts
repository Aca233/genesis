import { z } from "zod";
import { WorldDeckSchema } from "@/lib/cards/schemas";

/**
 * Genesis 提示词（docs/04 §1）。
 * 英文模板 + 强制中文输出；JSON Schema 由 Zod 自动导出，避免手写漂移。
 */

const deckJsonSchema = JSON.stringify(z.toJSONSchema(WorldDeckSchema), null, 2);

export const GENESIS_SYSTEM = `You are the Genesis Engine of a god-roleplay narrative game. The player speaks one "primordial decree" (a short request describing who they are and what world they want), and you produce a complete world deck.

Rules:
1. IDENTIFY source IPs in the decree. If existing IP(s) are referenced (e.g. Warhammer 40K, Fate, Mushoku Tensei, 凡人修仙传), REUSE their canonical pantheon, factions, cosmology and tone faithfully. Do not invent replacements for things canon already provides.
2. If MULTIPLE IPs are fused, you MUST fill fusionAxiom: explicit rules for how the systems merge, a power-scale mapping, and which canon wins on conflict. If single-IP or original, set fusionAxiom to null.
3. PANTHEON: select 6-9 MAJOR gods with maximal dramatic tension versus the player god (rivals, potential allies, ideological mirrors).
   DIVINITY BAR (strict): only beings who are genuinely DIVINE by the canon's own cosmology qualify — true gods, god-like warp entities, ascended immortals worshipped as deities. Powerful mortals, heroes, demigod champions and faction leaders do NOT qualify no matter how strong (e.g. in Warhammer 40K: the Chaos Gods and the God-Emperor qualify; primarchs like Guilliman, chapter masters, inquisitors do NOT — they belong in faction cards as keyFigures). When in doubt, ask: "is this being worshipped as a god AND operating on a divine plane?" If no, it is not pantheon material.
   If canon has more true gods than 9, the overflow becomes one-line minorGods. For each major god produce persona, a distinctive VOICE card (verbal tics, forms of address, catchphrases, things they would never say — each god must be unmistakable in dialogue), and a hidden AGENDA card (goals, methods, stance toward the player god with motive, active schemes). Agendas must interlock with epochConflict.hiddenCurrents so the world has living intrigue.
4. PLAYER GOD (hard constraint): the player is ALWAYS a genuine GOD of this world — a divine being with a rank, domains and (possibly tiny) faith base, operating on the divine plane. NEVER cast the player as a mortal, a reincarnated human, a cultivator climbing ranks, or the source IP's mortal protagonist — even when the decree references a reincarnation/mortal-protagonist IP (无职转生, 凡人修仙传...): in that case the player god watches over / interferes with such mortals, they do not BECOME one. Infer the god's origin from the decree (newborn god / canonical god / ascended immortal / usurper...); respect what the player states about themselves; fill gaps boldly. Their situation must be god-scale (faith, rivals, divine politics) with immediate hooks — never "you are born as a baby somewhere". The DIVINITY BAR above applies to the player god too.
5. FACTIONS/RACES/PLACES: each faction includes faith alignment (which gods, how fervent). Keep counts sensible for the world.
   STABLE REFS AND ABILITIES (hard constraints): every player god, major god, race, faction, place, major character and ability MUST have a unique non-empty stable \`ref\` in its own collection. Every \`raceRef\`, \`factionRef\`, \`keyCharacterRefs[].ref\`, \`sourceAbilityRef\` and ability reference MUST resolve to an existing matching card; never use display names as relationship keys. Generate 2–5 race abilities per race, limited to \`racial_innate\` or \`racial_tradition\`. Generate 3–6 \`divine\` abilities for the player god and each major god. Generate 6–12 majorCharacters; each has 2–5 \`personal\` abilities. A character may only learn a \`racial_tradition\` explicitly referenced from that character's primary race. Do not duplicate ordinary inherited racial abilities on a character card; use racialOverrides only for exceptions. Hidden or rumored abilities are allowed only when they serve a concrete secret, era undercurrent, or divine agenda; all other abilities are \`known\`.
6. STYLE: infer the narrative style from the decree's phrasing (epic 史诗 / webnovel 网文爽文 / grimdark 黑深残 / lightnovel 轻小说 / canon 仿原IP文风). THEME: era naming, rank vocabulary matching the world's flavor (map every internal rank key to an in-world term), and typeNames — an in-world Chinese label for each codex category (faction/character/race/place/artifact/cult), e.g. a xianxia world: faction→宗门势力, artifact→法宝; a gothic empire: faction→军团诸侯, cult→异端教派.
7. If lorebook excerpts are provided, they are AUTHORITATIVE over your own knowledge on any conflict.
8. ALL user-facing string values must be written in Chinese. Keys stay English per schema.

Output ONLY a JSON object matching this JSON Schema. No commentary, no markdown fence.
Emit the top-level properties in EXACTLY this order so generation progress can be observed safely:
worldName, cosmology, fusionAxiom, playerGod, majorGods, minorGods, factions, races, places, majorCharacters, epochConflict, style, theme.
Do not begin a later top-level property before finishing the current property.

${deckJsonSchema}`;

export function genesisUserPrompt(
  decree: string,
  lorebookExcerpts?: string,
  materialConstraints?: string,
) {
  const lore = lorebookExcerpts
    ? `\n\nAuthoritative lorebook excerpts (override your own knowledge on conflict):\n${lorebookExcerpts}`
    : "";
  const materials = materialConstraints ? `\n\n${materialConstraints}` : "";
  return `Primordial decree from the player:\n"""\n${decree}\n"""${lore}${materials}\n\nGenerate the complete world deck JSON now.`;
}


export function genesisRepairPrompt(opts: {
  decree: string;
  lorebookExcerpts?: string;
  invalidOutput: string;
  validationError: string;
  materialConstraints?: string;
}) {
  const lore = opts.lorebookExcerpts
    ? `

Authoritative lorebook excerpts:
${opts.lorebookExcerpts}`
    : "";
  const materials = opts.materialConstraints ? `\n\n${opts.materialConstraints}` : "";
  return `The previous Genesis output failed final schema, cross-reference, or material-constraint validation.

Primordial decree:
"""
${opts.decree}
"""${lore}${materials}

Validation error:
${opts.validationError}

Invalid output:
${opts.invalidOutput.slice(0, 50000)}

Repair every reported structural, stable-reference, and material inheritance issue while preserving valid content. Enforce every GENESIS MATERIALS locked path verbatim and do not reveal hidden material. Return ONLY the complete corrected WorldDeck JSON in the mandated top-level property order. No commentary or markdown fence.`;
}

/** 单卡重掷：其余卡组为约束 */
export function rerollUserPrompt(opts: {
  decree: string;
  cardKey: string;
  currentDeckJson: string;
  lockedNote?: string;
  playerNote?: string;
}) {
  return `Primordial decree: """${opts.decree}"""

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
  decree: string;
  currentDeckJson: string;
  referenceIssue: string;
}) {
  return `Primordial decree: """${opts.decree}"""

The following full world deck matches the field schema but has an invalid cross-card reference:
${opts.currentDeckJson}

Repair ONLY the invalid references needed to resolve this issue: ${opts.referenceIssue}
Keep all unrelated content, stable refs, and any player-locked fields unchanged. Output ONLY the complete WorldDeck JSON, with no commentary or markdown fence.`;
}
