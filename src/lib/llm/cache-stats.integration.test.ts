import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadPromptCacheStats } from "./cache-stats";

const marker = `cache-stats-${randomUUID()}`;
const ids: string[] = [];

async function insert(input: {
  id: string;
  task: string;
  createdAt: Date;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheFallback?: boolean;
}) {
  ids.push(input.id);
  await prisma.llmCall.create({
    data: {
      ...input,
      slot: marker,
      provider: "test-provider",
      model: marker,
      outputTokens: null,
      cacheWriteTokens: null,
      cacheRequested: true,
      cacheFallback: input.cacheFallback ?? false,
      durationMs: 1,
      ok: true,
    },
  });
}

afterAll(async () => {
  await prisma.llmCall.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("prompt cache stats database aggregation", () => {
  it("separates 24h/all-time/task data and exposes only whitelisted recent fields", async () => {
    const now = Date.now();
    await insert({ id: `${marker}-recent`, task: "genesis", createdAt: new Date(now - 60_000), inputTokens: 100, cacheReadTokens: 70 });
    await insert({ id: `${marker}-null`, task: "narrative", createdAt: new Date(now - 120_000), inputTokens: null, cacheReadTokens: null, cacheFallback: true });
    await insert({ id: `${marker}-old`, task: "settlement", createdAt: new Date(now - 25 * 60 * 60 * 1000), inputTokens: 200, cacheReadTokens: 100 });

    const stats = await loadPromptCacheStats();
    expect(stats.allTime.calls).toBeGreaterThanOrEqual(3);
    expect(stats.last24Hours.calls).toBeLessThan(stats.allTime.calls);
    expect(stats.byTask.find((row) => row.task === "genesis")?.aggregate.calls).toBeGreaterThanOrEqual(1);
    const recent = stats.recent.find((row) => row.id === `${marker}-recent`);
    expect(recent).toMatchObject({ provider: "test-provider", model: marker, cacheReadTokens: 70 });
    expect(recent).not.toHaveProperty("error");
    expect(recent).not.toHaveProperty("cacheKey");
  });
});
