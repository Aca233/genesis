import { prisma } from "@/lib/db";
import { toGenesisTaskDto } from "@/lib/genesis/task-runner";
import { withAuth } from "@/lib/auth/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function encodeEvent(event: string, data: unknown, id?: number) {
  return encoder.encode(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseCursor(request: Request): number {
  const urlCursor = new URL(request.url).searchParams.get("cursor");
  const headerCursor = request.headers.get("Last-Event-ID");
  const values = [urlCursor, headerCursor]
    .map((value) => Number.parseInt(value ?? "", 10))
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  return values.length ? Math.max(...values) : 0;
}

export const GET = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const exists = await prisma.genesisTask.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!exists) return Response.json({ error: "创世任务不存在" }, { status: 404 });

  const body = new ReadableStream({
    async start(controller) {
      let cursor = parseCursor(request);
      let sentSnapshot = false;
      try {
        for (let tick = 0; !request.signal.aborted; tick += 1) {
          const events = await prisma.genesisOutbox.findMany({
            where: { taskId: id, aggregateVersion: { gt: cursor } },
            orderBy: { aggregateVersion: "asc" },
            take: 100,
            select: { aggregateVersion: true },
          });
          const task = await prisma.genesisTask.findFirst({
            where: { id, userId },
            select: {
              id: true,
              engineVersion: true,
              mode: true,
              status: true,
              stage: true,
              completedKeys: true,
              error: true,
              worldId: true,
              createdAt: true,
              updatedAt: true,
              auditReport: true,
              aggregateVersion: true,
            },
          });
          if (!task) {
            controller.enqueue(encodeEvent("failed", { error: "创世任务不存在" }));
            break;
          }

          const dto = toGenesisTaskDto(task);
          const hasReplay = events.length > 0;
          if (!sentSnapshot || hasReplay || dto.aggregateVersion > cursor) {
            controller.enqueue(encodeEvent("progress", dto, dto.aggregateVersion));
            cursor = dto.aggregateVersion;
            sentSnapshot = true;
          } else if (tick % 5 === 0) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }

          if (dto.status === "completed") {
            controller.enqueue(encodeEvent("completed", { worldId: dto.worldId }, dto.aggregateVersion));
            break;
          }
          if (dto.status === "failed" || dto.status === "cancelled") {
            controller.enqueue(encodeEvent("failed", { stage: dto.stage, error: dto.error }, dto.aggregateVersion));
            break;
          }
          await sleep(1_000);
        }
      } catch (error) {
        if (!request.signal.aborted) {
          controller.error(error instanceof Error ? error : new Error("进度连接中断"));
          return;
        }
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
