import type { CacheAggregate } from "@/lib/llm/cache-stats";

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
