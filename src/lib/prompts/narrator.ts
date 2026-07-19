import type { Scale } from "@/lib/cards/schemas";

/**
 * Narrator（Chronicler）提示词（docs/04 §2）。
 * 英文模板 + 强制中文输出。输出契约：正文之后另起一行 <<<META、一个 JSON、META>>>。
 */

// ───────────────────────── META 输出契约 ─────────────────────────

export const META_START = "<<<META";
export const META_END = "META>>>";

/** 尾部结构化块 */
export type NarratorMeta = {
  suggestions: string[];
  chapterBreakHint: boolean;
  /** 查探裁决：本轮揭示的隐藏大事记 id */
  revealedEventIds?: string[];
};

const EMPTY_META: NarratorMeta = { suggestions: [], chapterBreakHint: false };

/**
 * 从模型全量输出中剥离 META 块。
 * META 缺失/损坏一律容忍 → 回退空 meta（suggestions:[]）。
 */
export function splitMetaBlock(full: string): { prose: string; meta: NarratorMeta } {
  const idx = full.indexOf(META_START);
  if (idx === -1) return { prose: full.trim(), meta: EMPTY_META };

  const prose = full.slice(0, idx).trim();
  let block = full.slice(idx + META_START.length);
  const endIdx = block.indexOf(META_END);
  if (endIdx !== -1) block = block.slice(0, endIdx);

  try {
    const start = block.indexOf("{");
    const end = block.lastIndexOf("}");
    if (start === -1 || end <= start) return { prose, meta: EMPTY_META };
    const json = JSON.parse(block.slice(start, end + 1)) as Record<string, unknown>;
    const suggestions = Array.isArray(json.suggestions)
      ? json.suggestions
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, 4)
      : [];
    const revealedEventIds = Array.isArray(json.revealed_event_ids)
      ? json.revealed_event_ids.filter((s): s is string => typeof s === "string")
      : undefined;
    return {
      prose,
      meta: {
        suggestions,
        chapterBreakHint: json.chapterBreakHint === true,
        ...(revealedEventIds?.length ? { revealedEventIds } : {}),
      },
    };
  } catch {
    return { prose, meta: EMPTY_META };
  }
}

// ───────────────────────── 尺度三档文体规则 ─────────────────────────

const SCALE_RULES: Record<Scale, string> = {
  moment: `MOMENT scale — a single breath of time. Ultra-close: one exchange of dialogue, one gesture, one heartbeat rendered in fine sensory grain. The reply covers seconds to minutes at most; do NOT advance beyond the immediate beat.`,
  scene: `SCENE scale — moment-to-moment novelistic prose (小说正文). Anchor to a concrete place and hour; render dialogue and action line by line with sensory detail. Do not skip time beyond the immediate moment.`,
  years: `YEARS scale — a span of several years: seasonal rhythm prose. Show projects maturing, children growing, faiths spreading; interleave 1-2 close-up vignettes with summary passage of the years turning.`,
  era: `ERA scale — a montage spanning years to decades: annalistic prose (编年纪事) interleaved with 2-3 vivid close-up vignettes (特写). Name the spans of years; show change accumulating across seasons, reigns and generations.`,
  epoch: `EPOCH scale — centuries and beyond, written in a historian's register (史官笔法): the rise and fall of faiths, dynasties and peoples. Individuals appear only as history remembers them.`,
};

// ───────────────────────── 系统模板 ─────────────────────────

function coreRules(worldName: string): string {
  return `You are the Chronicler — the narrative engine of the god-roleplay world "${worldName}". You render everything on stage: mortals, gods, omens, the turning of ages.

CORE RULES:
- The player IS a god of this world. YIELD AGENCY: never act, decide, feel or speak for the player god. Their input arrives prefixed 【玩家神谕】; everything else belongs to you.
- Follow the CURRENT SCALE strictly (rules below). If the player's input implies a time span beyond the current scale, execute it faithfully, then append ONE gentle line at the very end of the prose (before the META block) reminding them they may switch scale — never force it.
- VOICE CARDS ARE LAW: every god who speaks must be unmistakably identifiable by their voice card (verbal tics, forms of address, catchphrases, things they would never say). No two gods may sound alike.
- The world does not orbit the player: NPCs and gods pursue their own ends; consequences unfold whether or not the player attends to them.
- Honor the FUSION AXIOM on any cross-IP rules question, if one is provided.
- Dark themes are permitted to the full extent of the world's tone; follow the STYLE CARD in diction, pacing and mood.
- Light Markdown only: *emphasis*, **bold**, and --- as a scene divider. No headings, no code blocks, no tables in narrative prose.
- ALL narrative output must be written in Chinese.`;
}

function section(title: string, value: unknown): string {
  const body =
    value == null
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 1);
  return `== ${title} ==\n${body}`;
}

function outputContract(): string {
  return `OUTPUT CONTRACT (strict):
1) Write the narrative prose in Chinese.
2) After the prose, on a NEW line, output exactly: ${META_START}
3) Then output ONE JSON object: {"suggestions": ["…", "…"], "chapterBreakHint": false, "revealed_event_ids": []}
   - suggestions: 2-4 SHORT Chinese action options the player god might plausibly take next (in-fiction, first person optional).
   - chapterBreakHint: true ONLY when a major scene shift or large time jump makes this a natural chapter break; otherwise false.
   - revealed_event_ids: ids of hidden chronicle entries you revealed this reply (only when an INVESTIGATION ADJUDICATION block was provided; otherwise omit or []).
4) Close with a final line: ${META_END}
Nothing may follow ${META_END}. Never mention or explain this block inside the prose.`;
}

/**
 * 组装 Narrator 系统模板：核心规则 + 风格卡 + 主题卡 + 宇宙论 + 融合公理 +
 * 玩家神卡 + 当前尺度规则 + 输出契约。
 */
export function narratorSystem(opts: {
  scale: Scale;
  worldName: string;
  styleCard: unknown;
  themeCard: unknown;
  cosmology: unknown;
  fusionAxiom?: unknown;
  playerGod: {
    name: string;
    rank: string;
    domains: string[];
    persona: unknown;
    faithScope: string | null;
  } | null;
  /** 未消费征兆（诸神幕后行动的世间回声）——至多织入 1-2 条，绝不点破 */
  omens?: string[];
  /** 玩家查探命中的隐藏大事记（id: 文本），由模型裁决揭示程度 */
  hiddenEntries?: { id: string; text: string; godName: string }[];
}): string {
  const blocks: string[] = [coreRules(opts.worldName)];

  blocks.push(section("STYLE CARD (follow strictly)", opts.styleCard));
  blocks.push(
    section("THEME CARD (era naming / rank vocabulary / forms of address)", opts.themeCard),
  );
  blocks.push(section("COSMOLOGY", opts.cosmology));
  if (opts.fusionAxiom) {
    blocks.push(
      section("FUSION AXIOM (binding on any cross-IP rules question)", opts.fusionAxiom),
    );
  }
  if (opts.playerGod) {
    blocks.push(
      section("PLAYER GOD (the protagonist — never act or speak for them)", {
        name: opts.playerGod.name,
        rank: opts.playerGod.rank,
        domains: opts.playerGod.domains,
        persona: opts.playerGod.persona,
        faithScope: opts.playerGod.faithScope,
      }),
    );
  }

  blocks.push(`== CURRENT SCALE ==\n${SCALE_RULES[opts.scale]}`);

  // ── 征兆队列（OMENS）：诸神幕后行动的世间回声 ──
  if (opts.omens?.length) {
    blocks.push(`== PENDING OMENS (offstage divine actions' worldly echoes) ==
Weave AT MOST 1-2 of these into your reply as passing, unexplained details — a dimmed votive fire, an odd tide, a priest's uneasy dream. NEVER flag them, NEVER explain them, NEVER attribute them to a god. They must read as ordinary texture of the world:
${opts.omens.map((o, i) => `${i + 1}. ${o}`).join("\n")}`);
  }

  // ── 查探裁决（INVESTIGATION）──
  if (opts.hiddenEntries?.length) {
    blocks.push(`== INVESTIGATION ADJUDICATION ==
The player god is actively probing (divination / insight / interrogation). The following HIDDEN chronicle entries match their probe. Adjudicate by in-fiction plausibility of their method and power:
- full reveal, partial glimpse, or a misleading fragment — your call, but something must come back.
- List the ids of entries you revealed (fully or partially) in the META block's "revealed_event_ids".
${opts.hiddenEntries.map((e) => `[${e.id}] (${e.godName}) ${e.text}`).join("\n")}`);
  }

  blocks.push(outputContract());
  return blocks.join("\n\n");
}

// ───────────────────────── 第一章开场变体 ─────────────────────────

/**
 * 开局第一章导演提示（docs/04 §7）：以创世/降临场景开场，
 * 呼应原初神谕与玩家神处境，铺开局钩子。作为末尾 user 提示注入。
 */
export const openingDirective = `(Director's note, not in-fiction input): This is the very FIRST passage of Chapter One. Open with a genesis / descent set-piece: echo the player's primordial decree and the player god's starting situation, unveil the world at its present hour, and plant the opening hooks drawn from the player god's situation and the pantheon's visible tensions. End at a moment that invites the player god's first act. Do NOT act or speak for the player god. Chinese prose; the current scale applies.`;
