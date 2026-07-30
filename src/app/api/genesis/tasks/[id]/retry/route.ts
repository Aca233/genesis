import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { expandedGenesisRetryBudget } from "@/lib/genesis/budget";
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
      select: {
        userId: true,
        requestHash: true,
        aggregateVersion: true,
        stage: true,
        engineVersion: true,
        budgetMaxCalls: true,
        budgetMaxInput: true,
        budgetMaxOutput: true,
        budgetCallCount: true,
        budgetReservedIn: true,
        budgetReservedOut: true,
        budgetSettledIn: true,
        budgetSettledOut: true,
      },
    });
    if (!current) return false;
    const retryAsLegacy = current.engineVersion === "dag-v2";
    const aggregateVersion = current.aggregateVersion + 1;
    const retryBudget = expandedGenesisRetryBudget({
      maxCalls: current.budgetMaxCalls,
      maxInputTokens: current.budgetMaxInput,
      maxOutputTokens: current.budgetMaxOutput,
      usedCalls: current.budgetCallCount,
      usedInputTokens: current.budgetReservedIn + current.budgetSettledIn,
      usedOutputTokens: current.budgetReservedOut + current.budgetSettledOut,
    });
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
        ...(retryAsLegacy ? {
          engineVersion: "legacy-v1",
          stage: "oracle",
          completedKeys: [],
          shadowEnabled: false,
          shadowStatus: "disabled",
        } : {}),
        budgetMaxCalls: retryBudget.maxCalls,
        budgetMaxInput: retryBudget.maxInputTokens,
        budgetMaxOutput: retryBudget.maxOutputTokens,
      },
    });
    if (updated.count !== 1) return false;
    const resetJob = {
      status: "queued",
      error: null,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: null,
      attempt: 0,
    };
    if (retryAsLegacy) {
      await tx.genesisJob.updateMany({
        where: { genesisTaskId: id, engineVersion: "dag-v2" },
        data: {
          status: "superseded",
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await tx.genesisJob.upsert({
        where: {
          genesisTaskId_nodeKey: { genesisTaskId: id, nodeKey: "legacy-world-deck" },
        },
        create: {
          userId: current.userId,
          genesisTaskId: id,
          nodeKey: "legacy-world-deck",
          engineVersion: "legacy-v1",
          inputHash: current.requestHash,
        },
        update: resetJob,
      });
    } else {
      const job = await tx.genesisJob.updateMany({
        where: { genesisTaskId: id, nodeKey: "legacy-world-deck" },
        data: resetJob,
      });
      if (job.count < 1) throw new Error("创世任务缺少可重试的持久作业");
    }
    await tx.genesisOutbox.create({
      data: {
        taskId: id,
        aggregateVersion,
        eventType: "task_retried",
        payloadProjection: {
          status: "queued",
          stage: retryAsLegacy ? "oracle" : current.stage,
          engineVersion: retryAsLegacy ? "legacy-v1" : current.engineVersion,
        },
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
