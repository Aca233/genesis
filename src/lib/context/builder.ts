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
const REENTRY_ABSENCE_MS = 12 * 60 * 60 * 1000; // 离席重入阈值：现实时间离席 ≥ 12 小时

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
  /占卜|卜算|窥探|洞察|洞见|审问|拷问|盘问|追查|探查|查探|侦查|细察|审视|探明|勘破|回溯|神览|天眼|推演|查看.{0,8}(记忆|真相|秘密|过往|痕迹)|感知.{0,6}(真相|幕后|阴谋)|追问.{0,6}真相|谁在(背后|暗中)|何人所为/;

/**
 * 租借征兆队列：至多 1 条 proactive（FIFO）+ 至多 2 条普通征兆（与 prompt
 * 「至多织入 1-2 条」对齐），仍由 finalize 两阶段消费。
 * 此处不标记消费——由 finalizeNarration 在叙事成功落库后按 id 标记，
 * 生成失败/搁笔/变体重掷不再永久丢失征兆，主动事件下轮自动重试登台。
 */
async function consumeOmens(
  timelineId: string,
  resolveGodName: (id: string) => string | undefined,
): Promise<{
  texts: string[];
  ids: string[];
  proactive: { godName: string; text: string } | null;
}> {
  const [proactiveRow, omens] = await Promise.all([
    prisma.omenQueue.findFirst({
      where: { timelineId, consumed: false, kind: "proactive" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.omenQueue.findMany({
      where: { timelineId, consumed: false, kind: "omen" },
      orderBy: { createdAt: "asc" },
      take: 2,
    }),
  ]);
  return {
    texts: omens.map((o) => o.text),
    ids: [...omens.map((o) => o.id), ...(proactiveRow ? [proactiveRow.id] : [])],
    proactive: proactiveRow
      ? {
          godName: resolveGodName(proactiveRow.godId) ?? "未知神明",
          text: proactiveRow.text,
        }
      : null,
  };
}

/**
 * 查探命中：查探门开启时（本轮输入命中查探语义，或上一条叙事 META 自报
 * probe_attempted）检索隐藏大事记供裁决；点名优先逻辑仍使用 probeText。
 */
async function hiddenEntriesForProbe(
  timelineId: string,
  probeText: string,
  active: boolean,
): Promise<{ id: string; text: string; godName: string }[]> {
  if (!active) return [];
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

  // 关系行：仅当上下文内存在 character 实体才查询
  // （EntityRelation 仅有 character 源写入路径，见 settle pipeline 的 upsert）
  const contextIds = new Set([...present, ...mentioned].map((e) => e.id));
  const hasCharacter = [...present, ...mentioned].some((e) => e.type === "character");
  const relations = hasCharacter
    ? await prisma.entityRelation.findMany({
        where: { timelineId, sourceEntityId: { in: [...contextIds] } },
        select: { sourceEntityId: true, targetEntityId: true, label: true, note: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
      })
    : [];
  const nameById = new Map(entities.map((e) => [e.id, e.name]));

  const BUDGET = 6000;
  const REL_BUDGET = 600; // 关系行全局字符预算：累计超出后后续卡不再附关系行
  let used = 0;
  let relUsed = 0;
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
    let relLine = "";
    if (e.type === "character" && relUsed <= REL_BUDGET) {
      // 仅限当前上下文内实体之间的关系；每实体至多 4 条，note 截 40 字
      const rows = relations
        .filter((r) => r.sourceEntityId === e.id && contextIds.has(r.targetEntityId))
        .slice(0, 4);
      if (rows.length) {
        const joined = rows
          .map((r) => `→(${r.label}) ${nameById.get(r.targetEntityId) ?? "?"}：${r.note.slice(0, 40)}`)
          .join("；");
        relLine = `\nrelations: ${joined}`;
        relUsed += joined.length;
      }
    }
    const card = `--- ${e.name} [${e.id}] (${e.type})${e.isChosen ? "【神选者】" : ""}${e.scenePresence ? "【在场】" : ""} ---\n${e.summary}${secs ? `\n${secs}` : ""}${relLine}`;
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

/** 相关编年史注入：纪元总纲常驻 + 命中实体相关条目优先 + 近期条目兜底 */
async function chronicleBlock(
  timelineId: string,
  searchText: string,
): Promise<string | null> {
  // 实体名索引先行：候选名过滤为长度 ≥ 2（一字别名防误命中）
  const entities = await prisma.entity.findMany({
    where: { timelineId },
    select: { id: true, name: true, aliases: true },
  });
  const hitIds = new Set(
    entities
      .filter((e) =>
        [e.name, ...e.aliases].some((n) => n && n.length >= 2 && searchText.includes(n)),
      )
      .map((e) => e.id),
  );
  const [related, recent, digests] = await Promise.all([
    hitIds.size
      ? prisma.chronicleEntry.findMany({
          where: {
            timelineId,
            revealed: true,
            source: { not: "era_digest" },
            entityIds: { hasSome: [...hitIds] },
          },
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      : Promise.resolve([]),
    // 兜底：最近 4 条全局编年史保证时间连续感
    prisma.chronicleEntry.findMany({
      where: { timelineId, revealed: true, source: { not: "era_digest" } },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    // 纪元总纲常驻：入库端已限单条 600 字内、此处上限 20 条，无需再截断
    prisma.chronicleEntry.findMany({
      where: { timelineId, source: "era_digest" },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);
  const merged = [...new Map([...related, ...recent].map((c) => [c.id, c])).values()];
  if (!merged.length && !digests.length) return null;
  const line = (c: { yearLabel: string; text: string }) =>
    c.yearLabel ? `[${c.yearLabel}] ${c.text}` : c.text;
  if (!digests.length) {
    return `CHRONICLE (what history records so far):\n${merged.map(line).join("\n")}`;
  }
  return `CHRONICLE (what history records so far):\nERA DIGESTS (one line per closed era, oldest first — binding long-memory):\n${digests
    .map(line)
    .join("\n")}\nRECENT & RELATED ENTRIES:\n${merged.length ? merged.map(line).join("\n") : "—"}`;
}

/**
 * 「离席之间」重入导演块。
 *
 * 纯函数、无副作用——故意如此导出，以便 world-director 内核在运行时切换
 * （runtime cutover）后可以直接重挂此函数。
 *
 * 线索完全由既有 OmenQueue / WorldEvent 数据逐字派生（pantheon：本轮已租借的
 * 未消费征兆原文；creator：活跃世界事件标题），不新增 LLM 调用、也没有
 * completeStructured 任务：可发展线索本就逐字可得，LLM 摘要器只会为零信息
 * 增益付出额外时延。
 */
export function buildReentryBlock(input: {
  mode: WorldMode;
  absenceMs: number;
  threads: string[];
}): string | null {
  if (input.absenceMs < REENTRY_ABSENCE_MS) return null;
  const absenceLabel = input.absenceMs >= 48 * 60 * 60 * 1000
    ? `约 ${Math.round(input.absenceMs / (24 * 60 * 60 * 1000))} 天`
    : `约 ${Math.round(input.absenceMs / (60 * 60 * 1000))} 小时`;
  const threads = input.threads.slice(0, 2);
  const threadSection = threads.length
    ? threads.map((thread) => `- ${thread}`).join("\n")
    : "No specific thread is supplied — invent one small, concrete offstage development consistent with CURRENT WORLD ACTIVITY.";
  return `== RE-ENTRY AFTER ABSENCE ==
The player returns after a real-world absence of ${absenceLabel}. Open this reply from the world's own motion: in-fiction time has visibly passed, and the threads below have quietly developed while no one was watching. Never explain or acknowledge the pause; let changed details, aged consequences and moved pieces show it.
${threadSection}`;
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

  // ── PREVIOUSLY 前情回注：既往检查点的史官小结（结算无差别写入 chapter.summary）──
  const recapChapters = await prisma.chapter.findMany({
    where: {
      timelineId: chapter.timelineId,
      index: { lt: chapter.index },
      summary: { not: null },
    },
    orderBy: { index: "desc" },
    take: 3,
    select: { index: true, summary: true },
  });
  const previouslyBlock = recapChapters.length
    ? `== PREVIOUSLY (chronicler's recaps of earlier checkpoints, oldest to newest) ==\n${recapChapters
        .reverse()
        .map((c) => (c.summary ?? "").slice(0, 400))
        .join("\n")}`
    : null;

  const gods = await prisma.god.findMany({
    where: { timelineId: chapter.timelineId },
    orderBy: { createdAt: "asc" },
  });
  const playerGod = gods.find((g) => g.isPlayer) ?? null;

  // ── 征兆消费 + 查探检测 ──
  const probeText = opts.playerInput ?? "";
  // 查探双门：本轮输入命中查探语义，或上一条叙事 META 自报 probe_attempted
  // （由 narrator 输出、finalize 落库）。carry 只看最后一条 narrator 消息——
  // 下一条叙事落库后自然熄灭，无需额外守卫；chapter.messages 已按 beforeIndex
  // 过滤，变体重掷语义自动正确。
  const lastNarrator = [...chapter.messages].reverse().find((m) => m.role === "narrator");
  const lm = lastNarrator?.meta;
  const probeCarry = !!(
    lm
    && typeof lm === "object"
    && !Array.isArray(lm)
    && (lm as Record<string, unknown>).probeAttempted === true
  );
  const probeActive = PROBE_RE.test(probeText) || probeCarry;
  const [omens, hiddenEntries] = mode === "creator"
    ? await Promise.all([
        Promise.resolve({
          texts: [] as string[],
          ids: [] as string[],
          proactive: null as { godName: string; text: string } | null,
        }),
        prisma.chronicleEntry.findMany({
          where: { timelineId: chapter.timelineId, revealed: false },
          orderBy: { createdAt: "desc" },
          take: CREATOR_HIDDEN_CHRONICLE_LIMIT,
        }),
      ])
    : await Promise.all([
        consumeOmens(chapter.timelineId, (id) => gods.find((g) => g.id === id)?.name),
        hiddenEntriesForProbe(chapter.timelineId, probeText, probeActive),
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
  // ── 时间锚点契约（时间一致设计稿 §12）──
  // 新契约世界（realityState 携带 anchorOrdinal，或创世卡组携带 temporalAnchor）
  // 禁用「未名纪元/此刻」回退：叙事时间必须来自现实/观察状态本身，缺失即失败。
  // 锚点展示数据（anchorEvent/canonCutoff）取自创世卡组的时间锚点卡（创世期静态数据）。
  const deckAnchor = world.draftDeck && typeof world.draftDeck === "object"
    ? (world.draftDeck as {
        temporalAnchor?: { anchor?: { anchorEvent?: unknown; canonCutoff?: unknown } };
      }).temporalAnchor?.anchor
    : undefined;
  const temporalContractActive = reality?.anchorOrdinal !== undefined || deckAnchor !== undefined;
  let temporalEra: string;
  let temporalTime: string;
  if (temporalContractActive) {
    if (!reality?.currentEra) {
      throw new Error("新契约世界的现实状态缺少 currentEra：叙事时间回退已禁用，请检查开局物化或现实分叉数据");
    }
    if (!observer?.timeLabel) {
      throw new Error("新契约世界的观察状态缺少 timeLabel：叙事时间回退已禁用，请检查开局物化或现实分叉数据");
    }
    temporalEra = reality.currentEra;
    temporalTime = observer.timeLabel;
  } else {
    temporalEra = reality?.currentEra
      ?? ((world.draftDeck && typeof world.draftDeck === "object"
        ? (world.draftDeck as { epochConflict?: { epochName?: string } }).epochConflict?.epochName
        : undefined) || "未名纪元");
    temporalTime = observer?.timeLabel
      ?? ((world.draftDeck && typeof world.draftDeck === "object"
        ? (world.draftDeck as { epochConflict?: { yearLabel?: string } }).epochConflict?.yearLabel
        : undefined) || "此刻");
  }
  const turnSystem = narratorTurnSystem({
    mode,
    scale: opts.scale,
    playerInput: opts.playerInput,
    temporal: {
      era: temporalEra,
      time: temporalTime,
      ...(typeof deckAnchor?.anchorEvent === "string" && deckAnchor.anchorEvent.trim()
        ? { anchorEvent: deckAnchor.anchorEvent.trim() }
        : {}),
      ...(typeof deckAnchor?.canonCutoff === "string" && deckAnchor.canonCutoff.trim()
        ? { canonCutoff: deckAnchor.canonCutoff.trim() }
        : {}),
    },
    playerGodRank: mode === "pantheon" ? playerGod?.rank : undefined,
    omens: omens.texts,
    proactiveEvent: omens.proactive ?? undefined,
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
      `(幕后导演提示，不作为剧情输入): ${opts.directive?.trim() || "继续叙事，顺势推进。"}`,
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
  if (previouslyBlock) messages.push({ role: "system", content: previouslyBlock, cacheScope: "dynamic" });
  if (chronicle) messages.push({ role: "system", content: chronicle, cacheScope: "dynamic" });
  messages.push({ role: "user", content: parts.join("\n\n"), cacheScope: "dynamic" });
  return Object.assign(messages, {
    allowedEventIds: [...worldActivityContext.actionableEventIds],
    consumedOmenIds: omens.ids,
  });
}
