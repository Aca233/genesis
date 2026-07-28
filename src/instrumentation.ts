export async function register() {
  const state = globalThis as typeof globalThis & { __genesisRawCleanupStarted?: boolean };
  if (process.env.NEXT_RUNTIME === "nodejs"
    && process.env.NEXT_PHASE !== "phase-production-build"
    && !state.__genesisRawCleanupStarted) {
    state.__genesisRawCleanupStarted = true;
    const { startGenesisRawCleanup } = await import("@/lib/genesis/raw-cleanup");
    const { startGenesisScheduler } = await import("@/lib/genesis/scheduler");
    startGenesisRawCleanup();
    startGenesisScheduler();
  }
}
