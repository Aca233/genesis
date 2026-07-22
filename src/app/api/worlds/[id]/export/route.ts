import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { projectVersionTwoWorld } from "@/lib/archive/v2";

/**
 * GET /api/worlds/[id]/export —— 导出 owner-private version 3 存档。
 *
 * Runtime leases, idempotency credentials and provider-facing error details are
 * intentionally outside the archive. Hidden world facts remain present because
 * this endpoint exports the owner's complete reality graph.
 */

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function projectRewrite(value: unknown) {
  const rewrite = record(value);
  return {
    id: rewrite.id,
    worldId: rewrite.worldId,
    sourceTimelineId: rewrite.sourceTimelineId,
    resultTimelineId: rewrite.resultTimelineId,
    sourceChapterId: rewrite.sourceChapterId,
    decree: rewrite.decree,
    scope: rewrite.scope,
    status: rewrite.status,
    plan: rewrite.plan,
    summary: rewrite.summary,
    createdAt: rewrite.createdAt,
    updatedAt: rewrite.updatedAt,
  };
}

function projectVersionThreeWorld(value: unknown) {
  const world = record(value);
  const versionTwo = projectVersionTwoWorld(value);
  const timelines = Array.isArray(world.timelines) ? world.timelines : [];
  const projectedTimelines = Array.isArray(versionTwo.timelines)
    ? versionTwo.timelines
    : [];
  const sourceTimelineById = new Map(
    timelines.map((timeline) => {
      const source = record(timeline);
      return [source.id, source] as const;
    }),
  );

  const safeWorld = { ...versionTwo } as Record<string, unknown>;
  delete safeWorld.materialArchiveError;

  return {
    ...safeWorld,
    timelines: projectedTimelines.map((timelineValue) => {
      const timeline = record(timelineValue);
      const source = sourceTimelineById.get(timeline.id) ?? {};
      const sourceEntities = Array.isArray(source.entities) ? source.entities : [];
      const avatarById = new Map(sourceEntities.map((entityValue) => {
        const entity = record(entityValue);
        return [entity.id, entity.isCreatorAvatar ?? false] as const;
      }));
      const entities = Array.isArray(timeline.entities) ? timeline.entities : [];
      return {
        ...timeline,
        branchName: source.branchName,
        branchSummary: source.branchSummary,
        realityState: source.realityState,
        observerState: source.observerState,
        forkRewriteId: source.forkRewriteId,
        updatedAt: source.updatedAt,
        entities: entities.map((entityValue) => {
          const entity = record(entityValue);
          return {
            ...entity,
            isCreatorAvatar: avatarById.get(entity.id) ?? false,
          };
        }),
      };
    }),
    rewrites: (Array.isArray(world.rewrites) ? world.rewrites : []).map(projectRewrite),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const world = await prisma.world.findUnique({
    where: { id },
    include: {
      timelines: {
        orderBy: { createdAt: "asc" },
        include: {
          chapters: {
            orderBy: { index: "asc" },
            include: { messages: { orderBy: { index: "asc" } } },
          },
          gods: { orderBy: { createdAt: "asc" } },
          abilities: {
            orderBy: { createdAt: "asc" },
            include: { events: true },
          },
          entities: {
            orderBy: { createdAt: "asc" },
            include: { sections: true, race: true, memberships: true },
          },
          chronicles: { orderBy: { createdAt: "asc" } },
          omens: { orderBy: { createdAt: "asc" } },
        },
      },
      rewrites: { orderBy: { createdAt: "asc" } },
      lorebookEntries: true,
    },
  });

  if (!world) {
    return NextResponse.json({ error: "不存在" }, { status: 404 });
  }

  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    world: projectVersionThreeWorld(world),
  };

  const encodedName = encodeURIComponent(`genesis-${world.name}.json`);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="genesis-world.json"; filename*=UTF-8''${encodedName}`,
    },
  });
}
