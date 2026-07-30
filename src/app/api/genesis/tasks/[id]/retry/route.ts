import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GENESIS_RETRY_BUDGET_ALLOWANCE } from "@/lib/genesis/budget";
import { wakeGenesisScheduler } from "@/lib/genesis/scheduler";
import { withAuth } from "@/lib/auth/route";

export const POST = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const retried = await prisma.$transaction(async (tx) => {
    const current = await tx.genesisTask.findFirst({
      where: { id, userId, status: "failed" },
      select: { aggregateVersion: true, stage: true, engineVersion: true },
    });
    if (!current) return false;
    const aggregateVersion = current.aggregateVersion + 1;
    const updated = await tx.genesisTask.updateMany({
      where: { id, userId, status: "failed", aggregateVersion: current.aggregateVersion },
      data: {
        status: "queued",
        rawOutput: "",
        rawExpiresAt: null,
        error: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attempt: 0,
        aggregateVersion,
        budgetMaxCalls: { increment: GENESIS_RETRY_BUDGET_ALLOWANCE.calls },
        budgetMaxInput: { increment: GENESIS_RETRY_BUDGET_ALLOWANCE.inputTokens },
        budgetMaxOutput: { increment: GENESIS_RETRY_BUDGET_ALLOWANCE.outputTokens },
      },
    });
    if (updated.count !== 1) return false;
    const job = await tx.genesisJob.updateMany({
      where: current.engineVersion === "dag-v2"
        ? { genesisTaskId: id, engineVersion: "dag-v2", status: "failed" }
        : { genesisTaskId: id, nodeKey: "legacy-world-deck" },
      data: {
        status: "queued",
        error: null,
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: null,
        attempt: 0,
      },
    });
    if (job.count < 1) throw new Error("创世任务缺少可重试的持久作业");
    await tx.genesisOutbox.create({
      data: {
        taskId: id,
        aggregateVersion,
        eventType: "task_retried",
        payloadProjection: { status: "queued", stage: current.stage },
      },
    });
    return true;
  });
  if (!retried) {
    return NextResponse.json({ error: "任务当前不可重试" }, { status: 409 });
  }
  wakeGenesisScheduler();
  return NextResponse.json({ ok: true }, { status: 202 });
});
