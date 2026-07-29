import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/route";
import { projectVersionTwoWorld } from "@/lib/archive/v2";
import { parseWorldIconTheme } from "@/lib/icons/theme";
import { collectIconCredits, renderIconCreditsMarkdown } from "@/lib/icons/credits";

/**
 * GET /api/worlds/[id]/export —— 导出 owner-private version 4 存档。
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

const WORLD_EVENT_KEYS = [
  "id",
  "timelineId",
  "kind",
  "title",
  "summary",
  "phase",
  "visibility",
  "participantIds",
  "originMessageId",
  "originActivityId",
  "latestMessageId",
  "parentEventId",
  "createdAt",
  "updatedAt",
  "resolvedAt",
] as const;

const WORLD_ACTIVITY_KEYS = [
  "id",
  "timelineId",
  "eventId",
  "recordType",
  "kind",
  "text",
  "visibility",
  "actorId",
  "targetIds",
  "subjectIds",
  "sourceMessageId",
  "eraLabel",
  "timeLabel",
  "createdAt",
] as const;

const ENTITY_RELATION_KEYS = [
  "id",
  "timelineId",
  "sourceEntityId",
  "targetEntityId",
  "label",
  "note",
  "createdAt",
  "updatedAt",
] as const;

function projectFields(value: unknown, keys: readonly string[]) {
  const source = record(value);
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function projectVersionFourWorld(value: unknown) {
  const sourceWorld = record(value);
  const versionThree = projectVersionThreeWorld(value);
  const sourceTimelines = Array.isArray(sourceWorld.timelines) ? sourceWorld.timelines : [];
  const sourceTimelineById = new Map(sourceTimelines.map((timelineValue) => {
    const timeline = record(timelineValue);
    return [timeline.id, timeline] as const;
  }));

  return {
    ...versionThree,
    timelines: versionThree.timelines.map((timelineValue) => {
      const timeline = record(timelineValue);
      const source = sourceTimelineById.get(timeline.id) ?? {};
      const sourceChapters = Array.isArray(source.chapters) ? source.chapters : [];
      const sourceChapterById = new Map(sourceChapters.map((chapterValue) => {
        const chapter = record(chapterValue);
        return [chapter.id, chapter] as const;
      }));
      const chapters = Array.isArray(timeline.chapters) ? timeline.chapters : [];
      return {
        ...timeline,
        chapters: chapters.map((chapterValue) => {
          const chapter = record(chapterValue);
          return {
            ...chapter,
            brief: sourceChapterById.get(chapter.id)?.brief,
          };
        }),
        worldEvents: (Array.isArray(source.worldEvents) ? source.worldEvents : [])
          .map((event) => projectFields(event, WORLD_EVENT_KEYS)),
        worldActivities: (Array.isArray(source.worldActivities) ? source.worldActivities : [])
          .map((activity) => projectFields(activity, WORLD_ACTIVITY_KEYS)),
        entityRelations: (Array.isArray(source.entityRelations) ? source.entityRelations : [])
          .map((relation) => projectFields(relation, ENTITY_RELATION_KEYS)),
      };
    }),
  };
}

export const GET = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  const world = await prisma.world.findFirst({
    where: { id, userId },
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
          canonEvents: { orderBy: { ordinal: "asc" } },
          worldEvents: { orderBy: { createdAt: "asc" } },
          worldActivities: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          entityRelations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          iconAssignments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
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
    version: 4,
    exportedAt: new Date().toISOString(),
    world: projectVersionFourWorld(world),
    iconCreditsMarkdown: renderIconCreditsMarkdown(collectIconCredits({
      theme: parseWorldIconTheme(world.iconTheme),
      assignments: world.timelines.flatMap((timeline) =>
        timeline.iconAssignments.flatMap((assignment) =>
          (["entity", "god", "ability", "event"] as const).includes(
            assignment.subjectType as "entity" | "god" | "ability" | "event",
          )
            ? [{
                subjectType: assignment.subjectType as "entity" | "god" | "ability" | "event",
                subjectId: assignment.subjectId,
                token: assignment.token,
              }]
            : []),
      ),
    })),
  };

  const encodedName = encodeURIComponent(`genesis-${world.name}.json`);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="genesis-world.json"; filename*=UTF-8''${encodedName}`,
    },
  });
});
