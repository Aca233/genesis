import { prisma } from "@/lib/db";

export type CacheUsageRow = {
  inputTokens: number | null;
  outputTokens?: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens?: number | null;
  cacheFallback?: boolean;
};

export type CacheAggregate = {
  calls: number;
  callsWithUsage: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  hitRate: number | null;
  fallbackCalls: number;
};

function sumNullable(rows: CacheUsageRow[], key: keyof CacheUsageRow): number | null {
  const values = rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function aggregateCacheCalls(rows: CacheUsageRow[]): CacheAggregate {
  const rateRows = rows.filter((row) =>
    row.inputTokens !== null && row.inputTokens > 0 && row.cacheReadTokens !== null);
  const rateInput = rateRows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const rateRead = rateRows.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0);
  return {
    calls: rows.length,
    callsWithUsage: rows.filter((row) => row.inputTokens !== null).length,
    inputTokens: sumNullable(rows, "inputTokens"),
    outputTokens: sumNullable(rows, "outputTokens"),
    cacheReadTokens: sumNullable(rows, "cacheReadTokens"),
    cacheWriteTokens: sumNullable(rows, "cacheWriteTokens"),
    hitRate: rateRows.length && rateInput > 0 ? rateRead / rateInput : null,
    fallbackCalls: rows.filter((row) => row.cacheFallback === true).length,
  };
}

const CACHE_TASKS = ["genesis", "narrative", "settlement", "reroll"];
const usageSelect = {
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  cacheFallback: true,
} as const;

export type CacheStatsResponse = {
  last24Hours: CacheAggregate;
  allTime: CacheAggregate;
  byTask: Array<{ task: string; aggregate: CacheAggregate }>;
  recent: Array<{
    id: string;
    task: string;
    provider: string | null;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    cacheRequested: boolean;
    cacheFallback: boolean;
    ok: boolean;
    createdAt: string;
  }>;
};

type CacheStatsDb = typeof prisma;

export async function loadPromptCacheStats(db: CacheStatsDb = prisma): Promise<CacheStatsResponse> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const where = { task: { in: CACHE_TASKS } };
  const [allRows, recentRows] = await Promise.all([
    db.llmCall.findMany({ where, select: { task: true, createdAt: true, ...usageSelect } }),
    db.llmCall.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        task: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        cacheRequested: true,
        cacheFallback: true,
        ok: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    last24Hours: aggregateCacheCalls(allRows.filter((row) => row.createdAt >= since)),
    allTime: aggregateCacheCalls(allRows),
    byTask: CACHE_TASKS.map((task) => ({
      task,
      aggregate: aggregateCacheCalls(allRows.filter((row) => row.task === task)),
    })),
    recent: recentRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}
