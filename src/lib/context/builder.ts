import { prisma } from "@/lib/db";
import type { ChatMessage } from "@/lib/llm/types";
import type { Scale } from "@/lib/cards/schemas";
import { WorldModeSchema, type WorldMode } from "@/lib/world-mode";
import { ObserverStateSchema, RealityStateSchema } from "@/lib/reality/schemas";
import { narratorGlobalSystem, narratorTurnSystem, narratorWorldSystem, openingDirective } from "@/lib/prompts/narrator";
import { buildAbilityContext } from "@/lib/abilities/context";
import { buildWorldActivityContext } from "@/lib/world-activity/context";

/**
 * Context Builder v1（docs/04 §2 组装顺序的 M1 裁剪版）：
 *   system(narrator 模板+核心卡组) → system(主神卡片集) → system(世界书命中)
 *   → user(正文窗口 + 本轮输入/导演提示/开场提示)
 * M2 再补：在场实体卡、编年史、征兆队列、查探裁决注入。
 */

const LOREBOOK_BUDGET = 4000; // 世界书命中条目预算（字符）
const WINDOW_BUDGET = 12000; // 正文窗口预算（字符），超出从最旧裁剪
const RECENT_FOR_LORE = 6; // 参与世界书匹配的最近消息条数
const CREATOR_HIDDEN_CHRONICLE_LIMIT = 30; // creator 模式作者视角隐藏编年史注入上限（条）

export type NarratorMode = "say" | "continue" | "opening";

export type BuildOpts = {
  worldId: string;
  chapterId: string;
  playerInput?: string;
  scale: Scale;
  mode: NarratorMode;
  /** continue 模式的幕后导演提示（可空） */
  directive?: string;
  /**
   * 只取该 index 之前的消息作为窗口（用于「另掷异文」：
   * 剔除目标消息及其后的一切）。缺省取当前章全部。
   */
  beforeIndex?: number;
};

export type NarratorContext = ChatMessage[] & {
  allowedEventIds: string[];
  /** 本轮注入的征兆 id；由 finalize 在叙事成功落库后标记消费 */
  consumedOmenIds: string[];
};

/** 议程绝不注入 schemes——仅把 stanceToPlayer.level 译为一句外显倾向 */
const STANCE_HINTS: Record<string, string> = {
  hostility: "言行间对玩家神怀有难掩的敌意",
  rivalry: "视玩家神为需要较量的对手",
  neutral: "对玩家神暂持观望与平常心",
  cooperation: "倾向与玩家神合作互利",
  dependence: "在某种程度上有求于、或依附于玩家神",
};

function stanceHint(agenda: unknown): string | null {
  if (!agenda || typeof agenda !== "object") return null;
  const stance = (agenda as Record<string, unknown>).stanceToPlayer;
  if (!stance || typeof stance !== "object") return null;
  const level = (stance as Record<string, unknown>).level;
  return typeof level === "string" ? (STANCE_HINTS[level] ?? null) : null;
}

/** 主神卡片集（人格+声纹+关系可见；议程仅给外显倾向一句） */
function godsSystemBlock(
  mode: WorldMode,
  gods: {
    name: string;
    aliases: string[];
    tier: string;
    rank: string;
    domains: string[];
    persona: unknown;
    voice: unknown;
    relations: unknown;
    faithScope: string | null;
    agenda: unknown;
  }[],
): string {
  const majors = gods.filter((g) => g.tier === "major");
  const minors = gods.filter((g) => g.tier === "minor");

  const majorBlocks = majors.map((g) => {
    const hint = stanceHint(g.agenda);
    return [
      `--- ${g.name}${g.aliases.length ? `（${g.aliases.join("、")}）` : ""} ---`,
      `rank: ${g.rank} | domains: ${g.domains.join("、") || "—"} | faith: ${g.faithScope ?? "—"}`,
      `persona: ${JSON.stringify(g.persona)}`,
      `voice (LAW — this god must speak unmistakably in this voice): ${JSON.stringify(g.voice)}`,
      `relations: ${JSON.stringify(g.relations)}`,
      mode === "creator" ? `AUTHOR-ONLY full agenda: ${JSON.stringify(g.agenda)}` : null,
      mode === "pantheon" && hint ? `outward inclination toward the player god: ${hint}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const minorLines = minors.length
    ? `\n\nMINOR GODS (one-line each, may be promoted by the story):\n${minors
        .map((g) => mode === "creator"
          ? `- ${g.name}: rank=${g.rank}; domains=${g.domains.join("、") || "—"}; persona=${JSON.stringify(g.persona)}; voice=${JSON.stringify(g.voice)}; relations=${JSON.stringify(g.relations)}; AUTHOR-ONLY full agenda=${JSON.stringify(g.agenda)}`
          : `- ${g.name}: ${JSON.stringify(g.persona)}`)
        .join("\n")}`
    : "";

  const heading = mode === "creator"
    ? "AUTHOR-ONLY COMPLETE GOD CARDS — full agendas and relations may guide omniscient narration, but are not automatically known by world-internal characters. Voice cards are law."
    : "PANTHEON — the major gods of this world. Their hidden agendas are NOT given to you; portray only what is outwardly visible. Voice cards are law.";
  return `${heading}\n\n${majorBlocks.join("\n\n")}${minorLines}`;
}

/** 世界书命中：对检索文本做 keys 包含匹配，按预算截断 */
function lorebookBlock(
  entries: { keys: string[]; content: string }[],
  searchText: string,
): string | null {
  const hits: string[] = [];
  let used = 0;
  for (const entry of entries) {
    if (!entry.keys.some((k) => k && searchText.includes(k))) continue;
    if (used + entry.content.length > LOREBOOK_BUDGET) {
      const remain = LOREBOOK_BUDGET - used;
      if (remain > 200) {
        hits.push(entry.content.slice(0, remain));
        used = LOREBOOK_BUDGET;
      }
      break;
    }
    hits.push(entry.content);
    used += entry.content.length;
  }
  if (!hits.length) return null;
  return `LOREBOOK (authoritative over your own knowledge on any conflict):\n\n${hits.join("\n---\n")}`;
}

/** 正文窗口：从旧到新拼接；玩家消息带模式前缀；超预算从最旧裁剪 */
function proseWindow(
  messages: { role: string; content: string }[],
  mode: WorldMode,
): string {
  const label = mode === "creator" ? "【创世主意图】" : "【玩家神谕】";
  const lines = messages.map((m) =>
    m.role === "player" ? `${label}${m.content}` : m.content,
  );
  // 从最新往回装，超预算即停 → 等价于从最旧裁剪
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 2;
    if (used + cost > WINDOW_BUDGET && kept.length > 0) break;
    kept.unshift(lines[i]);
    used += cost;
  }
  return kept.join("\n\n");
}

/** 查探语义检测：占卜/洞察/审问/窥探/追查（角色内主动揭雾手段） */
const PROBE_RE =
  /占卜|卜算|窥探|洞察|洞见|审问|拷问|追查|探查|查探|侦查|神览|天眼|推演|感知.{0,6}(真相|幕后|阴谋)|谁在(背后|暗中)/;

/**
 * 租借征兆队列：取未消费的至多 2 条（与 prompt「至多织入 1-2 条」对齐）。
 * 此处不标记消费——由 finalizeNarration 在叙事成功落库后按 id 标记，
 * 生成失败/搁笔/变体重掷不再永久丢失征兆。
 */
async function consumeOmens(
  timelineId: string,
): Promise<{ texts: string[]; ids: string[] }> {
  const omens = await prisma.omenQueue.findMany({
    where: { timelineId, consumed: false },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  return { texts: omens.map((o) => o.text), ids: omens.map((o) => o.id) };
}

/** 查探命中：玩家在查探时，检索隐藏大事记供裁决 */
async function hiddenEntriesForProbe(
  timelineId: string,
  probeText: string,
): Promise<{ id: string; text: string; godName: string }[]> {
  if (!PROBE_RE.test(probeText)) return [];
  const [hidden, gods] = await Promise.all([
    prisma.chronicleEntry.findMany({
      where: { timelineId, revealed: false },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.god.findMany({
      where: { timelineId },
      select: { id: true, name: true },
    }),
  ]);
  if (!hidden.length) return [];
  const godName = new Map(gods.map((g) => [g.id, g.name]));

  // 命中优先：查探文本点名的神/实体相关条目在前，其余按新近度补足
  const named = hidden.filter((h) =>
    h.godIds.some((gid) => {
      const n = godName.get(gid);
      return n && probeText.includes(n);
    }),
  );
  const rest = hidden.filter((h) => !named.includes(h));
  return [...named, ...rest].slice(0, 6).map((h) => ({
    id: h.id,
    text: h.text,
    godName: h.godIds.map((g) => godName.get(g) ?? "?").join("、") || "未知",
  }));
}

/** 实体状态卡注入：在场实体强制 + 命中实体（名字/别名出现在检索文本中） */
async function entityCardsBlock(
  timelineId: string,
  searchText: string,
): Promise<{ block: string | null; subjectIds: string[] }> {
  const entities = await prisma.entity.findMany({
    where: { timelineId },
    include: { sections: true },
  });
  if (!entities.length) return { block: null, subjectIds: [] };

  const present = entities.filter((e) => e.scenePresence);
  const mentioned = entities.filter(
    (e) =>
      !e.scenePresence &&
      [e.name, ...e.aliases].some((n) => n && searchText.includes(n)),
  );

  const BUDGET = 6000;
  let used = 0;
  const blocks: string[] = [];
  // 在场实体全卡 > 命中实体（active 全卡 / dormant 摘要）
  for (const e of [...present, ...mentioned]) {
    const full = e.heat === "active" || e.isChosen;
    const secs = full
      ? e.sections
          .filter((s) => s.revealed)
          .map((s) => {
            const text =
              typeof s.content === "object" && s.content !== null
                ? ((s.content as Record<string, unknown>).text ?? "")
                : "";
            return `  ${s.key}: ${text}`;
          })
          .join("\n")
      : "";
    const card = `--- ${e.name} [${e.id}] (${e.type})${e.isChosen ? "【神选者】" : ""}${e.scenePresence ? "【在场】" : ""} ---\n${e.summary}${secs ? `\n${secs}` : ""}`;
    if (used + card.length > BUDGET) break;
    blocks.push(card);
    used += card.length;
  }
  return {
    block: blocks.length
      ? `CODEX CARDS (established facts — stay consistent; chosen ones' fates matter):\n\n${blocks.join("\n\n")}`
      : null,
    subjectIds: [...new Set([...present, ...mentioned].map((entity) => entity.id))],
  };
}

/** 相关编年史注入：命中实体的近期已揭示条目 */
async function chronicleBlock(
  timelineId: string,
  searchText: string,
): Promise<string | null> {
  const entries = await prisma.chronicleEntry.findMany({
    where: { timelineId, revealed: true },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  if (!entries.length) return null;
  const entities = await prisma.entity.findMany({
    where: { timelineId },
    select: { id: true, name: true, aliases: true },
  });
  const hitIds = new Set(
    entities
      .filter((e) => [e.name, ...e.aliases].some((n) => n && searchText.includes(n)))
      .map((e) => e.id),
  );
  const related = entries
    .filter((c) => c.entityIds.some((id) => hitIds.has(id)))
    .slice(0, 8);
  // 兜底：最近 4 条全局编年史保证时间连续感
  const recent = entries.slice(0, 4);
  const merged = [...new Map([...related, ...recent].map((c) => [c.id, c])).values()];
  if (!merged.length) return null;
  return `CHRONICLE (what history records so far):\n${merged
    .map((c) => c.yearLabel ? `[${c.yearLabel}] ${c.text}` : c.text)
    .join("\n")}`;
}

export async function buildNarratorContext(opts: BuildOpts): Promise<NarratorContext> {
  const world = await prisma.world.findUnique({
    where: { id: opts.worldId },
    include: { lorebookEntries: { where: { enabled: true } } },
  });
  if (!world) throw new Error("世界不存在");

  const chapter = await prisma.chapter.findUnique({
    where: { id: opts.chapterId },
    include: {
      timeline: { select: { id: true, realityState: true, observerState: true } },
      messages: {
        orderBy: { index: "asc" },
        ...(opts.beforeIndex !== undefined
          ? { where: { index: { lt: opts.beforeIndex } } }
          : {}),
      },
    },
  });
  if (!chapter) throw new Error("内部记录段不存在");
  const mode = WorldModeSchema.parse(world.mode);
  if (chapter.timelineId !== world.activeTimelineId) throw new Error("该现实已被冻结");

  const parsedReality = RealityStateSchema.safeParse(chapter.timeline.realityState);
  const parsedObserver = ObserverStateSchema.safeParse(chapter.timeline.observerState);
  if (mode === "creator" && (!parsedReality.success || !parsedObserver.success)) {
    throw new Error("创世主现实状态无效");
  }
  const reality = parsedReality.success ? parsedReality.data : null;
  const observer = parsedObserver.success ? parsedObserver.data : null;

  // 上一章末 3 条
  const prevChapter = await prisma.chapter.findUnique({
    where: {
      timelineId_index: { timelineId: chapter.timelineId, index: chapter.index - 1 },
    },
    include: { messages: { orderBy: { index: "desc" }, take: 3 } },
  });
  const prevTail = (prevChapter?.messages ?? []).reverse();

  const gods = await prisma.god.findMany({
    where: { timelineId: chapter.timelineId },
    orderBy: { createdAt: "asc" },
  });
  const playerGod = gods.find((g) => g.isPlayer) ?? null;

  // ── 征兆消费 + 查探检测 ──
  const probeText = opts.playerInput ?? "";
  const [omens, hiddenEntries] = mode === "creator"
    ? await Promise.all([
        Promise.resolve({ texts: [] as string[], ids: [] as string[] }),
        prisma.chronicleEntry.findMany({
          where: { timelineId: chapter.timelineId, revealed: false },
          orderBy: { createdAt: "desc" },
          take: CREATOR_HIDDEN_CHRONICLE_LIMIT,
        }),
      ])
    : await Promise.all([
        consumeOmens(chapter.timelineId),
        hiddenEntriesForProbe(chapter.timelineId, probeText),
      ]);

  // ── Stable cache prefix: global rules, then world-specific cards. ──
  const globalSystem = narratorGlobalSystem(mode);
  const worldSystem = narratorWorldSystem({
    mode,
    worldName: world.name,
    styleCard: reality?.style ?? world.styleCard,
    themeCard: reality?.theme ?? world.themeCard,
    cosmology: reality?.cosmology ?? world.cosmology,
    fusionAxiom: reality ? reality.fusionAxiom ?? undefined : world.fusionAxiom ?? undefined,
    playerGod: mode === "pantheon" && playerGod
      ? {
          name: playerGod.name,
          rank: playerGod.rank,
          domains: playerGod.domains,
          persona: playerGod.persona,
          faithScope: playerGod.faithScope,
        }
      : null,
    gods: godsSystemBlock(mode, gods.filter((god) => !god.isPlayer)),
  });
  const turnSystem = narratorTurnSystem({
    mode,
    scale: opts.scale,
    playerInput: opts.playerInput,
    temporal: {
      era: reality?.currentEra
        ?? ((world.draftDeck && typeof world.draftDeck === "object"
          ? (world.draftDeck as { epochConflict?: { epochName?: string } }).epochConflict?.epochName
          : undefined) || "未名纪元"),
      time: observer?.timeLabel
        ?? ((world.draftDeck && typeof world.draftDeck === "object"
          ? (world.draftDeck as { epochConflict?: { yearLabel?: string } }).epochConflict?.yearLabel
          : undefined) || "此刻"),
    },
    omens: omens.texts,
    hiddenEntries: mode === "pantheon"
      ? hiddenEntries.map((entry) => ({ id: entry.id, text: entry.text, godName: "godName" in entry ? entry.godName : "未知" }))
      : undefined,
  });
  const realityBlock = reality
    ? `== ACTIVE REALITY STATE (authoritative over world cards) ==
${JSON.stringify(reality, null, 1)}`
    : null;
  const observerBlock = observer
    ? `== OBSERVER STATE ==
${JSON.stringify(observer, null, 1)}`
    : null;
  const creatorHiddenChronicle = mode === "creator" && hiddenEntries.length
    ? `== AUTHOR-ONLY HIDDEN CHRONICLE ==
These events are available to omniscient narration but are not automatically known by world-internal characters:
${hiddenEntries.map((entry) => `[${entry.id}] ${entry.text}`).join("\n")}`
    : null;

  // ── 检索文本（world书/实体卡/编年史共用） ──
  const windowMessages = [...prevTail, ...chapter.messages];
  const searchText = [
    opts.playerInput ?? "",
    ...windowMessages.slice(-RECENT_FOR_LORE).map((m) => m.content),
  ].join("\n");

  // ── system 3：世界书 + 实体状态卡 + 相关编年史 ──
  const lore = lorebookBlock(world.lorebookEntries, searchText);
  const [entityCards, chronicle, abilityContext] = await Promise.all([
    entityCardsBlock(chapter.timelineId, searchText),
    chronicleBlock(chapter.timelineId, searchText),
    buildAbilityContext({
      timelineId: chapter.timelineId,
      viewer: mode === "creator" ? "creator_author" : "narrator",
      searchText,
    }),
  ]);
  const worldActivityContext = await buildWorldActivityContext({
    timelineId: chapter.timelineId,
    mode,
    viewpoint: observer?.viewpoint ?? (mode === "creator" ? "omniscient" : "limited"),
    focusedEventId: observer?.focusedEventId ?? null,
    currentSubjectIds: entityCards.subjectIds,
  });
  const worldActivityBlock = worldActivityContext.events.length
    || worldActivityContext.activities.length
    || worldActivityContext.focusedEventId
    ? `CURRENT WORLD ACTIVITY\n${JSON.stringify(worldActivityContext)}`
    : null;

  // ── 正文窗口 + 本轮输入，拼成单条 user（防中转站丢多轮） ──
  const windowText = proseWindow(windowMessages, mode);
  const parts: string[] = [];
  if (windowText) {
    parts.push(`[Story so far — oldest to newest]\n\n${windowText}`);
  }
  if (opts.mode === "say") {
    parts.push(`${mode === "creator" ? "【创世主意图】" : "【玩家神谕】"}${opts.playerInput ?? ""}`);
  } else if (opts.mode === "continue") {
    parts.push(
      `(幕后导演提示，不作为剧情输入): ${opts.directive?.trim() || "继续叙事，顺势推进；换一个切入视点或感官开场，不沿用上一轮的开头句式、收束句式与标志性比喻。"}`,
    );
  } else {
    parts.push(openingDirective(mode));
  }

  const messages: ChatMessage[] = [
    { role: "system", content: globalSystem, cacheScope: "global" },
    { role: "system", content: worldSystem, cacheScope: "world" },
    { role: "system", content: turnSystem, cacheScope: "dynamic" },
  ];
  if (realityBlock) messages.push({ role: "system", content: realityBlock, cacheScope: "dynamic" });
  if (observerBlock) messages.push({ role: "system", content: observerBlock, cacheScope: "dynamic" });
  if (creatorHiddenChronicle) messages.push({ role: "system", content: creatorHiddenChronicle, cacheScope: "dynamic" });
  if (entityCards.block) messages.push({ role: "system", content: entityCards.block, cacheScope: "dynamic" });
  if (worldActivityBlock) messages.push({ role: "system", content: worldActivityBlock, cacheScope: "dynamic" });
  messages.push({ role: "system", content: abilityContext, cacheScope: "dynamic" });
  if (lore) messages.push({ role: "system", content: lore, cacheScope: "dynamic" });
  if (chronicle) messages.push({ role: "system", content: chronicle, cacheScope: "dynamic" });
  messages.push({ role: "user", content: parts.join("\n\n"), cacheScope: "dynamic" });
  return Object.assign(messages, {
    allowedEventIds: [...worldActivityContext.actionableEventIds],
    consumedOmenIds: omens.ids,
  });
}
