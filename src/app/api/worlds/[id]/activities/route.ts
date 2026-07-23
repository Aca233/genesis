import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  observerStateFromPersistence,
  realityViewer,
} from "@/lib/reality/visibility";
import { WorldModeSchema } from "@/lib/world-mode";
import {
  projectWorldActivity,
  type WorldActivityProjectionRow,
  type WorldEventProjectionRow,
} from "@/lib/world-activity/projection";

export const dynamic = "force-dynamic";

type ActivityPersistence = {
  worldEvent: {
    findMany(args: unknown): Promise<WorldEventProjectionRow[]>;
  };
  worldActivity: {
    findMany(args: unknown): Promise<WorldActivityProjectionRow[]>;
  };
};

function focusedEventIdFromPersistence(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as { focusedEventId?: unknown }).focusedEventId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

type ActivityCursor = {
  createdAt: Date;
  id: string;
};

function parseCursor(value: string): ActivityCursor | null {
  const separator = value.lastIndexOf("|");
  if (separator <= 0 || separator === value.length - 1) return null;
  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
  return { createdAt, id };
}

function pagination(request: Request):
  | { limit: number; before: ActivityCursor | null }
  | { error: string } {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { error: "limit 必须是 1 至 50 的整数" };
  }
  const rawBefore = params.get("before");
  if (rawBefore === null) return { limit, before: null };
  const before = parseCursor(rawBefore);
  if (before === null) return { error: "before 必须包含 ISO 时间和动态 ID" };
  return { limit, before };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const page = pagination(request);
  if ("error" in page) {
    return NextResponse.json({ error: page.error }, { status: 400 });
  }

  const { id } = await params;
  const world = await prisma.world.findUnique({
    where: { id },
    select: { id: true, mode: true, activeTimelineId: true },
  });
  if (!world) {
    return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  }
  if (!world.activeTimelineId) {
    return NextResponse.json({ error: "世界尚无活动现实" }, { status: 404 });
  }
  const timeline = await prisma.timeline.findUnique({
    where: { id: world.activeTimelineId },
    select: { id: true, observerState: true },
  });
  if (!timeline) {
    return NextResponse.json({ error: "活动现实不存在" }, { status: 404 });
  }

  const mode = WorldModeSchema.parse(world.mode);
  const viewer = realityViewer(mode, observerStateFromPersistence(timeline.observerState));
  const visibilityWhere = viewer === "creator_omniscient"
    ? {}
    : { visibility: { in: ["public", "player_known"] } };
  const db = prisma as unknown as ActivityPersistence;
  const [events, rows] = await Promise.all([
    db.worldEvent.findMany({
      where: {
        timelineId: timeline.id,
        phase: { not: "resolved" },
        ...visibilityWhere,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }),
    db.worldActivity.findMany({
      where: {
        timelineId: timeline.id,
        ...(page.before
          ? {
              OR: [
                { createdAt: { lt: page.before.createdAt } },
                {
                  createdAt: page.before.createdAt,
                  id: { lt: page.before.id },
                },
              ],
            }
          : {}),
        ...visibilityWhere,
      },
      include: {
        event: { select: { visibility: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
    }),
  ]);

  const focusedEventId = focusedEventIdFromPersistence(timeline.observerState);
  const projected = projectWorldActivity({
    focusedEventId,
    events,
    activities: rows,
  }, viewer);
  const recentActivities = projected.activities.slice(0, page.limit);
  const hasNextPage = projected.activities.length > page.limit;
  const nextCursor = hasNextPage
    ? (() => {
        const last = recentActivities.at(-1);
        return last ? `${last.createdAt}|${last.id}` : null;
      })()
    : null;
  const importantEvents = [...projected.events].sort((left, right) => {
    if (left.id === focusedEventId) return -1;
    if (right.id === focusedEventId) return 1;
    return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
  });

  return NextResponse.json({
    focusedEvent: projected.focusedEvent,
    importantEvents,
    recentActivities,
    nextCursor,
  });
}
