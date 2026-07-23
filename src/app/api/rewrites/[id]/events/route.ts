import { prisma } from "@/lib/db";
import {
  ensureRealityRewriteRunning,
  rewriteDurableProgress,
  toRealityRewriteDto,
} from "@/lib/reality/task-runner";
import { encodeTaskEvent } from "@/lib/tasks/progress-events";

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
  const exists = await prisma.realityRewrite.findFirst({
    where: { id, world: { userId: "local" } },
    select: { id: true, status: true },
  });
  if (exists === null) return Response.json({ error: "现实改写任务不存在" }, { status: 404 });
  if (exists.status !== "completed" && exists.status !== "failed") ensureRealityRewriteRunning(id);

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastVersion = "";
      try {
        for (let tick = 0; !request.signal.aborted; tick += 1) {
          const task = await prisma.realityRewrite.findFirst({
            where: { id, world: { userId: "local" } },
          });
          if (task === null) {
            controller.enqueue(encodeEvent("failed", { error: "现实改写任务不存在" }));
            break;
          }
          const dto = toRealityRewriteDto(task);
          const progress = rewriteDurableProgress(task);
          const version = `${dto.updatedAt}:${dto.status}:${progress.stage}:${dto.resultTimelineId ?? ""}`;
          if (version !== lastVersion) {
            controller.enqueue(encodeTaskEvent(progress.status === "failed"
              ? {
                  type: "failed",
                  taskId: id,
                  stage: progress.stage,
                  message: progress.safeError ?? "现实改写中断",
                  retryable: progress.retryable,
                }
              : {
                  type: "progress",
                  taskId: id,
                  taskKind: "rewrite",
                  stage: progress.stage,
                  status: progress.status === "completed" ? "completed" : "running",
                  occurredAt: progress.updatedAt,
                }));
            if (progress.status === "completed") {
              controller.enqueue(encodeTaskEvent({
                type: "done",
                taskId: id,
                followUp: { kind: "none" },
              }));
            }
            lastVersion = version;
          } else if (tick % 5 === 0) {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
          if (dto.status === "completed" || dto.status === "failed") break;
          await sleep(1000);
        }
      } catch (error) {
        if (!request.signal.aborted) {
          controller.error(error instanceof Error ? error : new Error("现实改写进度连接中断"));
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
