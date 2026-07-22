import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePersistedAbility } from "@/lib/abilities/types";
import {
  projectAbilitiesForOmniscient,
  projectAbilitiesForOwner,
  projectAbilitiesForPlayer,
} from "@/lib/abilities/visibility";
import { WorldModeSchema } from "@/lib/world-mode";
import {
  isOmniscientViewer,
  observerStateFromPersistence,
  projectGodAgendaForViewer,
  projectGodRelationsForViewer,
  projectSectionsForViewer,
  realityViewer,
} from "@/lib/reality/visibility";

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

  const timeline = await prisma.timeline.findUnique({
    where: { id: world.activeTimelineId },
    select: {
      id: true,
      branchName: true,
      branchSummary: true,
      observerState: true,
    },
  });
  if (!timeline) {
    return NextResponse.json({ error: "活动时间线不存在" }, { status: 404 });
  }

  const mode = WorldModeSchema.parse(world.mode);
  const observerState = observerStateFromPersistence(timeline.observerState);
  const viewer = realityViewer(mode, observerState);

  // 当前章 = index 最大的章
  const currentChapter = await prisma.chapter.findFirst({
    where: { timelineId: world.activeTimelineId },
    orderBy: { index: "desc" },
    include: { messages: { orderBy: { index: "asc" } } },
  });
  if (!currentChapter) {
    return NextResponse.json({ error: "时间线尚无章节" }, { status: 404 });
  }

  const [gods, avatars, prevChapter, recentRewrite] = await Promise.all([
    prisma.god.findMany({
      where: { timelineId: world.activeTimelineId },
      orderBy: { createdAt: "asc" },
      include: { abilities: true },
    }),
    mode === "creator"
      ? prisma.entity.findMany({
          where: {
            timelineId: world.activeTimelineId,
            type: "character",
            isCreatorAvatar: true,
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            summary: true,
            heat: true,
            raceId: true,
            scenePresence: true,
            sections: true,
            abilities: true,
          },
        })
      : Promise.resolve([]),
    prisma.chapter.findUnique({
      where: {
        timelineId_index: {
          timelineId: world.activeTimelineId,
          index: currentChapter.index - 1,
        },
      },
      include: { messages: { orderBy: { index: "desc" }, take: 3 } },
    }),
    prisma.realityRewrite.findFirst({
      where: { worldId: world.id, resultTimelineId: timeline.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        decree: true,
        scope: true,
        status: true,
        summary: true,
        sourceTimelineId: true,
        resultTimelineId: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    world: {
      id: world.id,
      name: world.name,
      mode,
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
    timeline: {
      id: timeline.id,
      branchName: timeline.branchName,
      branchSummary: timeline.branchSummary,
      observerState,
    },
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
      relations: projectGodRelationsForViewer(g.relations, viewer),
      // 议程卡默认隐藏（迷雾的一部分）；玩家主动翻开后才下发
      agenda: projectGodAgendaForViewer(g.agenda, g.agendaRevealed, viewer),
      agendaRevealed: g.agendaRevealed,
      agendaWorldVisible: g.agendaRevealed,
      abilities: isOmniscientViewer(viewer)
        ? projectAbilitiesForOmniscient(g.abilities.map(normalizePersistedAbility))
        : g.isPlayer
          ? projectAbilitiesForOwner(g.abilities.map(normalizePersistedAbility))
          : projectAbilitiesForPlayer(g.abilities.map(normalizePersistedAbility)),
    })),
    avatars: avatars.map((avatar) => ({
      ...avatar,
      sections: projectSectionsForViewer(avatar.sections, viewer),
      abilities: isOmniscientViewer(viewer)
        ? projectAbilitiesForOmniscient(avatar.abilities.map(normalizePersistedAbility))
        : projectAbilitiesForPlayer(avatar.abilities.map(normalizePersistedAbility)),
    })),
    currentChapter: {
      id: currentChapter.id,
      index: currentChapter.index,
      title: currentChapter.title,
    },
    messages: currentChapter.messages,
    prevChapterTail: (prevChapter?.messages ?? []).reverse(),
    recentRewrite,
  });
}
