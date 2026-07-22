import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { WorldOperationConflictError } from "@/lib/reality/operation-lock";
import {
  RealityConflictError,
  RealityNotFoundError,
  RealityTreeValidationError,
  deleteRealitySubtree,
  loadRealityTree,
  renameReality,
  switchReality,
  undoReality,
} from "@/lib/reality/tree";

const IdSchema = z.string().trim().min(1).max(191);
const PostBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("switch"),
    targetTimelineId: IdSchema,
    expectedActiveId: IdSchema,
  }),
  z.object({
    action: z.literal("undo"),
    expectedActiveId: IdSchema,
  }),
]);
const PatchBodySchema = z.object({
  timelineId: IdSchema,
  branchName: z.string(),
});
const DeleteBodySchema = z.object({
  timelineId: IdSchema,
  expectedActiveId: IdSchema,
});

type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "请求体不合法" }, { status: 400 });
  }
  if (error instanceof RealityNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RealityConflictError || error instanceof WorldOperationConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof RealityTreeValidationError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  throw error;
}

async function requireCreatorWorld(worldId: string): Promise<NextResponse | null> {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
    select: { mode: true },
  });
  if (world === null) return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  if (world.mode !== "creator") {
    return NextResponse.json({ error: "仅创世主模式可管理现实树" }, { status: 403 });
  }
  return null;
}

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const world = await prisma.world.findUnique({
    where: { id },
    select: { id: true },
  });
  if (world === null) return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  try {
    return NextResponse.json(await loadRealityTree(prisma, id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const denied = await requireCreatorWorld(id);
  if (denied !== null) return denied;
  try {
    const body = PostBodySchema.parse(await request.json().catch(() => null));
    const result = body.action === "switch"
      ? await switchReality(prisma, {
        worldId: id,
        targetTimelineId: body.targetTimelineId,
        expectedActiveId: body.expectedActiveId,
      })
      : await undoReality(prisma, {
        worldId: id,
        expectedActiveId: body.expectedActiveId,
      });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const denied = await requireCreatorWorld(id);
  if (denied !== null) return denied;
  try {
    const body = PatchBodySchema.parse(await request.json().catch(() => null));
    return NextResponse.json(await renameReality(prisma, {
      worldId: id,
      timelineId: body.timelineId,
      branchName: body.branchName,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  const denied = await requireCreatorWorld(id);
  if (denied !== null) return denied;
  try {
    const body = DeleteBodySchema.parse(await request.json().catch(() => null));
    return NextResponse.json(await deleteRealitySubtree(prisma, {
      worldId: id,
      timelineId: body.timelineId,
      expectedActiveId: body.expectedActiveId,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
