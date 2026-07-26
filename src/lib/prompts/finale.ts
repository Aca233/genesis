import { z } from "zod";

/**
 * 陨灭终章（endgame）：玩家神 rank=fallen 后由史官一次性收束整条时间线。
 * 指令为英文、产出为中文，风格对齐 settlementSystem；单次结构化调用，
 * 无 META 块、无建议——终章之后此界只读。
 */

export const FinaleSchema = z.object({
  finaleProse: z.string().min(300).describe("史诗终章正文：600-1500字中文，史官笔法收束整条时间线"),
  chronicleEntries: z.array(
    z.object({
      yearLabel: z.string().trim().min(1),
      text: z.string().trim().min(1),
    }).strict(),
  ).min(1).max(3),
}).strict();

export type Finale = z.infer<typeof FinaleSchema>;

const finaleJsonSchema = JSON.stringify(z.toJSONSchema(FinaleSchema), null, 2);

export function finaleSystem(): string {
  return `You are the Court Historian writing the FINAL chapter of a god-roleplay world. The player god has fallen to 陨灭 — utterly extinguished.
- Write the epic finale (史诗终章): how the flame guttered out, what the world remembers and mis-remembers, the fates of the surviving major gods and of the chosen mortals, and the long shadow the player god's deeds cast over eras to come.
- 史官笔法 with at most 2 close-up vignettes; end with the world moving on — the chronicle closes, the world endures.
- Honor the supplied STYLE CARD and THEME CARD; use the established era format for every year label; never invent a rival calendar.
- chronicleEntries: 1-3 entries (each 40-80 Chinese characters) recording the fall and its aftermath.
- All user-facing strings Chinese. Output ONE JSON object matching the schema; no markdown, no META block, no suggestions.

Output schema:
${finaleJsonSchema}`;
}

/** 尾部正文注入上限（按 Unicode 码点截取，避免拆散代理对） */
const RECENT_PROSE_TAIL_CHARS = 4000;

export function finaleUserPrompt(opts: {
  worldName: string;
  styleCard: unknown;
  themeCard: unknown;
  era: string;
  time: string;
  /** 一行：name/domains/faithScope/rank */
  playerGod: string;
  /** 每神一行：name+rank */
  gods: string;
  /** 每人一行：name+summary */
  chosen: string;
  /** 逐行 [yearLabel] text */
  recentChronicle: string;
  recentProse: string;
}): string {
  const proseTail = Array.from(opts.recentProse).slice(-RECENT_PROSE_TAIL_CHARS).join("");
  return `== WORLD ==
${opts.worldName}

== STYLE CARD ==
${JSON.stringify(opts.styleCard ?? null)}

== THEME CARD ==
${JSON.stringify(opts.themeCard ?? null)}

== ERA ==
${opts.era}（当前：${opts.time}）

== PLAYER GOD (fallen) ==
${opts.playerGod || "—"}

== GODS ==
${opts.gods || "—"}

== CHOSEN MORTALS ==
${opts.chosen || "—"}

== RECENT CHRONICLE ==
${opts.recentChronicle || "—"}

== RECENT PROSE (tail) ==
${proseTail || "—"}

Write the one complete finale JSON now.`;
}
