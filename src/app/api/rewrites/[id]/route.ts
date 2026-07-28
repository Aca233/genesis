import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ensureRealityRewriteRunning,
  RealityRewriteNotFoundError,
  retryRealityRewrite,
  toRealityRewriteDto,
} from "@/lib/reality/task-runner";
import { withAuth } from "@/lib/auth/route";

const RetrySchema = z.object({ action: z.literal("retry") }).strict();

async function findTask(userId: string, id: string) {
  return prisma.realityRewrite.findFirst({
    where: { id, world: { userId } },
  });
}

export const GET = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const task = await findTask(userId, id);
  if (task === null) return Response.json({ error: "现实改写任务不存在" }, { status: 404 });
  return Response.json({ task: toRealityRewriteDto(task) });
});

export const POST = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "重试请求无效" }, { status: 400 });
  }
  const parsed = RetrySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "重试请求无效" }, { status: 400 });
  if (await findTask(userId, id) === null) {
    return Response.json({ error: "现实改写任务不存在" }, { status: 404 });
  }
  try {
    const task = await retryRealityRewrite(prisma, userId, id);
    if (task.status !== "completed") ensureRealityRewriteRunning(task.id);
    return Response.json(
      { task: toRealityRewriteDto(task) },
      { status: task.status === "completed" ? 200 : 202 },
    );
  } catch (error) {
    if (error instanceof RealityRewriteNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
});
