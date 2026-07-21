import { prisma } from "@/lib/db";
import { ensureGenesisTaskRunning, toGenesisTaskDto } from "@/lib/genesis/task-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function encodeEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const exists = await prisma.genesisTask.findFirst({
    where: { id, userId: "local" },
    select: { id: true },
  });
  if (!exists) return Response.json({ error: "创世任务不存在" }, { status: 404 });

  ensureGenesisTaskRunning(id);

  const body = new ReadableStream({
    async start(controller) {
      let lastVersion = "";
      try {
        for (let tick = 0; !request.signal.aborted; tick += 1) {
          const task = await prisma.genesisTask.findFirst({
            where: { id, userId: "local" },
            select: {
              id: true,
              mode: true,
              status: true,
              stage: true,
              completedKeys: true,
              error: true,
              worldId: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          if (!task) {
            controller.enqueue(encodeEvent("failed", { error: "创世任务不存在" }));
            break;
          }

          const dto = toGenesisTaskDto(task);
          const version = `${dto.updatedAt}:${dto.status}:${dto.stage}`;
          if (version !== lastVersion) {
            controller.enqueue(encodeEvent("progress", dto));
            lastVersion = version;
          } else if (tick % 5 === 0) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }

          if (dto.status === "completed") {
            controller.enqueue(encodeEvent("completed", { worldId: dto.worldId }));
            break;
          }
          if (dto.status === "failed") {
            controller.enqueue(encodeEvent("failed", { stage: dto.stage, error: dto.error }));
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
}
