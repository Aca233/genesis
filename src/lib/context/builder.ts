import { prisma } from "@/lib/db";
import type { ChatMessage } from "@/lib/llm/types";
import type { Scale } from "@/lib/cards/schemas";
import { narratorSystem, openingDirective } from "@/lib/prompts/narrator";

/**
 * Context Builder v1（docs/04 §2 组装顺序的 M1 裁剪版）：
 *   system(narrator 模板+核心卡组) → system(主神卡片集) → system(世界书命中)
 *   → user(正文窗口 + 本轮输入/导演提示/开场提示)
 * M2 再补：在场实体卡、编年史、征兆队列、查探裁决注入。
 */

const LOREBOOK_BUDGET = 4000; // 世界书命中条目预算（字符）
const WINDOW_BUDGET = 12000; // 正文窗口预算（字符），超出从最旧裁剪
const RECENT_FOR_LORE = 6; // 参与世界书匹配的最近消息条数

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
      hint ? `outward inclination toward the player god: ${hint}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const minorLines = minors.length
    ? `\n\nMINOR GODS (one-line each, may be promoted by the story):\n${minors
        .map((g) => `- ${g.name}: ${JSON.stringify(g.persona)}`)
        .join("\n")}`
    : "";

  return `PANTHEON — the major gods of this world. Their hidden agendas are NOT given to you; portray only what is outwardly visible. Voice cards are law.\n\n${majorBlocks.join("\n\n")}${minorLines}`;
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

/** 正文窗口：从旧到新拼接；玩家消息前缀【玩家神谕】；超预算从最旧裁剪 */
function proseWindow(
  messages: { role: string; content: string }[],
): string {
  const lines = messages.map((m) =>
    m.role === "player" ? `【玩家神谕】${m.content}` : m.content,
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

export async function buildNarratorContext(opts: BuildOpts): Promise<ChatMessage[]> {
  const world = await prisma.world.findUnique({
    where: { id: opts.worldId },
    include: { lorebookEntries: { where: { enabled: true } } },
  });
  if (!world) throw new Error("世界不存在");

  const chapter = await prisma.chapter.findUnique({
    where: { id: opts.chapterId },
    include: {
      messages: {
        orderBy: { index: "asc" },
        ...(opts.beforeIndex !== undefined
          ? { where: { index: { lt: opts.beforeIndex } } }
          : {}),
      },
    },
  });
  if (!chapter) throw new Error("章节不存在");

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

  // ── system 1：narrator 模板 + 风格/主题/宇宙论/融合公理/玩家神/尺度 ──
  const system1 = narratorSystem({
    scale: opts.scale,
    worldName: world.name,
    styleCard: world.styleCard,
    themeCard: world.themeCard,
    cosmology: world.cosmology,
    fusionAxiom: world.fusionAxiom ?? undefined,
    playerGod: playerGod
      ? {
          name: playerGod.name,
          rank: playerGod.rank,
          domains: playerGod.domains,
          persona: playerGod.persona,
          faithScope: playerGod.faithScope,
        }
      : null,
  });

  // ── system 2：主神卡片集 ──
  const system2 = godsSystemBlock(gods.filter((g) => !g.isPlayer));

  // ── system 3：世界书命中（playerInput + 最近 6 条消息文本） ──
  const windowMessages = [...prevTail, ...chapter.messages];
  const searchText = [
    opts.playerInput ?? "",
    ...windowMessages.slice(-RECENT_FOR_LORE).map((m) => m.content),
  ].join("\n");
  const lore = lorebookBlock(world.lorebookEntries, searchText);

  // ── 正文窗口 + 本轮输入，拼成单条 user（防中转站丢多轮） ──
  const windowText = proseWindow(windowMessages);
  const parts: string[] = [];
  if (windowText) {
    parts.push(`[Story so far — oldest to newest]\n\n${windowText}`);
  }
  if (opts.mode === "say") {
    parts.push(`【玩家神谕】${opts.playerInput ?? ""}`);
  } else if (opts.mode === "continue") {
    parts.push(
      `(幕后导演提示，不作为剧情输入): ${opts.directive?.trim() || "继续叙事，顺势推进。"}`,
    );
  } else {
    parts.push(openingDirective);
  }

  const messages: ChatMessage[] = [{ role: "system", content: system1 }];
  messages.push({ role: "system", content: system2 });
  if (lore) messages.push({ role: "system", content: lore });
  messages.push({ role: "user", content: parts.join("\n\n") });
  return messages;
}
