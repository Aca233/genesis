import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createRealityRewrite,
  ensureRealityRewriteRunning,
  RealityRewriteConflictError,
  RealityRewriteForbiddenError,
  RealityRewriteNotFoundError,
  toRealityRewriteDto,
} from "@/lib/reality/task-runner";
import { RewriteScopeSchema } from "@/lib/reality/schemas";

const CreateRewriteSchema = z.object({
  decree: z.string().trim().min(1, "现实敕令不能为空").max(4000, "现实敕令过长"),
  scope: RewriteScopeSchema.default("prospective"),
  idempotencyKey: z.string().trim().min(8, "幂等键过短").max(128, "幂等键过长"),
}).strict();

function errorResponse(error: unknown): Response {
  if (error instanceof RealityRewriteNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RealityRewriteForbiddenError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof RealityRewriteConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  throw error;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "现实改写请求无效" }, { status: 400 });
  }
  const parsed = CreateRewriteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "现实改写请求无效" },
      { status: 400 },
    );
  }

  try {
    const { task, replayed } = await createRealityRewrite(prisma, {
      worldId: id,
      ...parsed.data,
    });
    ensureRealityRewriteRunning(task.id);
    return Response.json(
      { task: toRealityRewriteDto(task), taskId: task.id, replayed },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const world = await prisma.world.findFirst({
    where: { id, userId: "local" },
    select: { id: true },
  });
  if (world === null) return Response.json({ error: "世界不存在" }, { status: 404 });
  const tasks = await prisma.realityRewrite.findMany({
    where: { worldId: id },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ tasks: tasks.map(toRealityRewriteDto) });
}
