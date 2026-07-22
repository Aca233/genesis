import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { settleChapter } from "@/lib/settle/pipeline";
import {
  WorldOperationConflictError,
  claimWorldOperation,
  type WorldOperationClient,
} from "@/lib/reality/operation-lock";

/**
 * POST /api/chapters/[id]/settle —— 章末结算（SSE 进度流，驱动岁月流转演出）
 * 事件：data:{"type":"progress","step","detail?","index?","total?"}
 *      data:{"type":"done","nextChapterId","title"}
 *      data:{"type":"error","message"}
 * 幂等：结算中断后重新 POST 从断点续跑。
 */

export const maxDuration = 600;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: {
      timeline: {
        select: {
          id: true,
          worldId: true,
          world: { select: { activeTimelineId: true } },
        },
      },
      messages: { select: { id: true }, take: 1 },
    },
  });
  if (!chapter) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }
  if (chapter.messages.length === 0) {
    return NextResponse.json({ error: "本章尚无一字，不可结算" }, { status: 400 });
  }
  if (chapter.timeline.id !== chapter.timeline.world.activeTimelineId) {
    return NextResponse.json({ error: "该现实已被冻结" }, { status: 409 });
  }

  const token = crypto.randomUUID();
  const operation = await claimWorldOperation(
    prisma as unknown as WorldOperationClient,
    chapter.timeline.worldId,
    "settlement",
    token,
  );
  if (!operation.acquired) {
    return NextResponse.json(
      { error: new WorldOperationConflictError(operation.activeKind).message },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const p of settleChapter(id, {
          worldId: chapter.timeline.worldId,
          token,
          claimed: true,
        })) {
          send({ type: "progress", ...p });
        }
        const next = await prisma.chapter.findUnique({
          where: {
            timelineId_index: {
              timelineId: chapter.timelineId,
              index: chapter.index + 1,
            },
          },
        });
        const settled = await prisma.chapter.findUnique({ where: { id } });
        send({
          type: "done",
          nextChapterId: next?.id ?? null,
          title: settled?.title ?? null,
          summary: settled?.summary ?? null,
        });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          controller.close();
        } catch {
          // 客户端提前断开
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
