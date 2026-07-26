"use client";

import { useCallback, useEffect, useState } from "react";
import type { CacheAggregate, CacheStatsResponse } from "@/lib/llm/cache-stats";
import {
  formatCacheRate,
  formatExpectedHits,
  formatTokens,
  roundLabel,
  summarizeCacheAvailability,
  taskLabel,
} from "./prompt-cache-stats-state";

function AggregateCard({ title, aggregate }: { title: string; aggregate: CacheAggregate }) {
  return (
    <div className="rounded-lg border border-line bg-paper-sunken/80 p-4 shadow-[inset_0_1px_3px_color-mix(in_srgb,var(--ink)_8%,transparent)]">
      <h3 className="letterpress mb-3 text-xs!">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div><dt className="letterpress">缓存命中率</dt><dd className="mt-0.5 text-base text-ink tabular-nums">{formatCacheRate(aggregate.hitRate)}</dd></div>
        <div><dt className="letterpress">读取 / 输入</dt><dd className="mt-0.5 text-base text-ink tabular-nums">{formatTokens(aggregate.cacheReadTokens)} / {formatTokens(aggregate.inputTokens)}</dd></div>
        <div><dt className="letterpress">缓存写入</dt><dd className="mt-0.5 text-ink tabular-nums">{formatTokens(aggregate.cacheWriteTokens)}</dd></div>
        <div><dt className="letterpress">调用数</dt><dd className="mt-0.5 text-ink tabular-nums">{aggregate.calls}</dd></div>
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
    <section className="tome-plate p-5 sm:p-6" aria-labelledby="prompt-cache-title">
      <h2 id="prompt-cache-title" className="illuminated-header display-md">
        <span className="illuminated-header__glyph" aria-hidden="true">✦</span>
        焚香余韵 · Prompt Cache
      </h2>
      <div className="mt-2 mb-4 flex items-start justify-between gap-3">
        <p className="text-xs text-ink-faint">缓存的是可复用的输入前缀，不是模型答案；故事仍由模型逐次生成。</p>
        <button type="button" onClick={() => void load()} disabled={loading} className="shrink-0 whitespace-nowrap text-xs text-gilt-strong/80 transition hover:text-gilt-strong disabled:opacity-40">
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-cinnabar/30 p-3 text-sm text-cinnabar">
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

          <p className="rounded-lg border border-line bg-paper-sunken/60 p-3 text-xs text-ink-soft">
            <span className="letterpress mr-2">应命中检测</span>
            {formatExpectedHits(stats.expectedHits)}
          </p>

          <div className="tome-scroll overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead className="bg-paper-sunken/80"><tr><th className="letterpress whitespace-nowrap p-2">任务</th><th className="letterpress whitespace-nowrap p-2">调用</th><th className="letterpress whitespace-nowrap p-2">读取 / 输入</th><th className="letterpress whitespace-nowrap p-2">命中率</th><th className="letterpress whitespace-nowrap p-2">回退</th></tr></thead>
              <tbody>{stats.byTask.map(({ task, aggregate }) => (
                <tr key={task} className="border-t border-line text-ink-soft">
                  <td className="p-2 text-ink">{taskLabel(task)}</td><td className="p-2 tabular-nums">{aggregate.calls}</td>
                  <td className="p-2 tabular-nums">{formatTokens(aggregate.cacheReadTokens)} / {formatTokens(aggregate.inputTokens)}</td>
                  <td className="p-2 tabular-nums">{formatCacheRate(aggregate.hitRate)}</td><td className="p-2 tabular-nums">{aggregate.fallbackCalls}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {stats.byModel.length > 0 ? (
            <div className="tome-scroll overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[30rem] text-left text-xs">
                <thead className="bg-paper-sunken/80"><tr><th className="letterpress whitespace-nowrap p-2">模型</th><th className="letterpress whitespace-nowrap p-2">调用</th><th className="letterpress whitespace-nowrap p-2">读取 / 输入</th><th className="letterpress whitespace-nowrap p-2">写入</th><th className="letterpress whitespace-nowrap p-2">命中率</th></tr></thead>
                <tbody>{stats.byModel.map(({ provider, model, aggregate }) => (
                  <tr key={`${provider ?? "—"}/${model ?? "—"}`} className="border-t border-line text-ink-soft">
                    <td className="max-w-[14rem] truncate p-2 text-ink" title={`${provider ?? "—"} / ${model ?? "—"}`}>{model ?? "—"}</td>
                    <td className="p-2 tabular-nums">{aggregate.calls}</td>
                    <td className="p-2 tabular-nums">{formatTokens(aggregate.cacheReadTokens)} / {formatTokens(aggregate.inputTokens)}</td>
                    <td className="p-2 tabular-nums">{formatTokens(aggregate.cacheWriteTokens)}</td>
                    <td className="p-2 tabular-nums">{formatCacheRate(aggregate.hitRate)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : null}

          {stats.byPrefixHash.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm text-gilt-strong/80 transition hover:text-gilt-strong">前缀命中归因（{stats.byPrefixHash.length}）</summary>
              <div className="tome-scroll mt-2 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[30rem] text-left text-xs">
                  <thead className="bg-paper-sunken/80"><tr><th className="letterpress whitespace-nowrap p-2">前缀指纹</th><th className="letterpress whitespace-nowrap p-2">调用</th><th className="letterpress whitespace-nowrap p-2">应命中</th><th className="letterpress whitespace-nowrap p-2">实际命中</th><th className="letterpress whitespace-nowrap p-2">最近调用</th></tr></thead>
                  <tbody>{stats.byPrefixHash.map((row) => (
                    <tr key={row.hash} className="border-t border-line text-ink-soft">
                      <td className="p-2 font-mono text-ink">{row.hash}</td>
                      <td className="p-2 tabular-nums">{row.calls}</td>
                      <td className="p-2 tabular-nums">{row.expected.expectedCalls}</td>
                      <td className="p-2 tabular-nums">{row.expected.hitCalls}{row.expected.missedCalls > 0 ? <span className="text-cinnabar">（漏 {row.expected.missedCalls}）</span> : null}</td>
                      <td className="p-2 tabular-nums text-ink-faint">{new Date(row.lastCalledAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          ) : null}

          <details>
            <summary className="cursor-pointer text-sm text-gilt-strong/80 transition hover:text-gilt-strong">最近调用（{stats.recent.length}）</summary>
            <div className="tome-scroll mt-2 max-h-64 overflow-auto rounded-lg border border-line">
              {stats.recent.length === 0 ? <p className="p-3 text-xs text-ink-faint">暂无记录</p> : stats.recent.map((row) => (
                <div key={row.id} className="grid grid-cols-[7rem_1fr_auto] gap-2 border-b border-line p-2 text-xs last:border-b-0">
                  <span className="text-ink-faint tabular-nums">{new Date(row.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="min-w-0 truncate text-ink-soft" title={`${row.provider ?? "—"} / ${row.model ?? "—"}${row.cacheCapability ? ` · 降级:${row.cacheCapability}` : ""}`}>{taskLabel(row.task)} · {row.provider ?? "—"}/{row.model ?? "—"}{roundLabel(row.agentCallIndex) ? ` · ${roundLabel(row.agentCallIndex)}` : ""}</span>
                  <span className={row.inputTokens === null ? "whitespace-nowrap text-xs text-ink-faint" : "whitespace-nowrap text-ink tabular-nums"} title="缓存读取 / 缓存写入 / 总输入">{row.inputTokens === null ? "端点未返回用量" : `读${formatTokens(row.cacheReadTokens)} 写${formatTokens(row.cacheWriteTokens)} 入${formatTokens(row.inputTokens)}`}{row.cacheFallback ? " · 兼容回退" : ""}{row.cacheCapability ? " · 有降级" : ""}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
