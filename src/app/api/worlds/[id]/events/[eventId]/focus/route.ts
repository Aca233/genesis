import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ObserverStateSchema } from "@/lib/reality/schemas";
import {
  canViewWorldKnowledge,
  realityViewer,
} from "@/lib/reality/visibility";
import { WorldModeSchema } from "@/lib/world-mode";
import { ActivityVisibilitySchema } from "@/lib/world-activity/contracts";

type Context = { params: Promise<{ id: string; eventId: string }> };
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

class FocusRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function activeTimeline(tx: Transaction, worldId: string) {
  const world = await tx.world.findUnique({
    where: { id: worldId },
    select: { id: true, mode: true, activeTimelineId: true },
  });
  if (world === null) throw new FocusRequestError("世界不存在", 404);
  if (world.activeTimelineId === null) {
    throw new FocusRequestError("世界尚未开局（无活动时间线）", 409);
  }

  const timeline = await tx.timeline.findUnique({
    where: { id: world.activeTimelineId },
    select: { id: true, observerState: true },
  });
  if (timeline === null) throw new FocusRequestError("活动时间线不存在", 404);
  return {
    timeline,
    observerState: ObserverStateSchema.parse(timeline.observerState),
    mode: WorldModeSchema.parse(world.mode),
  };
}

async function handle(
  method: "PUT" | "DELETE",
  { params }: Context,
) {
  try {
    const { id: worldId, eventId } = await params;
    const focusedEventId = await prisma.$transaction(async (tx) => {
      const { timeline, observerState, mode } = await activeTimeline(tx, worldId);

      if (method === "PUT") {
        const event = await tx.worldEvent.findUnique({
          where: { id: eventId },
          select: {
            id: true,
            timelineId: true,
            phase: true,
            resolvedAt: true,
            visibility: true,
          },
        });
        if (
          event === null
          || event.timelineId !== timeline.id
          || event.phase === "resolved"
          || event.resolvedAt !== null
          || !canViewWorldKnowledge(
            realityViewer(mode, observerState),
            ActivityVisibilitySchema.parse(event.visibility),
          )
        ) {
          throw new FocusRequestError(
            "只能关注当前视角可见且尚未解决的活动现实事件",
            409,
          );
        }
        if (observerState.focusedEventId === event.id) return event.id;
        await tx.timeline.update({
          where: { id: timeline.id },
          data: {
            observerState: json({
              ...observerState,
              focusedEventId: event.id,
            }),
          },
        });
        return event.id;
      }

      if (observerState.focusedEventId !== eventId) {
        return observerState.focusedEventId;
      }
      await tx.timeline.update({
        where: { id: timeline.id },
        data: {
          observerState: json({
            ...observerState,
            focusedEventId: null,
          }),
        },
      });
      return null;
    });

    return NextResponse.json({ focusedEventId });
  } catch (error) {
    if (error instanceof FocusRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PUT(_request: Request, context: Context) {
  return handle("PUT", context);
}

export async function DELETE(_request: Request, context: Context) {
  return handle("DELETE", context);
}
