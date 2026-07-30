"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  completedStageIndex,
  GENESIS_STAGES,
  type GenesisStageId,
  type GenesisTaskStatus,
} from "@/lib/genesis/stages";
import { acceptTaskSnapshot } from "@/lib/genesis/client-state";
import type { WorldMode } from "@/lib/world-mode";
import { PlayBackground } from "@/components/play/PlayBackground";
import { OperationIcon } from "@/components/icons/OperationIcon";
import { GenesisAuditWarnings } from "@/components/genesis/GenesisAuditWarnings";
import type { GenesisQualityReport } from "@/lib/genesis/semantic-audit";

/** 阶段序数镌记：未至之印以汉字序数浅刻 */
const STAGE_NUMERALS = [
  "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三",
] as const;

type Task = {
  id: string;
  engineVersion: string;
  mode: WorldMode;
  status: GenesisTaskStatus;
  stage: GenesisStageId;
  completedKeys: string[];
  error: string | null;
  auditReport: GenesisQualityReport | null;
  worldId: string | null;
  createdAt: string;
  updatedAt: string;
  aggregateVersion: number;
  snapshotHash: string;
};

type Connection = "connecting" | "live" | "reconnecting";

export function GenesisProgress({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [pageError, setPageError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [now, setNow] = useState(0);
  // 重试成功后自增，重建 SSE 与轮询（终态失败会停掉两者）
  const [epoch, setEpoch] = useState(0);
  const redirected = useRef(false);
  const latestTask = useRef<Task | null>(null);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    // SSE 存活期间轮询退避为兜底频率，断线时恢复 5s
    let sseLive = false;
    let lastEventId = latestTask.current?.aggregateVersion ?? 0;

    const apply = (next: Task) => {
      if (disposed) return;
      if (!acceptTaskSnapshot(latestTask.current, next)) return;
      latestTask.current = next;
      setTask(next);
      setPageError(null);
      if (next.status === "waiting_for_provider") setConnection("reconnecting");
      if (next.status === "completed" && next.worldId && !redirected.current) {
        redirected.current = true;
        router.replace(`/genesis/${next.worldId}`);
      }
    };

    const fetchTask = async () => {
      try {
        const response = await fetch(`/api/genesis/tasks/${taskId}`, { cache: "no-store" });
        const data: { task?: Task; error?: string } = await response.json();
        if (!response.ok || !data.task) throw new Error(data.error ?? "无法读取创世进度");
        apply(data.task);
      } catch (error) {
        if (!disposed) setPageError(error instanceof Error ? error.message : "无法读取创世进度");
      }
    };

    // 轮询兜底：SSE 存活时退避到 30s；任务终态失败后不再重排（重试成功会重建本 effect）
    const schedulePoll = () => {
      if (disposed) return;
      pollTimer = setTimeout(async () => {
        if (disposed) return;
        if (["failed", "cancelled"].includes(latestTask.current?.status ?? "")) return;
        if (!sseLive) await fetchTask();
        schedulePoll();
      }, sseLive ? 30_000 : 5_000);
    };

    const connect = () => {
      if (disposed) return;
      setConnection((value) => (value === "connecting" ? "connecting" : "reconnecting"));
      source = new EventSource(`/api/genesis/tasks/${taskId}/events?cursor=${lastEventId}`);
      source.onopen = () => {
        sseLive = true;
        setConnection("live");
      };
      source.addEventListener("progress", (event) => {
        const message = event as MessageEvent<string>;
        const parsedId = Number.parseInt(message.lastEventId, 10);
        if (Number.isSafeInteger(parsedId)) lastEventId = Math.max(lastEventId, parsedId);
        apply(JSON.parse(message.data) as Task);
      });
      source.addEventListener("completed", (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as { worldId?: string };
        if (data.worldId && !redirected.current) {
          redirected.current = true;
          router.replace(`/genesis/${data.worldId}`);
        }
      });
      source.addEventListener("failed", () => {
        sseLive = false;
        source?.close();
        void fetchTask();
      });
      source.onerror = () => {
        sseLive = false;
        source?.close();
        if (!disposed) {
          setConnection("reconnecting");
          void fetchTask();
          retryTimer = setTimeout(connect, 2_000);
        }
      };
    };

    void fetchTask();
    connect();
    schedulePoll();

    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [router, taskId, epoch]);

  useEffect(() => {
    const started = task?.createdAt ? new Date(task.createdAt).getTime() : Date.now();
    const tick = () => {
      const current = Date.now();
      setNow(current);
      setSeconds(Math.max(0, Math.floor((current - started) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [task?.createdAt]);

  const currentIndex = useMemo(
    () => task ? completedStageIndex(task.stage, task.status) : 0,
    [task],
  );
  const current = GENESIS_STAGES.find((stage) => stage.id === task?.stage) ?? GENESIS_STAGES[0];
  const heartbeatAge = task
    ? Math.max(0, Math.floor((now - new Date(task.updatedAt).getTime()) / 1000))
    : 0;

  async function retry() {
    setPageError(null);
    try {
      const response = await fetch(`/api/genesis/tasks/${taskId}/retry`, { method: "POST" });
      const data: { error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPageError(data.error ?? "重试失败");
        return;
      }
      // 不整页刷新：重建 SSE 与轮询，接管重启后的任务状态
      setConnection("connecting");
      setEpoch((n) => n + 1);
    } catch (err) {
      setPageError(String(err));
    }
  }

  return (
    <main className="play-shell relative flex min-h-screen w-full items-center justify-center overflow-hidden px-5 py-10">
      <PlayBackground variant="progress" />
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_50%_25%,var(--gilt-glow),transparent_35%)]" />
      <section className="tome-plate tome-plate--corners grid w-full max-w-5xl gap-10 p-6 md:grid-cols-[0.9fr_1.1fr] md:p-10">
        <div className="flex flex-col justify-between gap-8">
          <div>
            <p className="text-sm tracking-[0.35em] text-gilt [text-shadow:0_0_10px_var(--gilt-glow)]">时之仪正在运转</p>
            <h1 className="mt-4 text-4xl font-black tracking-wider text-ink md:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
              世界正在凝聚
            </h1>
            <p className="mt-5 text-xl text-gilt [text-shadow:0_0_12px_var(--gilt-glow)]" style={{ fontFamily: "var(--font-display)" }}>{current.title}</p>
            <p className="mt-2 leading-7 text-ink-soft">{current.description}</p>
          </div>

          <div className="rounded-xl border border-line bg-paper-sunken/60 p-4 text-sm shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_8%,transparent)]">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-ink-soft">
                <span className={`h-2.5 w-2.5 rounded-full ${connection === "live" ? "animate-pulse bg-gilt" : connection === "connecting" ? "animate-pulse bg-ink-faint" : "bg-cinnabar"}`} />
                {connection === "live" ? "模型仍在回应" : connection === "connecting" ? "正在建立连接" : "连接中断，正在恢复"}
              </span>
              <span className="tabular-nums text-ink-faint">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
            </div>
            <p className="mt-2 text-ink-faint">
              {heartbeatAge < 3 ? "刚刚收到新的生成痕迹" : `${heartbeatAge} 秒前收到生成痕迹`}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              生成引擎：{task?.engineVersion === "dag-v2" ? "V2 分阶段主引擎" : "Legacy 稳定引擎"}
            </p>
          </div>

          <Link href="/" className="text-sm text-ink-faint transition hover:text-gilt">
            ← 返回神谕（生成将在后台继续）
          </Link>

          {(task?.status === "failed" || task?.status === "cancelled" || pageError) && (
            <div className="rounded-xl border border-cinnabar/40 bg-cinnabar/5 p-4">
              <p className="font-bold text-cinnabar">命运丝线在「{current.title}」阶段断裂</p>
              <p className="mt-2 break-words text-sm leading-6 text-ink-soft">{task?.error ?? pageError}</p>
              <GenesisAuditWarnings report={task?.auditReport ?? null} severity="error" />
              <div className="mt-4 flex gap-3">
                {task?.status === "failed" && (
                  <button onClick={retry} className="seal-button min-h-10! px-5! py-2! text-sm">
                    重新创世
                  </button>
                )}
                <Link href="/" className="rounded-md border border-line px-4 py-2 text-ink-soft transition hover:border-gilt/40 hover:text-gilt">
                  返回神谕
                </Link>
              </div>
            </div>
          )}
        </div>

        <ol className="relative space-y-1">
          {GENESIS_STAGES.map((stage, index) => {
            const done = index < currentIndex || task?.status === "completed";
            const active = stage.id === task?.stage && task?.status !== "completed";
            const failed = active && (task?.status === "failed" || task?.status === "cancelled");
            return (
              <li key={stage.id} className="relative flex min-h-14 gap-4 pb-3">
                {/* 鎏金进度丝线：已成阶段间的连线泛金微光 */}
                {index < GENESIS_STAGES.length - 1 && (
                  <span
                    className={`absolute left-[11px] top-7 h-[calc(100%-1rem)] w-px ${
                      done
                        ? "shadow-[0_0_6px_var(--gilt-glow)] [background:linear-gradient(180deg,color-mix(in_srgb,var(--gilt)_70%,transparent),color-mix(in_srgb,var(--gilt)_42%,transparent))]"
                        : "bg-line"
                    }`}
                  />
                )}
                <span className={`relative z-10 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition ${
                  failed ? "border-cinnabar bg-cinnabar text-paper" : done ? "border-gilt bg-gilt text-paper" : active ? "animate-pulse border-gilt bg-paper-raised text-gilt shadow-[0_0_18px_var(--gilt-glow)]" : "border-line bg-paper-raised text-ink-faint"
                }`}>
                  {failed ? (
                    "!"
                  ) : done ? (
                    <OperationIcon name="check" size={12} />
                  ) : active ? (
                    "◆"
                  ) : (
                    <span className="text-[10px] opacity-70" style={{ fontFamily: "var(--font-display)" }} aria-hidden="true">
                      {STAGE_NUMERALS[index] ?? ""}
                    </span>
                  )}
                </span>
                <div>
                  <p
                    className={`tracking-[0.05em] ${active ? "font-bold text-gilt [text-shadow:0_0_10px_var(--gilt-glow)]" : done ? "text-ink" : "text-ink-faint"}`}
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {stage.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-faint">{stage.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
