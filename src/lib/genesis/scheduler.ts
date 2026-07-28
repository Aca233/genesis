import { prisma } from "@/lib/db";
import { ensureGenesisTaskRunning } from "./task-runner";

const POLL_INTERVAL_MS = 2_000;
let scanPromise: Promise<void> | null = null;

export async function scanGenesisJobs(now = new Date()): Promise<void> {
  const jobs = await prisma.genesisJob.findMany({
    where: {
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
