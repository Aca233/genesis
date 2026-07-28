import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { WorldModeSchema } from "@/lib/world-mode";
import { realityViewerFromPersistence } from "@/lib/reality/visibility";
import { parseWorldIconTheme } from "@/lib/icons/theme";
import { resolveIcon } from "@/lib/icons/resolver";
import { loadLocalIcon } from "@/lib/icons/svg.server";
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";

/**
 * GET /api/codex?timelineId=xxx —— 众生录列表（轻量，无 sections）
 * 排序：标星在前 → active 在前 → 名字
 */

export const GET = withAuth(async (userId, request: Request) => {
  const url = new URL(request.url);
  const timelineId = url.searchParams.get("timelineId");
  if (!timelineId) {
    return NextResponse.json({ error: "缺少 timelineId" }, { status: 400 });
  }

  const timeline = await prisma.timeline.findFirst({
    where: ownedWhere.timeline(userId, timelineId),
    select: {
      observerState: true,
      world: { select: { mode: true, iconTheme: true } },
    },
  });
  if (!timeline) {
    return NextResponse.json({ error: "时间线不存在" }, { status: 404 });
  }

  // Resolve from persistence even though the lightweight list has no secret fields.
  // This keeps all codex endpoints on the same server-owned visibility boundary.
  realityViewerFromPersistence(
    WorldModeSchema.parse(timeline.world.mode),
    timeline.observerState,
  );

  const entities = await prisma.entity.findMany({
    where: { timelineId },
    select: {
      id: true,
      type: true,
      name: true,
      aliases: true,
      emblemSeed: true,
      imageUrl: true,
      starred: true,
      isChosen: true,
      heat: true,
      summary: true,
      scenePresence: true,
    },
    orderBy: [{ starred: "desc" }, { heat: "asc" }, { name: "asc" }],
  });

  const assignments = await prisma.iconAssignment.findMany({
    where: {
      timelineId,
      subjectType: "entity",
      subjectId: { in: entities.map((entity) => entity.id) },
    },
    select: {
      subjectId: true,
      token: true,
      source: true,
      playerLocked: true,
    },
  });
  const assignmentByEntity = new Map(assignments.map((assignment) => [
    assignment.subjectId,
    assignment,
  ]));
  const iconTheme = parseWorldIconTheme(timeline.world.iconTheme);

  return NextResponse.json({
    entities: entities.map((entity) => {
      const assignment = assignmentByEntity.get(entity.id);
      const source = assignment && (["generated", "derived", "player"] as const).includes(
        assignment.source as "generated" | "derived" | "player",
      )
        ? assignment.source as "generated" | "derived" | "player"
        : "derived" as const;
      const value = assignment
        ? { token: assignment.token, source, playerLocked: assignment.playerLocked }
        : null;
      const resolved = resolveIcon({
        theme: iconTheme,
        token: assignment?.token
          ?? iconTheme.assignments.entityTypes[entity.type]
          ?? `entity.${entity.type}`,
        subjectType: "entity",
        subjectId: entity.id,
        override: value,
      });
      return {
        ...entity,
        iconAssignment: {
          token: resolved.token,
          source,
          playerLocked: assignment?.playerLocked ?? false,
          icon: loadLocalIcon(resolved.id),
        },
      };
    }),
  });
});
