import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  CheckpointForkConflictError,
  CheckpointForkNotFoundError,
  forkPantheonCheckpoint,
} from "@/lib/reality/checkpoint-fork";
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
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";

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
  z.object({
    action: z.literal("fork"),
    sourceChapterId: IdSchema,
    expectedActiveId: IdSchema,
    branchName: z.string().optional(),
    idempotencyKey: z.string().min(8).max(128),
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
  if (error instanceof RealityNotFoundError || error instanceof CheckpointForkNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof RealityConflictError
    || error instanceof CheckpointForkConflictError
    || error instanceof WorldOperationConflictError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof RealityTreeValidationError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  throw error;
}

/** 创世主与万神殿都可管理现实树；万神殿经检查点回溯获得自己的分叉树。 */
async function requireManagedWorld(
  userId: string,
  worldId: string,
): Promise<{ mode: "creator" | "pantheon" } | NextResponse> {
  const world = await prisma.world.findFirst({
    where: ownedWhere.world(userId, worldId),
    select: { mode: true, status: true },
  });
  if (world === null) return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  if (world.status === "concluded") {
    return NextResponse.json({ error: "此界已成史，不可再改动现实" }, { status: 409 });
  }
  if (world.mode !== "creator" && world.mode !== "pantheon") {
    return NextResponse.json({ error: "该模式不可管理现实树" }, { status: 403 });
  }
  return { mode: world.mode };
}

export const GET = withAuth(async (userId, _request: Request, { params }: Context) => {
  const { id } = await params;
  const world = await prisma.world.findFirst({
    where: ownedWhere.world(userId, id),
    select: { id: true },
  });
  if (world === null) return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  try {
    return NextResponse.json(await loadRealityTree(prisma, id));
  } catch (error) {
    return errorResponse(error);
  }
});

export const POST = withAuth(async (userId, request: Request, { params }: Context) => {
  const { id } = await params;
  const gate = await requireManagedWorld(userId, id);
  if (gate instanceof NextResponse) return gate;
  try {
    const body = PostBodySchema.parse(await request.json().catch(() => null));
    if (body.action === "fork") {
      // 创世主用敕令改写分叉；检查点回溯是万神殿专属通道
      if (gate.mode !== "pantheon") {
        return NextResponse.json({ error: "仅万神殿模式可回溯检查点" }, { status: 403 });
      }
      const forked = await forkPantheonCheckpoint(prisma, {
        userId,
        worldId: id,
        sourceChapterId: body.sourceChapterId,
        expectedActiveId: body.expectedActiveId,
        branchName: body.branchName,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ activeId: forked.activeId });
    }
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
});

export const PATCH = withAuth(async (userId, request: Request, { params }: Context) => {
  const { id } = await params;
  const gate = await requireManagedWorld(userId, id);
  if (gate instanceof NextResponse) return gate;
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
});

export const DELETE = withAuth(async (userId, request: Request, { params }: Context) => {
  const { id } = await params;
  const gate = await requireManagedWorld(userId, id);
  if (gate instanceof NextResponse) return gate;
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
});
