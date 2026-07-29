import { prisma } from "@/lib/db";
import { ensureGenesisTaskRunning } from "./task-runner";
import { ensureGenesisV2PrimaryJobRunning } from "./v2/primary-runner";
import { ensureGenesisShadowJobRunning } from "./v2/shadow-runner";

const POLL_INTERVAL_MS = 2_000;
let scanPromise: Promise<void> | null = null;

export async function scanGenesisJobs(now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const recovering = await tx.genesisTask.findMany({
      where: { status: "waiting_for_provider", updatedAt: { lt: new Date(now.getTime() - 30_000) } },
      take: 20,
      select: { id: true, aggregateVersion: true, stage: true },
    });
    if (!recovering.length) return;
    for (const task of recovering) {
      const aggregateVersion = task.aggregateVersion + 1;
      const updated = await tx.genesisTask.updateMany({
        where: { id: task.id, status: "waiting_for_provider", aggregateVersion: task.aggregateVersion },
        data: { status: "queued", error: null, aggregateVersion },
      });
      if (updated.count !== 1) continue;
      await tx.genesisJob.updateMany({
        where: { genesisTaskId: task.id, status: "waiting_for_provider" },
        data: { status: "queued", error: null },
      });
      await tx.genesisOutbox.create({
        data: {
          taskId: task.id,
          aggregateVersion,
          eventType: "provider_probe_queued",
          payloadProjection: { status: "queued", stage: task.stage },
        },
      });
    }
  });
  const jobs = await prisma.genesisJob.findMany({
    where: {
      engineVersion: "legacy-v1",
      status: { in: ["queued", "running"] },
      OR: [
        { status: "queued" },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
      task: { status: { in: ["queued", "running", "repairing"] } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 20,
    select: { genesisTaskId: true },
  });
  for (const job of jobs) ensureGenesisTaskRunning(job.genesisTaskId);
  const primaryV2Jobs = await prisma.genesisJob.findMany({
    where: {
      engineVersion: "dag-v2",
      status: { in: ["queued", "running"] },
      OR: [
        { status: "queued" },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
      task: {
        engineVersion: "dag-v2",
        status: { in: ["queued", "running", "repairing"] },
      },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 20,
    select: { id: true },
  });
  for (const job of primaryV2Jobs) ensureGenesisV2PrimaryJobRunning(job.id);
  const shadowJobs = await prisma.genesisJob.findMany({
    where: {
      engineVersion: "dag-v2-shadow",
      status: { in: ["queued", "running"] },
      OR: [
        { status: "queued" },
        { status: "running", leaseExpiresAt: { lt: now } },
      ],
      task: { status: "completed", shadowEnabled: true, shadowStatus: { in: ["pending_legacy", "running"] } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 20,
    select: { id: true },
  });
  for (const job of shadowJobs) ensureGenesisShadowJobRunning(job.id);
}

export function wakeGenesisScheduler(): void {
  if (scanPromise) return;
  scanPromise = scanGenesisJobs().catch(() => {}).finally(() => { scanPromise = null; });
}

export function startGenesisScheduler(): void {
  wakeGenesisScheduler();
  const timer = setInterval(wakeGenesisScheduler, POLL_INTERVAL_MS);
  timer.unref();
}
