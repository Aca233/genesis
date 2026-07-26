import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { genesisSystem, genesisUserPrompt } from "@/lib/prompts/genesis";
import { parseStWorldbook, lorebookExcerpts } from "@/lib/lorebook/st-import";
import { WorldModeSchema } from "@/lib/world-mode";
import { buildWorldIconTheme } from "@/lib/icons/theme";
import { resolveTemporalState } from "@/lib/chat/continuous-state";

/**
 * POST /api/worlds —— 创世：一句话 → 世界卡组草稿
 * body: { decree: string, lorebook?: unknown(ST worldbook JSON) }
 * GET  /api/worlds —— 存档列表
 */

const CreateSchema = z.object({
  mode: WorldModeSchema.default("pantheon"),
  decree: z.string().min(2, "神谕太短").max(2000),
  lorebook: z.unknown().optional(),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "创世请求无效" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "创世请求无效" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // 世界书导入（可选）
  let excerpts: string | undefined;
  let parsedEntries: ReturnType<typeof parseStWorldbook> = [];
  if (body.lorebook) {
    try {
      parsedEntries = parseStWorldbook(body.lorebook);
      excerpts = lorebookExcerpts(parsedEntries) || undefined;
    } catch {
      return NextResponse.json(
        { error: "世界书格式无法解析：请提供 SillyTavern worldbook JSON" },
        { status: 400 },
      );
    }
  }

  let deck;
  try {
    const request = {
      task: "genesis" as const,
      userId: "local", // Phase A 单用户;后续波换真实会话用户
      system: genesisSystem(body.mode),
      user: genesisUserPrompt({
        mode: body.mode,
        decree: body.decree,
        lorebookExcerpts: excerpts,
      }),
      maxTokens: 16000,
      cache: { namespace: `genesis:v1:${body.mode}` },
    };
    deck = body.mode === "pantheon"
      ? await completeStructured("narrative", { ...request, schema: PantheonWorldDeckSchema })
      : await completeStructured("narrative", { ...request, schema: CreatorWorldDeckSchema });
    if (deck.mode !== body.mode) throw new Error("创世卡组模式不匹配");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    validateDeckReferences(deck);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "卡组引用校验失败", issues: [message] }, { status: 400 });
  }

  const world = await prisma.world.create({
    data: {
      name: deck.worldName,
      genesisInput: body.decree,
      mode: body.mode,
      status: "draft",
      draftDeck: deck as unknown as Prisma.InputJsonValue,
      themeCard: deck.theme as unknown as Prisma.InputJsonValue,
      styleCard: deck.style as unknown as Prisma.InputJsonValue,
      cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
      fusionAxiom: deck.fusionAxiom
        ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
        : undefined,
      iconTheme: buildWorldIconTheme(deck) as unknown as Prisma.InputJsonValue,
      lorebookEntries: {
        create: parsedEntries.map((e) => ({
          keys: e.keys,
          content: e.content,
          enabled: e.enabled,
          stExtra: e.stExtra as Prisma.InputJsonValue,
          source: "imported",
        })),
      },
    },
  });

  return NextResponse.json({ worldId: world.id, deck });
}

/** 存档状态行（附加于 playing 世界）：你离开时正在发生什么 */
type WorldStatusLine = {
  timelineId: string;
  era: string;
  time: string;
  trackedEventTitle: string | null;
  recentActivityRefs: { id: string; createdAt: string }[];
};

export async function GET() {
  const worlds = await prisma.world.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      mode: true,
      name: true,
      genesisInput: true,
      status: true,
      materialArchiveStatus: true,
      materialArchiveError: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // ── 附加 statusLine（仅 playing + 有活动时间线；纯附加字段，
  // 首页续玩入口的 id/name/status/updatedAt 契约保持不变）──
  // 完全派生自既有 WorldEvent / WorldActivity 数据，不做任何 LLM 调用：
  // 追踪事件标题与动态引用本就逐字可得，摘要生成只会增加时延而无信息增益。
  const playingIds = worlds.filter((w) => w.status === "playing").map((w) => w.id);
  const details = playingIds.length
    ? await prisma.world.findMany({
        where: { id: { in: playingIds } },
        select: { id: true, draftDeck: true, themeCard: true, activeTimelineId: true },
      })
    : [];
  const detailById = new Map(details.map((d) => [d.id, d]));
  const activeTimelineIds = details
    .map((d) => d.activeTimelineId)
    .filter((id): id is string => id !== null);
  const timelines = activeTimelineIds.length
    ? await prisma.timeline.findMany({
        where: { id: { in: activeTimelineIds } },
        select: { id: true, realityState: true, observerState: true },
      })
    : [];
  const timelineById = new Map(timelines.map((t) => [t.id, t]));

  // 单次 Promise.all 覆盖全部世界（受本地存档数约束）；逐世界查询换取与
  // activities 路由完全一致的可见性过滤。注：列表端点没有观察者上下文，
  // creator 世界在此只拿到 public/player_known 引用——可接受，未读数是
  // 回访钩子而非审计口径。
  const rows = await Promise.all(worlds.map(async (world) => {
    const detail = detailById.get(world.id);
    const timelineId = detail?.activeTimelineId ?? null;
    const timeline = timelineId ? timelineById.get(timelineId) : undefined;
    if (world.status !== "playing" || !detail || !timelineId || !timeline) {
      return world;
    }
    const [trackedEvent, recentActivityRefs] = await Promise.all([
      prisma.worldEvent.findFirst({
        where: {
          timelineId,
          phase: { not: "resolved" },
          // 可见性过滤与 activities 路由的玩家视角一致
          visibility: { in: ["public", "player_known"] },
        },
        orderBy: { updatedAt: "desc" },
        select: { title: true },
      }),
      prisma.worldActivity.findMany({
        where: { timelineId, visibility: { in: ["public", "player_known"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 30,
        select: { id: true, createdAt: true },
      }),
    ]);
    const temporal = resolveTemporalState({
      realityState: timeline.realityState,
      observerState: timeline.observerState,
      epochName: detail.draftDeck && typeof detail.draftDeck === "object"
        ? (detail.draftDeck as { epochConflict?: { epochName?: string } }).epochConflict?.epochName
        : null,
      yearLabel: detail.draftDeck && typeof detail.draftDeck === "object"
        ? (detail.draftDeck as { epochConflict?: { yearLabel?: string } }).epochConflict?.yearLabel
        : null,
      eraSystem: detail.themeCard && typeof detail.themeCard === "object"
        ? (detail.themeCard as { eraSystem?: string }).eraSystem
        : null,
    });
    const statusLine: WorldStatusLine = {
      timelineId,
      era: temporal.era,
      time: temporal.time,
      trackedEventTitle: trackedEvent?.title ?? null,
      recentActivityRefs: recentActivityRefs.map((ref) => ({
        id: ref.id,
        createdAt: ref.createdAt.toISOString(),
      })),
    };
    return { ...world, statusLine };
  }));
  return NextResponse.json({ worlds: rows });
}
