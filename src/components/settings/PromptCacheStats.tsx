"use client";

import { useCallback, useEffect, useState } from "react";
import type { CacheAggregate, CacheStatsResponse } from "@/lib/llm/cache-stats";
import {
  formatCacheRate,
  formatTokens,
  summarizeCacheAvailability,
  taskLabel,
} from "./prompt-cache-stats-state";

function AggregateCard({ title, aggregate }: { title: string; aggregate: CacheAggregate }) {
  return (
    <div className="rounded-md border border-line bg-paper-sunken p-4">
      <h3 className="mb-3 text-sm text-gilt">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div><dt className="text-ink-faint">缓存命中率</dt><dd className="mt-0.5 text-base text-ink">{formatCacheRate(aggregate.hitRate)}</dd></div>
        <div><dt className="text-ink-faint">读取 / 输入</dt><dd className="mt-0.5 text-base text-ink">{formatTokens(aggregate.cacheReadTokens)} / {formatTokens(aggregate.inputTokens)}</dd></div>
        <div><dt className="text-ink-faint">缓存写入</dt><dd className="mt-0.5 text-ink">{formatTokens(aggregate.cacheWriteTokens)}</dd></div>
        <div><dt className="text-ink-faint">调用数</dt><dd className="mt-0.5 text-ink">{aggregate.calls}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-ink-faint">{summarizeCacheAvailability(aggregate)}</p>
    </div>
  );
}

export function PromptCacheStats() {
  const [stats, setStats] = useState<CacheStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/cache-stats", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "读取失败");
      setStats(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <section className="rounded-lg border border-line bg-paper-raised p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg text-ink" style={{ fontFamily: "var(--font-display)" }}>焚香余韵 · Prompt Cache</h2>
          <p className="mt-1 text-xs text-ink-faint">缓存的是可复用的输入前缀，不是模型答案；故事仍由模型逐次生成。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="text-xs text-gilt/70 hover:text-gilt disabled:opacity-40">
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-cinnabar/30 p-3 text-sm text-cinnabar">
          {error} <button type="button" onClick={() => void load()} className="ml-2 underline">重试</button>
        </div>
      ) : !stats ? (
        <p className="py-8 text-center text-sm text-ink-faint">正在读取缓存用量…</p>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <AggregateCard title="最近 24 小时" aggregate={stats.last24Hours} />
            <AggregateCard title="累计" aggregate={stats.allTime} />
          </div>

          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-paper-sunken text-ink-faint"><tr><th className="p-2">任务</th><th className="p-2">调用</th><th className="p-2">读取 / 输入</th><th className="p-2">命中率</th><th className="p-2">回退</th></tr></thead>
              <tbody>{stats.byTask.map(({ task, aggregate }) => (
                <tr key={task} className="border-t border-line text-ink-soft">
                  <td className="p-2 text-ink">{taskLabel(task)}</td><td className="p-2">{aggregate.calls}</td>
                  <td className="p-2">{formatTokens(aggregate.cacheReadTokens)} / {formatTokens(aggregate.inputTokens)}</td>
                  <td className="p-2">{formatCacheRate(aggregate.hitRate)}</td><td className="p-2">{aggregate.fallbackCalls}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <details>
            <summary className="cursor-pointer text-sm text-gilt/80">最近调用（{stats.recent.length}）</summary>
            <div className="mt-2 max-h-64 overflow-auto rounded-md border border-line">
              {stats.recent.length === 0 ? <p className="p-3 text-xs text-ink-faint">暂无记录</p> : stats.recent.map((row) => (
                <div key={row.id} className="grid grid-cols-[7rem_1fr_auto] gap-2 border-b border-line p-2 text-xs last:border-b-0">
                  <span className="text-ink-faint">{new Date(row.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="min-w-0 truncate text-ink-soft" title={`${row.provider ?? "—"} / ${row.model ?? "—"}`}>{taskLabel(row.task)} · {row.provider ?? "—"}/{row.model ?? "—"}</span>
                  <span className="text-ink">{row.inputTokens === null ? "端点未返回用量" : `${formatTokens(row.cacheReadTokens)}/${formatTokens(row.inputTokens)}`}{row.cacheFallback ? " · 兼容回退" : ""}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
