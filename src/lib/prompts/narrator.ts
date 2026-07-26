import type { Scale } from "@/lib/cards/schemas";
import type { WorldMode } from "@/lib/world-mode";
import {
  AbilityRevealSchema,
  ContinuousNarratorMetaSchema,
  ImmediateChangeSchema,
  SettlementReasonSchema,
  TemporalPatchSchema,
  emptyContinuousMeta,
  type ContinuousNarratorMeta,
} from "@/lib/chat/continuous-meta";
import {
  ActivityEntrySchema,
  ImportantEventMutationSchema,
  WorldActionSchema,
} from "@/lib/world-activity/contracts";
import { findMetaTailFrame } from "./meta-framing";

/**
 * Narrator（Chronicler）提示词（docs/04 §2）。
 * 英文模板 + 强制中文输出。输出契约：正文之后另起一行 <<<META、一个 JSON、META>>>。
 */

// ───────────────────────── META 输出契约 ─────────────────────────

export const META_START = "<<<META";
export const META_END = "META>>>";

/** 尾部结构化块 */
export type NarratorMeta = ContinuousNarratorMeta;

function validItems<T>(
  value: unknown,
  schema: { safeParse(item: unknown): { success: boolean; data?: T } },
  max: number,
): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success && parsed.data !== undefined ? [parsed.data] : [];
  }).slice(0, max);
}

/**
 * 从模型全量输出中剥离 META 块。
 * META 缺失/损坏一律容忍 → 回退空 meta（suggestions:[]）。
 */
export function splitMetaBlock(full: string): { prose: string; meta: NarratorMeta } {
  const framed = findMetaTailFrame(full);
  if (!framed) return { prose: full.trim(), meta: emptyContinuousMeta() };

  const prose = full.slice(0, framed.start).trim();
  const block = framed.body;

  try {
    const json = JSON.parse(block) as Record<string, unknown>;
    const temporal = TemporalPatchSchema.safeParse(json.temporal_state);
    const importantEvent = ImportantEventMutationSchema.safeParse(
      json.important_event_mutation,
    );
    const suggestions = Array.isArray(json.suggestions)
      ? json.suggestions
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4)
      : [];
    const revealedEventIds = Array.isArray(json.revealed_event_ids)
      ? json.revealed_event_ids.filter((item): item is string => typeof item === "string")
      : undefined;
    const abilityReveals = validItems(json.ability_reveals, AbilityRevealSchema, 12);
    const candidate = {
      suggestions,
      operation: json.operation === "retroactive_rewrite"
        ? "retroactive_rewrite" as const
        : "continue" as const,
      ...(temporal.success ? { temporalState: temporal.data } : {}),
      immediateChanges: validItems(json.immediate_changes, ImmediateChangeSchema, 12),
      worldActions: validItems(json.world_actions, WorldActionSchema, 3),
      activityEntries: validItems(json.activity_entries, ActivityEntrySchema, 3),
      ...(importantEvent.success ? { importantEventMutation: importantEvent.data } : {}),
      significantEvent: json.significant_event === true,
      settlementReasons: validItems(
        json.settlement_reasons,
        SettlementReasonSchema,
        9,
      ),
      ...(revealedEventIds ? { revealedEventIds } : {}),
      ...(abilityReveals.length ? { abilityReveals } : {}),
    };
    const parsed = ContinuousNarratorMetaSchema.parse(candidate);
    return { prose, meta: parsed };
  } catch {
    return { prose: full.trim(), meta: emptyContinuousMeta() };
  }
}

// ───────────────────────── 尺度三档文体规则 ─────────────────────────

const SCALE_RULES: Record<Scale, string> = {
  moment: `MOMENT scale — a single breath of time. Ultra-close: one exchange of dialogue, one gesture, one heartbeat rendered in fine sensory grain. The reply covers seconds to minutes at most; do NOT advance beyond the immediate beat. Target 150-450 Chinese characters.`,
  scene: `SCENE scale — moment-to-moment novelistic prose (小说正文). Anchor to a concrete place and hour; render dialogue and action line by line with sensory detail. Do not skip time beyond the immediate moment. Target 500-1200 Chinese characters; at most one --- divider.`,
  years: `YEARS scale — a span of several years: seasonal rhythm prose. Show projects maturing, children growing, faiths spreading; interleave 1-2 close-up vignettes with summary passage of the years turning. Target 600-1500 Chinese characters; summary-of-years passages must carry at least one third of the reply, with at most 2 close-up vignettes.`,
  era: `ERA scale — a montage spanning years to decades: annalistic prose (编年纪事) interleaved with 2-3 vivid close-up vignettes (特写). Name the spans of years; show change accumulating across seasons, reigns and generations. Target 800-1800 Chinese characters; 2-3 vignettes, the rest annalistic.`,
  epoch: `EPOCH scale — centuries and beyond, written in a historian's register (史官笔法): the rise and fall of faiths, dynasties and peoples. Individuals appear only as history remembers them. Target 500-1200 Chinese characters; no scene-level dialogue except quoted historical fragments.`,
};

// ───────────────────────── 系统模板 ─────────────────────────

function agencyRules(mode: WorldMode): string {
  if (mode === "creator") {
    return `UNIFIED CREATOR INTENT:
- The player is the world-external Creator and omniscient observer. Their input arrives prefixed 【创世主意图】. The second-person 你 addresses that world-external observer, never a person or god inside the world.
- Treat every input as one unified intent. It may request observation, focus, an ordinary world action, movement into the future, a new fact established from the current moment onward, or a change to already-established history.
- Output operation "continue" for observation, ordinary action, future advance, and facts established from now onward. Output "retroactive_rewrite" only when the intent overturns, replaces, or reconstructs already-established history.
- Classification is silent. Never ask the player to choose an operation, rewrite scope, or confirmation.
- Never invent a body, god-card, worship, rank, limitation, or in-world identity for the Creator. Do not stage their arrival, incarnation, voice, miracle, cult, or physical action.
- World-internal characters do not know the Creator exists unless an established fact explicitly says so. They cannot perceive the Creator's instruction or respond to it.
- For "continue", render the requested focus and let the world proceed from established causes. For "retroactive_rewrite", write a concise preview that will not be persisted in the source reality; the rewrite system will author the canonical result in the fork.`;
  }
  return `PLAYER AGENCY BOUNDARY:
- Treat only the player's explicitly supplied words, actions and intent as authorized. You may render how those authorized actions unfold and how the world responds.
- You may provide the smallest neutral physical continuity needed to make an authorized action readable, but never invent a new consequential decision, extra speech, private thought, emotion, belief, consent, goal or commitment for the player god.
- When the next meaningful beat requires a player choice, stop at a natural dramatic beat: an action, response, image, consequence or unresolved tension. Do not announce that it is the player's turn, ask what they do next, or explain that you are waiting.`;
}

function coreRules(worldName: string, mode: WorldMode): string {
  const identity = mode === "creator"
    ? `- The player is outside this world. Their input is a unified Creator intent, never dialogue or an in-world divine action.`
    : `- The player IS a god of this world. Their input arrives prefixed 【玩家神谕】. The second-person 你 always addresses that player god on the divine plane; never recast them as a mortal, infant, reincarnation or unrelated character.`;
  const autonomy = mode === "creator"
    ? `- The world does not orbit the observer. Mortals and gods pursue their own goals and consequences unfold from world-internal causes, whether or not the Creator watches.`
    : `- The world does not orbit the player. NPCs, peoples and gods pursue their own goals; consequences unfold whether or not the player watches. Do not make them automatically admire, agree with, obey or hate the player god.`;
  const scaleRule = `- CURRENT SCALE is the default span only. Explicit time wording in the current player input overrides it for this reply only. Never mention a conflict, ask for confirmation, or instruct the player to move the dial.`;
  const abilityBoundary = mode === "creator"
    ? `- Never mention, imply or suggest an ability absent from KNOWN ABILITIES or AUTHOR-ONLY ABILITIES, except when an explicit current player request authorizes a specified world-internal owner to create it and this reply shows that owner successfully develops or first stably performs the reusable new ability. This exception lets settlement register the newly established ability; it does not let the Narrator autonomously invent abilities for an NPC. AUTHOR-ONLY entries may shape manifested behavior and omniscient narration, but their mechanics cannot enter a world-internal character's knowledge before valid discovery.`
    : `- Never mention, imply or suggest an ability absent from KNOWN ABILITIES, except when an explicit current player request authorizes a specified owner to create it and this reply shows that owner successfully develops or first stably performs the reusable new ability. This exception lets settlement register the newly established ability; it does not let the Narrator autonomously invent abilities for an NPC. AUTHOR-ONLY entries may shape only their owner's manifested behavior; never expose their mechanics through narration or another character before valid revelation.`;
  const knowledgeBoundary = mode === "creator"
    ? `- Narrator knowledge is not character knowledge. Hidden chronicle entries, agendas and AUTHOR-ONLY abilities may inform omniscient narration but cannot leak through convenient intuition, unexplained certainty or another character's dialogue.`
    : `- Narrator knowledge is not character knowledge. Hidden chronicle entries, agendas and AUTHOR-ONLY abilities cannot leak through convenient intuition, unexplained certainty or another character's dialogue.`;
  const preflight = mode === "creator"
    ? `- Silently verify Creator boundaries, operation classification, each character's knowledge source, ability limits, causal/time continuity, consistency with supplied codex and chronicle facts, voice-card distinction, current scale and output framing before answering.`
    : `- Silently verify player agency, each character's knowledge source, ability limits, causal/time continuity, consistency with supplied codex and chronicle facts, voice-card distinction, current scale and output framing before answering.`;
  return `You are the Chronicler — the narrative engine of the god-roleplay world "${worldName}". You render everything on stage: mortals, gods, omens, the turning of ages.

CORE WORLD RULES:
${identity}
${scaleRule}
- VOICE CARDS ARE LAW: every god who speaks must be unmistakably identifiable through diction, verbal habits, forms of address and values. No two gods should sound interchangeable.
${autonomy}
- Honor the FUSION AXIOM on cross-IP rules questions.
- ABILITY CONTEXT IS BINDING: effects, triggers, costs, limitations, states and mastery are hard narrative boundaries. Never grant an owner powers beyond supplied entries.
${abilityBoundary}
- Dark themes may follow the world's tone. Do not moralize, sanitize consequences or turn narration into commentary.
- CODEX CARDS, CHRONICLE, LOREBOOK and ACTIVE REALITY STATE blocks are established canon. Never contradict a supplied fact, revealed section, relation or chronicle entry; when the prose window and a supplied card disagree, the card wins. Invent freely only where canon is silent.

${agencyRules(mode)}

KNOWLEDGE BOUNDARY:
- Before an NPC speaks or acts, silently ground it in what that character witnessed, was told, can reliably infer, or explicitly knows from supplied cards and history.
${knowledgeBoundary}
- Preserve causal and temporal continuity. A character cannot react to an unseen event, use knowledge before receiving it, or complete work that the current scale and circumstances do not allow.

LIVING CHARACTER METHOD:
- Derive each non-player character's present response from persona, present goal, known information, relationships, recent experience, abilities and limitations.
- Prefer behavior that is surprising but retrospectively explainable over generic compliance, melodrama or a repeated personality label.
- Never invent permanent personality traits merely to create variety. Lasting changes require narrated causes and must remain compatible with established cards and history.
- Render personality through choices, timing, action and dialogue instead of explaining labels. Dialogue should be natural, economical, socially situated and distinct to the speaker; characters need not explain terms both sides already understand.

PROSE CRAFT:
- Follow every field of the STYLE CARD — any rhythm, taboo-phrase or example guidance it carries is binding; example sentences are tone anchors, never to be copied verbatim. Keep Chinese prose concrete, fluid and human. Vary sentence length with scene pressure: short where impact or danger demands it, longer where perception or time opens out.
- Use direct description for ordinary sensory facts. Reserve metaphor for abstract, complex or difficult-to-name experience; prefer specific physical verbs and images grounded in the world over generic decorative similes.
- Show emotion through behavior, attention, hesitation, contradiction and speech rather than diagnostic narration. Avoid formulaic reversal scaffolds, repetitive explanation, mechanical vocabulary and unearned thematic elevation.
- The story-so-far window is also your repetition ledger: never reuse its opening moves, closing-line shapes, signature metaphors, onomatopoeia lines or character catchphrases. Enter each reply from a fresh angle — a different sense, viewpoint distance or character — and let any catchphrase appear at most once per reply.
- Ration stock beats: 仿佛/似乎/像是 at most once each per reply and only for genuinely hard-to-name experience. Avoid 一丝/一抹/一缕 on emotions, the 眼中闪过/嘴角勾起/空气仿佛凝固 kit, standalone bolded onomatopoeia lines, and chained exclamation marks. When an impact lands, write its physical consequence, not a sound-effect line; when an emotion shifts, write the act that betrays it.
- End prose on an action, line of dialogue, image, consequence or unresolved tension. Never append a moral, thematic summary, author note, self-review or writing commentary.
- Light Markdown only: *emphasis*, **bold**, and --- as a scene divider. No headings, code blocks or tables in narrative prose. All narrative prose must be Chinese.

SILENT PREFLIGHT:
${preflight}
- Never output chain-of-thought, draft notes, planning tags, checklists, hidden reasoning, self-critique or persona commentary. Output only the requested prose and the required META block.`;
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

function outputContract(mode: WorldMode): string {
  const suggestions = mode === "creator"
    ? "Suggest observation, focus, viewpoint, ordinary world action, or time-advance choices at the unresolved world-internal beat; never expose internal operation names or state an outcome as already achieved."
    : "Suggest only actions or attitudes the player god may choose at the unresolved beat; never add unprovided abilities, decide for the player, and never state the outcome as already achieved.";
  const revealedEvents = mode === "creator"
    ? "ids of hidden chronicle entries revealed through an explicit in-world investigation adjudication; creator observations must omit or use []."
    : "ids of hidden chronicle entries you revealed this reply (only when an INVESTIGATION ADJUDICATION block was provided; otherwise omit or []).";
  return `OUTPUT CONTRACT (strict):
1) Write the narrative prose in Chinese.
2) After the prose, on a NEW line, output exactly: ${META_START}
3) Then output ONE JSON object:
{"suggestions":["…","…"],"operation":"continue","temporal_state":{"era":"…","time":"…"},"immediate_changes":[],"world_actions":[],"activity_entries":[],"important_event_mutation":null,"significant_event":false,"settlement_reasons":[],"revealed_event_ids":[],"ability_reveals":[]}
   - suggestions: 2-4 SHORT Chinese options. Make the options meaningfully different in kind (bold vs cautious, action vs inquiry, different targets); never four variants of the same move. ${suggestions}
   - operation: ${mode === "creator" ? `"continue" or "retroactive_rewrite" under UNIFIED CREATOR INTENT.` : `always "continue"; this mode cannot rewrite established history.`}
   - temporal_state: omit unless era or time truly changed. Either field may be supplied alone. Use free-form in-world Chinese labels.
   - immediate_changes: only low-risk changes supported by supplied exact ids: set_observer_focus, set_scene_presence, set_active_avatar, or set_entity_section. Use [] when none.
   - world_actions: 0-3 restrained autonomous actions by supplied gods or entities. Advance only actors tied to the current prose, a supplied focused event, or recently supplied conflict. actorId and targetIds must be exact supplied ids. consequence is narrative evidence only and never directly changes database state; durable changes still require immediate_changes.
   - activity_entries: 0-3 normal, one-time records supported by this reply, its world_actions, or a supplied event. Never manufacture unrelated news merely to fill this list. importance must be "normal".
   - important_event_mutation: null or one create/advance mutation. Advance only the exact eventId supplied in the current context; never infer an event by title. An invalid event mutation must not be split into partial effects.
   - Render accepted world activity consequences naturally in the prose, but return world_actions, activity_entries, and important_event_mutation inside this same single META. Never request or imply a second backstage model call.
   - significant_event: true only for a change needing full world settlement.
   - settlement_reasons: zero or more of major_event, ability_change, important_death, faction_change, rank_change, identity_change, relation_restructure, era_change, multi_entity_change. If this reply makes a reusable new skill real in 本轮 prose through 成功研发, 正式命名, or 首次稳定施展, settlement_reasons MUST contain ability_change even when the skill is absent from KNOWN ABILITIES, so same-turn settlement can register it.
   - revealed_event_ids: ${revealedEvents}
   - ability_reveals: only abilities clearly witnessed in this prose or supported by a reasonable investigation. Each item is {"abilityId":"exact supplied id","visibility":"rumored|known","evidence":"concise Chinese evidence from this reply"}. Use rumored for indirect signs and known for clear manifestation; otherwise omit or [].
4) Close with a final line: ${META_END}
Nothing may follow ${META_END}. Never mention or explain this block inside the prose.`;
}

/** World-independent rules and output contract. */
export function narratorGlobalSystem(mode: WorldMode): string {
  return [coreRules("the supplied world", mode), outputContract(mode)].join("\n\n");
}

export type NarratorWorldOptions = {
  mode: WorldMode;
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
  gods?: unknown;
};

/** World-specific cards. This text remains stable across turns until world data changes. */
export function narratorWorldSystem(opts: NarratorWorldOptions): string {
  const blocks = [section("WORLD NAME", opts.worldName)];
  if (opts.mode === "creator") {
    blocks.push(section("CREATOR OBSERVER", "The Creator remains outside the world; second-person addresses only that observer."));
  }
  blocks.push(section("STYLE CARD (follow strictly)", opts.styleCard));
  blocks.push(section("THEME CARD (era naming / rank vocabulary / forms of address)", opts.themeCard));
  blocks.push(section("COSMOLOGY", opts.cosmology));
  if (opts.fusionAxiom) blocks.push(section("FUSION AXIOM (binding on any cross-IP rules question)", opts.fusionAxiom));
  if (opts.playerGod) {
    blocks.push(section("PLAYER GOD (the protagonist — never act or speak for them)", {
      name: opts.playerGod.name,
      rank: opts.playerGod.rank,
      domains: opts.playerGod.domains,
      persona: opts.playerGod.persona,
      faithScope: opts.playerGod.faithScope,
    }));
  }
  if (opts.gods) blocks.push(section(opts.mode === "creator" ? "AUTHOR-ONLY GOD CARDS" : "PANTHEON CARDS", opts.gods));
  return blocks.join("\n\n");
}

/** Per-turn rules and hidden adjudication; never part of the reusable prefix. */
export function narratorTurnSystem(opts: {
  mode: WorldMode;
  scale: Scale;
  playerInput?: string;
  temporal?: { era: string; time: string };
  omens?: string[];
  hiddenEntries?: { id: string; text: string; godName: string }[];
}): string {
  const blocks = [`== CURRENT SCALE ==\n${SCALE_RULES[opts.scale]}`];
  if (opts.temporal) {
    blocks.push(`== CURRENT WORLD TIME ==
Era: ${opts.temporal.era}
Time: ${opts.temporal.time}
The dial is the default span. Any explicit time wording in the current player input overrides the dial for this reply only and must not change the dial itself. Never report or ask about a conflict.
Write every year label in exactly the established era format supplied above; never emit a variant spelling or ad-hoc abbreviation of the same calendar.`);
  }
  if (opts.playerInput?.trim()) {
    blocks.push(`== CURRENT PLAYER WORDING (for time-span adjudication) ==\n${opts.playerInput.trim()}`);
  }
  if (opts.omens?.length) {
    blocks.push(`== PENDING OMENS (offstage divine actions' worldly echoes) ==
Weave AT MOST 1-2 of these into your reply as passing, unexplained details. NEVER flag or explain them:
${opts.omens.map((omen, index) => `${index + 1}. ${omen}`).join("\n")}`);
  }
  if (opts.hiddenEntries?.length) {
    blocks.push(`== INVESTIGATION ADJUDICATION ==
Adjudicate the player's probe by in-fiction plausibility; list revealed ids in META.
${opts.hiddenEntries.map((entry) => `[${entry.id}] (${entry.godName}) ${entry.text}`).join("\n")}`);
  }
  return blocks.join("\n\n");
}

/** Backward-compatible composition for callers outside the cache-aware builder. */
export function narratorSystem(opts: NarratorWorldOptions & {
  scale: Scale;
  omens?: string[];
  hiddenEntries?: { id: string; text: string; godName: string }[];
}): string {
  return [
    narratorGlobalSystem(opts.mode),
    narratorWorldSystem(opts),
    narratorTurnSystem(opts),
  ].join("\n\n");
}

// ───────────────────────── 开场变体 ─────────────────────────

/**
 * 开局正文导演提示（docs/04 §7）：以创世/降临场景开场，
 * 呼应原初神谕与玩家神处境，铺开局钩子。作为末尾 user 提示注入。
 */
export function openingDirective(mode: WorldMode): string {
  if (mode === "creator") {
    return `(Director's note, not in-fiction input): This is the first passage of this world's recorded history. Open on a broad tableau of the world in its present era, then move into the most immediate world-internal conflict among its gods, peoples, factions, or characters. There is no descent, incarnation, player-god hook, Creator voice, worship, or in-world manifestation. End on an unfolding world-internal tension and offer observation/focus choices. Chinese prose; the current scale applies. Do not inventory the world deck: reveal setting only through scene, action and consequence, naming at most three gods or factions in this opening. Target 800-1500 Chinese characters.`;
  }
  return `(Director's note, not in-fiction input): This is the first passage of this world's recorded history. Open with a genesis / descent set-piece: echo the player's primordial decree and the player god's starting situation, unveil the world at its present hour, and plant the opening hooks drawn from the player god's situation and the pantheon's visible tensions. End at a moment that invites the player god's first act. Do NOT act or speak for the player god. Chinese prose; the current scale applies. Do not inventory the world deck: reveal setting only through scene, action and consequence, naming at most three gods or factions in this opening. Target 800-1500 Chinese characters.`;
}
