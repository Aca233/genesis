import type { CacheAggregate, ExpectedHitStats } from "@/lib/llm/cache-stats";

const tokenFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatTokens(value: number | null): string {
  return value === null ? "—" : tokenFormatter.format(value);
}

export function formatCacheRate(rate: number | null): string {
  return rate === null ? "端点未返回用量" : `${(rate * 100).toFixed(1)}%`;
}

export function taskLabel(task: string): string {
  return ({ genesis: "创世", narrative: "正文", settlement: "章末", reroll: "重掷" } as Record<string, string>)[task] ?? task;
}

export function summarizeCacheAvailability(
  aggregate: Pick<CacheAggregate, "calls" | "callsWithUsage" | "fallbackCalls">,
): string {
  const parts = aggregate.calls === 0
    ? ["尚无缓存请求记录"]
    : aggregate.callsWithUsage === 0
      ? ["端点尚未返回可统计用量"]
      : [`${aggregate.callsWithUsage}/${aggregate.calls} 次调用返回用量`];
  if (aggregate.fallbackCalls > 0) parts.push(`自动兼容回退 ${aggregate.fallbackCalls} 次`);
  return parts.join(" · ");
}

/** 「应命中 vs 实际命中」摘要:同前缀 5 分钟内的第 2+ 次调用应当命中缓存。 */
export function formatExpectedHits(stats: ExpectedHitStats): string {
  if (stats.expectedCalls === 0) return "尚无同前缀的短窗口重复调用,无法判定应命中率";
  const parts = [`应命中 ${stats.expectedCalls} 次`, `实际命中 ${stats.hitCalls} 次`];
  if (stats.missedCalls > 0) parts.push(`未命中 ${stats.missedCalls} 次`);
  if (stats.rate !== null) parts.push(`应命中达成率 ${(stats.rate * 100).toFixed(0)}%`);
  if (stats.unknownCalls > 0) parts.push(`${stats.unknownCalls} 次无用量不可判定`);
  return parts.join(" · ");
}

/** 运行内轮号展示:0 = 首轮;旧记录无轮号返回空串。 */
export function roundLabel(index: number | null): string {
  if (index === null || index < 0) return "";
  return index === 0 ? "" : `第${index + 1}轮`;
}
