import { prisma } from "@/lib/db";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function cleanupExpiredGenesisRaw(now = new Date()): Promise<number> {
  const result = await prisma.genesisTask.updateMany({
    where: {
      rawExpiresAt: { lte: now },
      rawOutput: { not: "" },
      status: { notIn: ["running", "repairing"] },
    },
    data: { rawOutput: "", rawExpiresAt: null },
  });
  return result.count;
}

export function startGenesisRawCleanup(): void {
  const run = () => void cleanupExpiredGenesisRaw().catch(() => {
    // Cleanup is best-effort and must not prevent the application from serving traffic.
  });
  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref();
}
