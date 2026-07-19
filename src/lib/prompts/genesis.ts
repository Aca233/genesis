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
3. PANTHEON: select 6-9 MAJOR gods with maximal dramatic tension versus the player god (rivals, potential allies, ideological mirrors). If canon has more gods, the overflow becomes one-line minorGods. For each major god produce persona, a distinctive VOICE card (verbal tics, forms of address, catchphrases, things they would never say — each god must be unmistakable in dialogue), and a hidden AGENDA card (goals, methods, stance toward the player god with motive, active schemes). Agendas must interlock with epochConflict.hiddenCurrents so the world has living intrigue.
4. PLAYER GOD: infer their origin from the decree (newborn god / canonical god / reincarnated / usurper...). Respect what the player states about themselves; fill gaps boldly. Give them a starting situation with immediate hooks.
5. FACTIONS/RACES/PLACES: each faction includes faith alignment (which gods, how fervent). Keep counts sensible for the world.
6. STYLE: infer the narrative style from the decree's phrasing (epic 史诗 / webnovel 网文爽文 / grimdark 黑深残 / lightnovel 轻小说 / canon 仿原IP文风). THEME: era naming, rank vocabulary matching the world's flavor (map every internal rank key to an in-world term).
7. If lorebook excerpts are provided, they are AUTHORITATIVE over your own knowledge on any conflict.
8. ALL user-facing string values must be written in Chinese. Keys stay English per schema.

Output ONLY a JSON object matching this JSON Schema. No commentary, no markdown fence.

${deckJsonSchema}`;

export function genesisUserPrompt(decree: string, lorebookExcerpts?: string) {
  const lore = lorebookExcerpts
    ? `\n\nAuthoritative lorebook excerpts (override your own knowledge on conflict):\n${lorebookExcerpts}`
    : "";
  return `Primordial decree from the player:\n"""\n${decree}\n"""${lore}\n\nGenerate the complete world deck JSON now.`;
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

Task: regenerate ONLY the card "${opts.cardKey}" with a fresh take, keeping full consistency with every other card.${
    opts.lockedNote
      ? `\nThe following field paths are player-locked and MUST be preserved verbatim: ${opts.lockedNote}`
      : ""
  }${opts.playerNote ? `\nPlayer's regeneration note: ${opts.playerNote}` : ""}

Output ONLY the JSON object for the full world deck with "${opts.cardKey}" replaced. All user-facing strings in Chinese.`;
}
