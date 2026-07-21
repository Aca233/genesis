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

type Task = {
  id: string;
  status: GenesisTaskStatus;
  stage: GenesisStageId;
  completedKeys: string[];
  error: string | null;
  worldId: string | null;
  createdAt: string;
  updatedAt: string;
};

type Connection = "connecting" | "live" | "reconnecting";

export function GenesisProgress({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [pageError, setPageError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [now, setNow] = useState(0);
  const redirected = useRef(false);
  const latestTask = useRef<Task | null>(null);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const apply = (next: Task) => {
      if (disposed) return;
      if (!acceptTaskSnapshot(latestTask.current, next)) return;
      latestTask.current = next;
      setTask(next);
      setPageError(null);
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

    const connect = () => {
      if (disposed) return;
      setConnection((value) => (value === "connecting" ? "connecting" : "reconnecting"));
      source = new EventSource(`/api/genesis/tasks/${taskId}/events`);
      source.onopen = () => setConnection("live");
      source.addEventListener("progress", (event) => {
        apply(JSON.parse((event as MessageEvent<string>).data) as Task);
      });
      source.addEventListener("completed", (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as { worldId?: string };
        if (data.worldId && !redirected.current) {
          redirected.current = true;
          router.replace(`/genesis/${data.worldId}`);
        }
      });
      source.addEventListener("failed", () => {
        source?.close();
        void fetchTask();
      });
      source.onerror = () => {
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
    pollTimer = setInterval(fetchTask, 5_000);

    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [router, taskId]);

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
    const response = await fetch(`/api/genesis/tasks/${taskId}/retry`, { method: "POST" });
    const data: { error?: string } = await response.json();
    if (!response.ok) {
      setPageError(data.error ?? "重试失败");
      return;
    }
    window.location.reload();
  }

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_50%_25%,var(--gilt-glow),transparent_35%)]" />
      <section className="relative grid w-full max-w-5xl gap-10 rounded-2xl border border-line bg-paper-raised/85 p-6 shadow-[0_24px_90px_rgba(46,36,24,0.12)] backdrop-blur-sm md:grid-cols-[0.9fr_1.1fr] md:p-10">
        <div className="flex flex-col justify-between gap-8">
          <div>
            <p className="text-sm tracking-[0.35em] text-gilt">时之仪正在运转</p>
            <h1 className="mt-4 text-4xl font-black tracking-wider text-ink md:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
              世界正在凝聚
            </h1>
            <p className="mt-5 text-xl text-gilt">{current.title}</p>
            <p className="mt-2 leading-7 text-ink-soft">{current.description}</p>
          </div>

          <div className="rounded-xl border border-line bg-paper-sunken/60 p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-ink-soft">
                <span className={`h-2.5 w-2.5 rounded-full ${connection === "live" ? "animate-pulse bg-gilt" : "bg-cinnabar"}`} />
                {connection === "live" ? "模型仍在回应" : connection === "connecting" ? "正在建立连接" : "连接中断，正在恢复"}
              </span>
              <span className="tabular-nums text-ink-faint">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
            </div>
            <p className="mt-2 text-ink-faint">
              {heartbeatAge < 3 ? "刚刚收到新的生成痕迹" : `${heartbeatAge} 秒前收到生成痕迹`}
            </p>
          </div>

          {(task?.status === "failed" || pageError) && (
            <div className="rounded-xl border border-cinnabar/40 bg-cinnabar/5 p-4">
              <p className="font-bold text-cinnabar">命运丝线在「{current.title}」阶段断裂</p>
              <p className="mt-2 break-words text-sm leading-6 text-ink-soft">{task?.error ?? pageError}</p>
              <div className="mt-4 flex gap-3">
                {task?.status === "failed" && (
                  <button onClick={retry} className="rounded-md border border-gilt/50 px-4 py-2 text-gilt transition hover:bg-gilt/10">
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
            const failed = active && task?.status === "failed";
            return (
              <li key={stage.id} className="relative flex min-h-14 gap-4 pb-3">
                {index < GENESIS_STAGES.length - 1 && (
                  <span className={`absolute left-[11px] top-7 h-[calc(100%-1rem)] w-px ${done ? "bg-gilt/60" : "bg-line"}`} />
                )}
                <span className={`relative z-10 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition ${
                  failed ? "border-cinnabar bg-cinnabar text-paper" : done ? "border-gilt bg-gilt text-paper" : active ? "animate-pulse border-gilt bg-paper-raised text-gilt shadow-[0_0_18px_var(--gilt-glow)]" : "border-line bg-paper-raised text-ink-faint"
                }`}>
                  {failed ? "!" : done ? "✓" : active ? "◆" : ""}
                </span>
                <div>
                  <p className={`${active ? "font-bold text-gilt" : done ? "text-ink" : "text-ink-faint"}`}>{stage.title}</p>
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
