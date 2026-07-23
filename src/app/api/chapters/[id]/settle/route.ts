import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { settleChapter } from "@/lib/settle/pipeline";
import {
  createSettlementTaskSSE,
  ensureSettlementRunning,
} from "@/lib/settle/task-runner";
import {
  progressEvent,
  type TaskProgressEvent,
} from "@/lib/tasks/progress-events";
import {
  WorldOperationConflictError,
  claimWorldOperation,
  releaseWorldOperation,
  type WorldOperationClient,
} from "@/lib/reality/operation-lock";

/**
 * POST /api/chapters/[id]/settle —— 内部世界整理（SSE 进度流）
 * 事件统一使用 TaskProgressEvent；浏览器断开只取消订阅，后台整理继续。
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
    return NextResponse.json({ error: "内部记录段不存在" }, { status: 404 });
  }
  if (chapter.messages.length === 0) {
    return NextResponse.json({ error: "此段尚无正文，不可整理" }, { status: 400 });
  }
  if (chapter.timeline.id !== chapter.timeline.world.activeTimelineId) {
    return NextResponse.json({ error: "该现实已被冻结" }, { status: 409 });
  }

  const token = id;
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

  const stepMap = {
    pantheon: "pantheon",
    extract: "extract",
    chronicle: "chronicle",
    decay: "chronicle",
    snapshot: "snapshot",
    done: "completed",
  } as const;
  const run = async (emit: (event: TaskProgressEvent) => void) => {
    try {
      emit(progressEvent(id, "settlement", "checkpoint_read", "completed"));
      try {
        for await (const p of settleChapter(id, {
          worldId: chapter.timeline.worldId,
          token,
          claimed: true,
        })) {
          const stage = stepMap[p.step];
          emit(progressEvent(
            id,
            "settlement",
            stage,
            p.step === "done" ? "completed" : "running",
            p.detail,
          ));
        }
        emit({
          type: "done",
          taskId: id,
          followUp: { kind: "none" },
        });
      } catch (err) {
        const current = await prisma.chapter.findUnique({ where: { id } });
        const rawStep = current?.settleState?.match(/^settling:(.+)$/)?.[1] ?? "pantheon";
        const stage = stepMap[rawStep as keyof typeof stepMap] ?? "checkpoint_read";
        const message = err instanceof Error ? err.message : String(err);
        await prisma.chapter.update({
          where: { id },
          data: {
            settleError: message.slice(0, 2000),
            settleRetryable: true,
            settleUpdatedAt: new Date(),
          },
        });
        emit({
          type: "failed",
          taskId: id,
          stage,
          message: "世界整理中断，请从当前步骤重试",
          retryable: true,
        });
      }
    } finally {
      await releaseWorldOperation(
        prisma as unknown as WorldOperationClient,
        chapter.timeline.worldId,
        "settlement",
        token,
      );
    }
  };
  void ensureSettlementRunning(id, run);

  return createSettlementTaskSSE(id, [
    progressEvent(id, "settlement", "checkpoint_read", "running"),
  ]);
}
