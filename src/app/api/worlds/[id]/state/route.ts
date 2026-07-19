import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/worlds/[id]/state —— 对局引导：一次拉取对局界面所需全量状态
 * （世界核心卡 + 诸神 + 当前章 + 当前章消息 + 上章末 3 条）。
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const world = await prisma.world.findUnique({ where: { id } });
  if (!world) {
    return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  }
  if (!world.activeTimelineId) {
    return NextResponse.json({ error: "世界尚未开局（无活动时间线）" }, { status: 404 });
  }

  // 当前章 = index 最大的章
  const currentChapter = await prisma.chapter.findFirst({
    where: { timelineId: world.activeTimelineId },
    orderBy: { index: "desc" },
    include: { messages: { orderBy: { index: "asc" } } },
  });
  if (!currentChapter) {
    return NextResponse.json({ error: "时间线尚无章节" }, { status: 404 });
  }

  const [gods, prevChapter] = await Promise.all([
    prisma.god.findMany({
      where: { timelineId: world.activeTimelineId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.chapter.findUnique({
      where: {
        timelineId_index: {
          timelineId: world.activeTimelineId,
          index: currentChapter.index - 1,
        },
      },
      include: { messages: { orderBy: { index: "desc" }, take: 3 } },
    }),
  ]);

  return NextResponse.json({
    world: {
      id: world.id,
      name: world.name,
      status: world.status,
      genesisInput: world.genesisInput,
      themeCard: world.themeCard,
      styleCard: world.styleCard,
      cosmology: world.cosmology,
      fusionAxiom: world.fusionAxiom,
      // 纪元冲突卡存于草稿卡组（开局后保留），设定集页签用
      epochConflict:
        world.draftDeck && typeof world.draftDeck === "object"
          ? ((world.draftDeck as Record<string, unknown>).epochConflict ?? null)
          : null,
    },
    timeline: { id: world.activeTimelineId },
    gods: gods.map((g) => ({
      id: g.id,
      name: g.name,
      tier: g.tier,
      isPlayer: g.isPlayer,
      rank: g.rank,
      domains: g.domains,
      persona: g.persona,
      voice: g.voice,
      faithScope: g.faithScope,
      relations: g.relations,
      // 议程卡默认隐藏（迷雾的一部分）；玩家主动翻开后才下发
      agenda: g.agendaRevealed ? g.agenda : null,
      agendaRevealed: g.agendaRevealed,
    })),
    currentChapter: {
      id: currentChapter.id,
      index: currentChapter.index,
      title: currentChapter.title,
    },
    messages: currentChapter.messages,
    prevChapterTail: (prevChapter?.messages ?? []).reverse(),
  });
}
