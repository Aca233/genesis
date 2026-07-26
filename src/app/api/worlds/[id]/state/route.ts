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
import { resolveTemporalState } from "@/lib/chat/continuous-state";
import { rewriteDurableProgress } from "@/lib/reality/task-runner";
import { loadLocalIcon, resolveNavigationIcons } from "@/lib/icons/svg.server";
import { resolveIcon } from "@/lib/icons/resolver";
import type { IconAssignmentValue, WorldIconTheme } from "@/lib/icons/types";

/**
 * GET /api/worlds/[id]/state —— 对局引导：一次拉取对局界面所需全量状态
 * （世界核心卡 + 诸神 + 最近四个内部记录段，最多 80 条连续消息）。
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

  const [timeline, gods, avatars, recentSegments, recentRewrite, iconAssignments] = await Promise.all([
    prisma.timeline.findUnique({
      where: { id: world.activeTimelineId },
      select: {
        id: true,
        branchName: true,
        branchSummary: true,
        realityState: true,
        observerState: true,
      },
    }),
    prisma.god.findMany({
      where: { timelineId: world.activeTimelineId },
      orderBy: { createdAt: "asc" },
      include: { abilities: true },
    }),
    world.mode === "creator"
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
    prisma.chapter.findMany({
      where: { timelineId: world.activeTimelineId },
      orderBy: { index: "desc" },
      take: 4,
      include: { messages: { orderBy: { index: "asc" } } },
    }),
    prisma.realityRewrite.findFirst({
      where: { worldId: world.id, resultTimelineId: world.activeTimelineId },
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
        updatedAt: true,
        error: true,
        plan: true,
      },
    }),
    prisma.iconAssignment.findMany({
      where: {
        timelineId: world.activeTimelineId,
        subjectType: { in: ["entity", "god", "ability"] },
      },
      select: {
        subjectType: true,
        subjectId: true,
        token: true,
        source: true,
        playerLocked: true,
      },
    }),
  ]);
  if (!timeline) {
    return NextResponse.json({ error: "活动时间线不存在" }, { status: 404 });
  }

  const mode = WorldModeSchema.parse(world.mode);
  const observerState = observerStateFromPersistence(timeline.observerState);
  const viewer = realityViewer(mode, observerState);

  // 当前内部记录段 = index 最大的 Chapter
  const currentChapter = recentSegments[0];
  if (!currentChapter) {
    return NextResponse.json({ error: "时间线尚无内部记录段" }, { status: 404 });
  }

  const generationRequest = await prisma.generationRequest.findFirst({
    where: {
      chapterId: currentChapter.id,
      status: { in: ["pending", "failed"] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      stage: true,
      status: true,
      retryable: true,
      safeError: true,
      stageUpdatedAt: true,
      leaseExpiresAt: true,
    },
  });

  const temporal = resolveTemporalState({
    realityState: timeline.realityState,
    observerState: timeline.observerState,
    epochName: world.draftDeck && typeof world.draftDeck === "object"
      ? (world.draftDeck as { epochConflict?: { epochName?: string } }).epochConflict?.epochName
      : null,
    yearLabel: world.draftDeck && typeof world.draftDeck === "object"
      ? (world.draftDeck as { epochConflict?: { yearLabel?: string } }).epochConflict?.yearLabel
      : null,
    eraSystem: world.themeCard && typeof world.themeCard === "object"
      ? (world.themeCard as { eraSystem?: string }).eraSystem
      : null,
  });
  const navigation = resolveNavigationIcons(world.iconTheme);
  const iconAssignmentBySubject = new Map(iconAssignments.map((assignment) => [
    `${assignment.subjectType}:${assignment.subjectId}`,
    assignment,
  ]));
  const iconAssignmentFor = (
    subjectType: "entity" | "god" | "ability",
    subjectId: string,
    fallbackToken: string,
  ) => {
    const assignment = iconAssignmentBySubject.get(`${subjectType}:${subjectId}`);
    const source = assignment && (["generated", "derived", "player"] as const).includes(
      assignment.source as IconAssignmentValue["source"],
    )
      ? assignment.source as IconAssignmentValue["source"]
      : "derived" as const;
    const override = assignment
      ? { token: assignment.token, source, playerLocked: assignment.playerLocked }
      : null;
    const resolved = resolveIcon({
      theme: navigation.theme as WorldIconTheme,
      token: assignment?.token ?? fallbackToken,
      subjectType,
      subjectId,
      override,
    });
    return {
      token: resolved.token,
      source,
      playerLocked: assignment?.playerLocked ?? false,
      icon: loadLocalIcon(resolved.id),
    };
  };
  const projectAbilityIcons = <T extends { id: string; kind: string }>(abilities: T[]) =>
    abilities.map((ability) => ({
      ...ability,
      iconAssignment: iconAssignmentFor(
        "ability",
        ability.id,
        navigation.theme.assignments.abilityKinds[ability.kind] ?? `ability.${ability.kind}`,
      ),
    }));
  const continuousMessages = [...recentSegments]
    .reverse()
    .flatMap((segment) => segment.messages.map((message) => ({
      ...message,
      editable: segment.id === currentChapter.id && segment.settleState === "open",
    })))
    .slice(-80);
  const previousMessages = continuousMessages.filter(
    (message) => message.chapterId !== currentChapter.id,
  );
  const latestNarrator = [...currentChapter.messages]
    .reverse()
    .find((message) => message.role === "narrator");
  const latestMeta = latestNarrator?.meta && typeof latestNarrator.meta === "object"
    ? latestNarrator.meta as Record<string, unknown>
    : {};
  const narratorCount = currentChapter.messages.filter(
    (message) => message.role === "narrator",
  ).length;
  const settleState = currentChapter.settleState ?? "open";
  const now = new Date();
  const hasLiveWorldOperation = world.operationKind !== null
    && world.operationLeaseExpiresAt !== null
    && world.operationLeaseExpiresAt > now;
  const hasLiveSettlementOperation = world.operationKind === "settlement"
    && hasLiveWorldOperation;
  const rewriteProgress = world.operationKind === "rewrite" && recentRewrite
    ? rewriteDurableProgress(recentRewrite as never)
    : null;
  const taskProgress = rewriteProgress
    ? rewriteProgress.status === "running" && !hasLiveWorldOperation
      ? {
          ...rewriteProgress,
          status: "failed" as const,
          retryable: true,
          safeError: "现实改写执行租约已过期，请从当前步骤重试",
        }
      : rewriteProgress
    : world.operationKind === "settlement" || settleState.startsWith("settling:")
      ? {
          taskKind: "settlement" as const,
          taskId: currentChapter.id,
          stage: settleState === "settled"
            ? "completed"
            : settleState.startsWith("settling:")
              ? settleState.slice("settling:".length) === "decay"
                ? "chronicle"
                : settleState.slice("settling:".length)
              : "checkpoint_read",
          status: currentChapter.settleError || !hasLiveSettlementOperation
            ? "failed" as const
            : "running" as const,
          retryable: currentChapter.settleRetryable ?? true,
          ...(currentChapter.settleError
            ? { safeError: "世界整理中断，请从当前步骤重试" }
            : !hasLiveSettlementOperation
              ? { safeError: "世界整理执行租约已过期，请从当前步骤重试" }
            : {}),
          updatedAt: (currentChapter.settleUpdatedAt ?? currentChapter.createdAt).toISOString(),
        }
      : generationRequest
        ? (() => {
            const leaseExpired = generationRequest.status === "pending"
              && (
                generationRequest.leaseExpiresAt === null
                || generationRequest.leaseExpiresAt <= now
                || world.operationKind !== "chat"
                || !hasLiveWorldOperation
              );
            return {
              taskKind: "chat" as const,
              taskId: generationRequest.id,
              stage: generationRequest.stage,
              status: generationRequest.status === "failed" || leaseExpired
                ? "failed" as const
                : "running" as const,
              retryable: generationRequest.retryable,
              ...(generationRequest.safeError
                ? { safeError: generationRequest.safeError }
                : leaseExpired
                  ? { safeError: "叙事生成执行租约已过期，请从当前步骤重试" }
                  : {}),
              updatedAt: generationRequest.stageUpdatedAt.toISOString(),
            };
          })()
        : null;

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
      iconTheme: {
        version: navigation.theme.version,
        catalogVersion: navigation.theme.catalogVersion,
        primaryFamily: navigation.theme.primaryFamily,
        emblemFamily: navigation.theme.emblemFamily,
        visualTone: navigation.theme.visualTone,
        motifTags: navigation.theme.motifTags,
      },
      iconThemeRevision: world.iconThemeRevision,
      navigationIcons: navigation.icons,
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
    temporal,
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
      iconAssignment: iconAssignmentFor("god", g.id, "divinity.pantheon"),
      relations: projectGodRelationsForViewer(g.relations, viewer),
      // 议程卡默认隐藏（迷雾的一部分）；玩家主动翻开后才下发
      agenda: projectGodAgendaForViewer(g.agenda, g.agendaRevealed, viewer),
      agendaRevealed: g.agendaRevealed,
      agendaWorldVisible: g.agendaRevealed,
      abilities: isOmniscientViewer(viewer)
        ? projectAbilityIcons(projectAbilitiesForOmniscient(g.abilities.map(normalizePersistedAbility)))
        : g.isPlayer
          ? projectAbilityIcons(projectAbilitiesForOwner(g.abilities.map(normalizePersistedAbility)))
          : projectAbilityIcons(projectAbilitiesForPlayer(g.abilities.map(normalizePersistedAbility))),
    })),
    avatars: avatars.map((avatar) => ({
      ...avatar,
      iconAssignment: iconAssignmentFor("entity", avatar.id, "entity.character"),
      sections: projectSectionsForViewer(avatar.sections, viewer),
      abilities: isOmniscientViewer(viewer)
        ? projectAbilityIcons(projectAbilitiesForOmniscient(avatar.abilities.map(normalizePersistedAbility)))
        : projectAbilityIcons(projectAbilitiesForPlayer(avatar.abilities.map(normalizePersistedAbility))),
    })),
    currentChapter: {
      id: currentChapter.id,
      index: currentChapter.index,
      title: currentChapter.title,
    },
    currentSegment: {
      id: currentChapter.id,
      settleState,
    },
    checkpoint: {
      segmentId: currentChapter.id,
      needsSettlement: settleState !== "settled"
        && (latestMeta.settlementRequired === true || narratorCount >= 6),
      settling: hasLiveSettlementOperation,
    },
    operation: hasLiveWorldOperation
      ? { kind: world.operationKind }
      : null,
    taskProgress,
    messages: continuousMessages,
    prevChapterTail: previousMessages,
    recentRewrite,
  });
}
