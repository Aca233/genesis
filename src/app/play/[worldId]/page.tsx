"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Scale } from "@/lib/cards/schemas";
import type {
  DrawerTab,
  MessageMeta,
  MessageRow,
  PlayState,
} from "@/components/play/types";
import { streamNarration } from "@/components/play/sse-client";
import { StoryStream } from "@/components/play/StoryStream";
import { InputDeck } from "@/components/play/InputDeck";
import {
  enrichRewriteResultMessages,
  followRealityRewriteEvents,
  type RealityRewriteView,
} from "@/components/play/creator-input-state";
import { switchCreatorReality } from "@/components/play/reality-tree-state";
import { RuneRail } from "@/components/play/RuneRail";
import { PlayDrawer } from "@/components/play/PlayDrawer";
import { PlayBackground } from "@/components/play/PlayBackground";
import { PlayHeader } from "@/components/play/PlayHeader";
import type { WorldActivityResponse } from "@/components/play/WorldActivityPanel";
import {
  advanceActivityCursor,
  countUnreadActivities,
  type ActivityCursor,
} from "@/components/play/world-activity-panel-state";
import {
  followWorldSettlement,
  type WorldSettlementState,
} from "@/components/play/world-settlement-state";
import {
  reduceTaskProgress,
  type TaskProgressView,
} from "@/components/play/task-progress-state";
import type { DurableTaskProgress } from "@/lib/tasks/progress";
import {
  EntityIndexProvider,
  type EntityIndexItem,
} from "@/components/play/entity-index";

/**
 * 对局主界面（M1.6–M1.8）：中央书页正文 + 底部输入区 + 右缘符文列/抽屉。
 * 编排：GET state → （空现实）自动 opening → say/continue/reroll SSE 流。
 */

export default function PlayPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = use(params);

  const [state, setState] = useState<PlayState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [scale, setScale] = useState<Scale>("scene");

  // 生成态：新段流式 / 另掷流式（互斥）
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [rerollingId, setRerollingId] = useState<string | null>(null);
  const [rerollingText, setRerollingText] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<TaskProgressView | null>(null);
  const busy = streamingText !== null || rerollingId !== null;
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // 当前生成的中止句柄（搁笔）
  const abortRef = useRef<AbortController | null>(null);

  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(null);
  /** 正文实体链接点开时定位的实体（进入众生录详情） */
  const [drawerEntityId, setDrawerEntityId] = useState<string | null>(null);
  const [drawerGodId, setDrawerGodId] = useState<string | null>(null);
  const [unreadActivityCount, setUnreadActivityCount] = useState(0);

  // 自动世界整理
  const [settling, setSettling] = useState(false);
  const [settlementState, setSettlementState] = useState<WorldSettlementState>({
    status: "idle",
  });
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [openingChapterId, setOpeningChapterId] = useState<string | null>(null);
  const anyBusy = busy || settling || rewriteBusy;

  // 正文实体微光链接索引
  const [entityIndex, setEntityIndex] = useState<EntityIndexItem[]>([]);

  const chapterId = state?.currentSegment?.id ?? state?.currentChapter.id;
  const activityCursorKey = state
    ? `genesis:activity-cursor:${worldId}:${state.timeline.id}`
    : null;

  const readActivityCursor = useCallback((): ActivityCursor | null => {
    if (!activityCursorKey) return null;
    try {
      const value = window.localStorage.getItem(activityCursorKey);
      return value ? JSON.parse(value) as ActivityCursor : null;
    } catch {
      return null;
    }
  }, [activityCursorKey]);

  const markActivitiesRead = useCallback((data: WorldActivityResponse) => {
    if (!activityCursorKey) return;
    const cursor = advanceActivityCursor(data.recentActivities, readActivityCursor());
    if (cursor) window.localStorage.setItem(activityCursorKey, JSON.stringify(cursor));
    setUnreadActivityCount(0);
  }, [activityCursorKey, readActivityCursor]);

  // ── 数据同步 ──

  /** 与后端对齐当前内部记录段消息（error 后、done 后统一调用）；返回对齐后的行，失败返回 null */
  const syncMessages = useCallback(async (cid: string): Promise<MessageRow[] | null> => {
    const res = await fetch(`/api/chapters/${cid}/messages`);
    if (!res.ok) return null;
    const json = (await res.json()) as { messages: MessageRow[] };
    setMessages(json.messages);
    return json.messages;
  }, []);

  /** 完整重载当前活动现实，并在时间线变化时重置章节/开场引用。 */
  const reloadState = useCallback(async (rewrite?: RealityRewriteView) => {
    const response = await fetch(`/api/worlds/${worldId}/state`);
    const json = (await response.json().catch(() => null)) as (PlayState & { error?: string }) | null;
    if (!response.ok || json === null) throw new Error(json?.error ?? "世界状态重载失败");
    setState((previous) => {
      if (previous?.timeline.id !== json.timeline.id) {
        setOpeningChapterId(null);
        abortRef.current?.abort();
        abortRef.current = null;
        setStreamingText(null);
        setRerollingId(null);
        setRerollingText("");
        setGenError(null);
        setDrawerEntityId(null);
      }
      return json;
    });
    setTaskProgress((current) => json.taskProgress
      ? reduceTaskProgress(current, json.taskProgress)
      : null);
    setMessages(enrichRewriteResultMessages(json.messages, rewrite));
  }, [worldId]);

  /** 重载失败不再静默：错误落到叙事错误行（需要抛错语义的调用处仍用 reloadState） */
  const safeReload = useCallback(
    (rewrite?: RealityRewriteView) => reloadState(rewrite).catch((e) => {
      setGenError(e instanceof Error ? e.message : String(e));
    }),
    [reloadState],
  );

  /** 结算 SSE 进度 → 任务进度条（○●✓）+ 当前阶段（输入区提示行） */
  const handleSettlementProgress = useCallback(
    (segmentId: string) =>
      (event: { stage: string; status: "running" | "completed"; occurredAt: string }) => {
        setSettlementState((current) => (
          current.status === "running" && current.segmentId === segmentId
            ? { ...current, stage: event.stage }
            : current
        ));
        setTaskProgress((current) => reduceTaskProgress(current, {
          taskKind: "settlement",
          taskId: segmentId,
          stage: event.stage,
          status: event.status,
          retryable: true,
          updatedAt: event.occurredAt,
        }));
      },
    [],
  );

  /** 实体索引（正文微光链接）：加载时 + 结算后刷新 */
  const syncEntityIndex = useCallback(async () => {
    try {
      const res = await fetch(`/api/worlds/${worldId}/entity-index`);
      if (!res.ok) return;
      const json = (await res.json()) as { index: EntityIndexItem[] };
      setEntityIndex(json.index);
    } catch {
      // 索引失败不阻断对局，正文只是无链接
    }
  }, [worldId]);

  useEffect(() => {
    const returnToReality = (event: Event) => {
      const sourceTimelineId = (event as CustomEvent<{ sourceTimelineId?: string }>).detail?.sourceTimelineId;
      const expectedActiveId = state?.timeline.id;
      if (!sourceTimelineId || !expectedActiveId || anyBusy) return;
      setRewriteBusy(true);
      void switchCreatorReality({
        worldId,
        targetTimelineId: sourceTimelineId,
        expectedActiveId,
        reload: async () => {
          await reloadState();
          await syncEntityIndex();
        },
      }).then(() => {
        setDrawerTab("realities");
      }).catch((reason) => {
        setGenError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => {
        setRewriteBusy(false);
      });
    };
    window.addEventListener("creator:return-reality", returnToReality);
    return () => window.removeEventListener("creator:return-reality", returnToReality);
  }, [anyBusy, reloadState, state?.timeline.id, syncEntityIndex, worldId]);

  useEffect(() => {
    const openRealities = () => setDrawerTab("realities");
    window.addEventListener("creator:open-realities", openRealities);
    return () => window.removeEventListener("creator:open-realities", openRealities);
  }, []);

  useEffect(() => {
    // defer：避免 effect 内同步 setState（索引到达前正文只是无链接）
    const t = setTimeout(() => void syncEntityIndex(), 0);
    return () => clearTimeout(t);
  }, [syncEntityIndex]);

  useEffect(() => {
    if (!state) return;
    const controller = new AbortController();
    void fetch(`/api/worlds/${worldId}/activities`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as WorldActivityResponse;
      })
      .then((data) => {
        if (!data || controller.signal.aborted) return;
        if (drawerTab === "activity") {
          markActivitiesRead(data);
          return;
        }
        setUnreadActivityCount(countUnreadActivities(
          data.recentActivities,
          readActivityCursor(),
        ));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [
    drawerTab,
    markActivitiesRead,
    messages.length,
    readActivityCursor,
    state,
    worldId,
  ]);

  /** 初始加载（错误卡片「重试」可重调）；序号护栏丢弃过期请求的写入 */
  const loadSeqRef = useRef(0);
  const loadInitial = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const stale = () => loadSeqRef.current !== seq;
    try {
      const res = await fetch(`/api/worlds/${worldId}/state`);
      const json = (await res.json().catch(() => null)) as
        | (PlayState & { error?: string })
        | null;
      if (stale()) return;
      if (!res.ok || json === null) {
        // 原始技术信息仅入控制台，界面展示主题化中文文案
        console.error(`世界状态读取失败（HTTP ${res.status}）`);
        setLoadErrorStatus(res.status);
        setLoadError(json?.error ?? (res.status === 404
          ? "此界不存在或早已消散。"
          : "星轨紊乱：世界状态读取失败，请稍后再试。"));
        return;
      }
      setState(json);
      setTaskProgress((current) => json.taskProgress
        ? reduceTaskProgress(current, json.taskProgress)
        : null);
      setMessages(json.messages);
      // 初始尺度沿用最后一条消息
      const last = json.messages.at(-1);
      if (
        last &&
        ["moment", "scene", "years", "era", "epoch"].includes(last.scale)
      ) {
        setScale(last.scale as Scale);
      }
    } catch (err) {
      if (!stale()) {
        console.error(err);
        setLoadErrorStatus(null);
        setLoadError("星轨紊乱：世界状态读取失败，请稍后再试。");
      }
    }
  }, [worldId]);

  useEffect(() => {
    // defer：避免 effect 内同步 setState
    const t = setTimeout(() => void loadInitial(), 0);
    return () => {
      clearTimeout(t);
      loadSeqRef.current += 1;
    };
  }, [loadInitial]);

  useEffect(() => {
    if (
      !state
      || settling
      || rewriteBusy
      || settlementState.status !== "idle"
      || (!state.checkpoint.needsSettlement && !state.checkpoint.settling)
    ) return;
    const segmentId = state.checkpoint.segmentId;
    const timer = setTimeout(() => {
      setSettling(true);
      setSettlementState({
        status: "running",
        segmentId,
        stage: "checkpoint_read",
        completedStages: [],
      });
      void followWorldSettlement(
        segmentId,
        fetch,
        handleSettlementProgress(segmentId),
      ).then(async (result) => {
        setSettlementState(result);
        setSettling(false);
        setTaskProgress(null);
        if (result.status === "idle") {
          await safeReload();
          await syncEntityIndex();
        }
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [
    handleSettlementProgress,
    rewriteBusy,
    safeReload,
    settlementState.status,
    settling,
    state,
    syncEntityIndex,
  ]);

  // ── SSE 生成 ──

  /** 新段生成（say / continue / opening）：追加流式块，done 后对齐消息 */
  const runChat = useCallback(
    async (body: {
      chapterId: string;
      content?: string;
      scale: Scale;
      mode: "say" | "continue" | "opening";
      directive?: string;
    }) => {
      setGenError(null);
      setStreamingText("");
      const ac = new AbortController();
      const requestBody = { ...body, generationId: crypto.randomUUID() };
      abortRef.current = ac;
      let acc = "";
      await streamNarration(
        "/api/chat",
        requestBody,
        {
          onText: (t) => {
            acc += t;
            setStreamingText(acc);
          },
          onDone: async (_messageId, _meta, followUp) => {
            // narrator 已落库 → 拉取对齐（含玩家消息与 meta）
            setStreamingText(null);
            setTaskProgress(null);
            if (followUp.kind === "settlement") {
              setSettling(true);
              setSettlementState({
                status: "running",
                segmentId: followUp.segmentId,
                stage: "checkpoint_read",
                completedStages: [],
              });
              const settled = await followWorldSettlement(
                followUp.segmentId,
                fetch,
                handleSettlementProgress(followUp.segmentId),
              );
              setSettlementState(settled);
              setSettling(false);
              setTaskProgress(null);
              if (settled.status === "idle") {
                await safeReload();
                await syncEntityIndex();
              }
              return;
            }
            if (followUp.kind === "rewrite") {
              setRewriteBusy(true);
              try {
                const completed = await followRealityRewriteEvents(
                  followUp.taskId,
                  () => undefined,
                );
                await safeReload(completed);
                await syncEntityIndex();
              } finally {
                setRewriteBusy(false);
              }
              return;
            }
            await safeReload();
          },
          onError: async (msg) => {
            // say 的玩家消息可能已落库 → 对齐
            await syncMessages(body.chapterId);
            setGenError(msg);
          },
          onProgress: (event) => {
            const durable: DurableTaskProgress = {
              taskKind: event.taskKind,
              taskId: event.taskId,
              stage: event.stage,
              status: event.status === "completed" && event.stage === "completed"
                ? "completed"
                : "running",
              retryable: true,
              updatedAt: event.occurredAt,
            };
            setTaskProgress((current) => reduceTaskProgress(current, durable));
          },
          onFailed: (event) => {
            setTaskProgress((current) => reduceTaskProgress(current, {
              taskKind: "chat",
              taskId: event.taskId,
              stage: event.stage,
              status: "failed",
              retryable: event.retryable,
              safeError: event.message,
              updatedAt: new Date().toISOString(),
            }));
          },
        },
        ac.signal,
      );
      // 搁笔中止：服务端可能已（或未）落库，统一对齐
      if (ac.signal.aborted) {
        await syncMessages(body.chapterId);
        setStreamingText(null);
      }
      abortRef.current = null;
    },
    [handleSettlementProgress, safeReload, syncEntityIndex, syncMessages],
  );

  /** 搁笔：中止当前生成（已写出的文字由对齐结果决定去留） */
  const stopGen = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 异常恢复：已开局现实完全无正文时，续跑同一 opening。
  useEffect(() => {
    if (!state || !chapterId || openingChapterId === chapterId) return;
    if (state.messages.length > 0) return;
    const t = setTimeout(() => {
      setOpeningChapterId(chapterId);
      void runChat({ chapterId, scale: "scene", mode: "opening" });
    }, 0);
    return () => clearTimeout(t);
  }, [state, chapterId, openingChapterId, runChat]);

  // ── 输入区动作 ──

  const send = useCallback(
    (content: string) => {
      if (!chapterId || busyRef.current) return;
      void runChat({ chapterId, content, scale, mode: "say" });
    },
    [chapterId, scale, runChat],
  );

  const doContinue = useCallback((directive?: string) => {
    if (!chapterId || busyRef.current) return;
    void runChat({
      chapterId,
      scale,
      mode: "continue",
      ...(directive ? { directive } : {}),
    });
  }, [chapterId, scale, runChat]);

  /** 重试：重新对齐消息后允许再发（不自动重发）——任务条恢复入口沿用 */
  const retry = useCallback(() => {
    if (!chapterId) return;
    setGenError(null);
    void syncMessages(chapterId);
  }, [chapterId, syncMessages]);

  /** 叙事错误行「重试」：对齐后按缺失情形真正重新落笔 */
  const retryNarrative = useCallback(async () => {
    if (!chapterId || busyRef.current) return;
    setGenError(null);
    const rows = await syncMessages(chapterId);
    if (rows === null) return; // 对齐失败不盲动
    if (rows.length === 0) {
      // opening 失败：让开场 effect 重跑
      setOpeningChapterId(null);
      return;
    }
    if (rows.at(-1)?.role === "player") {
      // 神谕已落库而史官未回 → 续写
      await runChat({ chapterId, scale, mode: "continue" });
    }
  }, [chapterId, runChat, scale, syncMessages]);

  /** 正文实体链接 / 众生录定位 */
  const openEntity = useCallback((id: string) => {
    setDrawerEntityId(id);
    setDrawerTab("codex");
  }, []);

  const openGod = useCallback((id: string) => {
    setDrawerGodId(id);
    setDrawerTab("god");
  }, []);

  // ── 消息四件套 ──

  /** 朱批：PATCH 后以响应行替换本地 */
  const edit = useCallback(async (id: string, content: string) => {
    const res = await fetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return;
    const { message } = (await res.json()) as { message: MessageRow };
    setMessages((ms) => ms.map((m) => (m.id === id ? message : m)));
  }, []);

  /** 裁去：DELETE 后本地移除该条及其后 */
  const cut = useCallback(
    async (id: string) => {
      const target = messages.find((m) => m.id === id);
      const res = await fetch(`/api/messages/${id}`, { method: "DELETE" });
      if (!res.ok || !target) return;
      setMessages((ms) => ms.filter((m) => m.index < target.index));
      setGenError(null);
    },
    [messages],
  );

  /** 切换异文定稿 */
  const switchVariant = useCallback(async (id: string, index: number) => {
    const res = await fetch(`/api/messages/${id}/variants`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    });
    if (!res.ok) return;
    const { message } = (await res.json()) as { message: MessageRow };
    setMessages((ms) => ms.map((m) => (m.id === id ? message : m)));
  }, []);

  /** 另掷异文：SSE 流式替换该消息内容显示，done 后对齐 */
  const reroll = useCallback(
    (id: string) => {
      if (!chapterId || busyRef.current) return;
      setGenError(null);
      setRerollingId(id);
      setRerollingText("");
      const ac = new AbortController();
      abortRef.current = ac;
      let acc = "";
      void streamNarration(
        `/api/messages/${id}/variants`,
        {},
        {
          onText: (t) => {
            acc += t;
            setRerollingText(acc);
          },
          onDone: async () => {
            await syncMessages(chapterId);
            setRerollingId(null);
            setRerollingText("");
          },
          onError: async (msg) => {
            await syncMessages(chapterId);
            setRerollingId(null);
            setRerollingText("");
            setGenError(msg);
          },
        },
        ac.signal,
      ).then(async () => {
        if (ac.signal.aborted) {
          await syncMessages(chapterId);
          setRerollingId(null);
          setRerollingText("");
        }
        abortRef.current = null;
      });
    },
    [chapterId, syncMessages],
  );

  // ── 派生：AI 建议（最新 narrator 消息） ──

  const lastNarrator = [...messages].reverse().find((m) => m.role === "narrator");
  const lastMeta: MessageMeta = lastNarrator?.meta ?? {};
  const isLatest = lastNarrator && lastNarrator.index === messages.at(-1)?.index;
  const suggestions = isLatest ? (lastMeta.suggestions ?? []) : [];
  const retrySettlement = useCallback(() => {
    if (settlementState.status !== "failed") return;
    const segmentId = settlementState.segmentId;
    setSettling(true);
    setSettlementState({
      status: "running",
      segmentId,
      stage: settlementState.stage,
      completedStages: settlementState.completedStages,
    });
    void followWorldSettlement(
      segmentId,
      fetch,
      handleSettlementProgress(segmentId),
    ).then(async (result) => {
      setSettlementState(result);
      setSettling(false);
      setTaskProgress(null);
      if (result.status === "idle") {
        await safeReload();
        await syncEntityIndex();
      }
    });
  }, [handleSettlementProgress, safeReload, settlementState, syncEntityIndex]);

  // ── 渲染 ──

  if (loadError) {
    return (
      <main className="play-shell flex min-h-screen flex-1 items-center justify-center px-6">
        <PlayBackground />
        <div className="genesis-status-panel flex flex-col items-center gap-4 text-center">
          <p className="text-2xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
            {loadErrorStatus === 404 ? "此界无从寻觅" : "星轨紊乱，此界暂不可入"}
          </p>
          <p className="text-sm text-cinnabar">{loadError}</p>
          <div className="flex items-center gap-5">
            <Link href="/archives" className="text-sm text-gilt transition hover:underline">
              ← 回到往昔诸界
            </Link>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setLoadErrorStatus(null);
                void loadInitial();
              }}
              className="rounded-md border border-gilt/50 bg-gilt/5 px-4 py-1 text-sm text-gilt transition hover:bg-gilt/15"
            >
              重试
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="play-shell flex min-h-screen flex-1 items-center justify-center px-6">
        <PlayBackground />
        <p className="genesis-status-panel text-ink-faint">展卷中…</p>
      </main>
    );
  }

  return (
    <EntityIndexProvider index={entityIndex} openEntity={openEntity}>
      <main className="play-shell relative flex min-h-screen flex-col">
        <PlayBackground />
        <PlayHeader
          worldId={state.world.id}
          worldName={state.world.name}
          era={state.temporal.era}
          time={state.temporal.time}
          iconTheme={state.world.iconTheme}
          iconThemeRevision={state.world.iconThemeRevision}
          onThemeChanged={() => { void safeReload(); }}
        />

        {/* 书页正文（中央限宽，大屏加宽） */}
        <div className="mx-auto w-full max-w-3xl flex-1 px-6 max-sm:pb-16 xl:max-w-4xl">
          <StoryStream
            mode={state.world.mode}
            messages={messages}
            streamingText={streamingText}
            rerollingId={rerollingId}
            rerollingText={rerollingText}
            busy={anyBusy}
            error={genError}
            onRetry={retryNarrative}
            onEdit={edit}
            onCut={cut}
            onReroll={reroll}
            onSwitchVariant={switchVariant}
          />

          <InputDeck
            mode={state.world.mode}
            scale={scale}
            onScaleChange={setScale}
            suggestions={suggestions}
            busyKind={settling
              ? "settling"
              : rewriteBusy
                ? "rewriting"
                : busy ? "narrating" : "idle"}
            canContinue={messages.length > 0}
            onSend={send}
            onContinue={doContinue}
            onStop={stopGen}
            settlementError={settlementState.status === "failed"
              ? settlementState.error
              : null}
            onRetrySettlement={retrySettlement}
            settlementStage={settlementState.status === "running"
              ? settlementState.stage
              : null}
            taskProgress={taskProgress}
            onRetryTask={retry}
            onRefreshWorld={() => { void safeReload(); }}
          />
        </div>

        {/* 右缘符文列 + 抽屉 */}
        <RuneRail
          mode={state.world.mode}
          icons={state.world.navigationIcons}
          active={drawerTab}
          unreadActivityCount={unreadActivityCount}
          onOpen={(tab) => {
            if (tab === "god") setDrawerGodId(null);
            setDrawerTab(tab);
          }}
        />
        <PlayDrawer
          tab={drawerTab}
          world={state.world}
          gods={state.gods}
          timeline={state.timeline}
          avatars={state.avatars}
          recentRewrite={state.recentRewrite}
          busyKinds={{ chat: busy, settlement: settling, rewrite: rewriteBusy }}
          initialEntityId={drawerEntityId}
          initialGodId={drawerGodId}
          onOpenEntity={openEntity}
          onOpenGod={openGod}
          onActivitiesLoaded={markActivitiesRead}
          onStateChanged={() => safeReload()}
          onTimelineChanged={async () => {
            await reloadState();
            await syncEntityIndex();
          }}
          onClose={() => {
            setDrawerTab(null);
            setDrawerEntityId(null);
          }}
        />

      </main>
    </EntityIndexProvider>
  );
}
