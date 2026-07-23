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
import {
  followWorldSettlement,
  type WorldSettlementState,
} from "@/components/play/world-settlement-state";
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
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [scale, setScale] = useState<Scale>("scene");

  // 生成态：新段流式 / 另掷流式（互斥）
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [rerollingId, setRerollingId] = useState<string | null>(null);
  const [rerollingText, setRerollingText] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
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

  // ── 数据同步 ──

  /** 与后端对齐当前内部记录段消息（error 后、done 后统一调用） */
  const syncMessages = useCallback(async (cid: string) => {
    const res = await fetch(`/api/chapters/${cid}/messages`);
    if (!res.ok) return;
    const json = (await res.json()) as { messages: MessageRow[] };
    setMessages(json.messages);
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
    setMessages(enrichRewriteResultMessages(json.messages, rewrite));
  }, [worldId]);

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
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/worlds/${worldId}/state`);
        const json = (await res.json()) as PlayState & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json.error ?? "此界无从寻觅。");
          return;
        }
        setState(json);
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
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

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
      void followWorldSettlement(segmentId).then(async (result) => {
        setSettlementState(result);
        setSettling(false);
        if (result.status === "idle") {
          await reloadState();
          await syncEntityIndex();
        }
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [
    reloadState,
    rewriteBusy,
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
            if (followUp.kind === "settlement") {
              setSettling(true);
              setSettlementState({
                status: "running",
                segmentId: followUp.segmentId,
                stage: "checkpoint_read",
                completedStages: [],
              });
              const settled = await followWorldSettlement(followUp.segmentId);
              setSettlementState(settled);
              setSettling(false);
              if (settled.status === "idle") {
                await reloadState();
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
                await reloadState(completed);
                await syncEntityIndex();
              } finally {
                setRewriteBusy(false);
              }
              return;
            }
            await reloadState();
          },
          onError: async (msg) => {
            // say 的玩家消息可能已落库 → 对齐
            await syncMessages(body.chapterId);
            setStreamingText(null);
            setGenError(msg);
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
    [reloadState, syncEntityIndex, syncMessages],
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

  const doContinue = useCallback(() => {
    if (!chapterId || busyRef.current) return;
    void runChat({ chapterId, scale, mode: "continue" });
  }, [chapterId, scale, runChat]);

  /** 重试：重新对齐消息后允许再发（不自动重发） */
  const retry = useCallback(() => {
    if (!chapterId) return;
    setGenError(null);
    void syncMessages(chapterId);
  }, [chapterId, syncMessages]);

  /** 正文实体链接 / 众生录定位 */
  const openEntity = useCallback((id: string) => {
    setDrawerEntityId(id);
    setDrawerTab("codex");
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
    void followWorldSettlement(segmentId).then(async (result) => {
      setSettlementState(result);
      setSettling(false);
      if (result.status === "idle") {
        await reloadState();
        await syncEntityIndex();
      }
    });
  }, [reloadState, settlementState, syncEntityIndex]);

  // ── 渲染 ──

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        <p className="text-2xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
          此界无从寻觅
        </p>
        <p className="text-sm text-cinnabar">{loadError}</p>
        <Link href="/archives" className="text-sm text-gilt transition hover:underline">
          ← 回到往昔诸界
        </Link>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex flex-1 items-center justify-center text-ink-faint">
        展卷中…
      </main>
    );
  }

  return (
    <EntityIndexProvider index={entityIndex} openEntity={openEntity}>
      <main className="relative flex min-h-screen flex-col">
        {/* 世界名（页眉淡墨，紧凑） */}
        <header className="pointer-events-none sticky top-0 z-20 bg-gradient-to-b from-[var(--paper)] via-[var(--paper)]/80 to-transparent px-6 pb-2 pt-2 text-center">
          <span
            className="pointer-events-auto text-sm tracking-widest text-ink-faint"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {state.world.name} · {state.temporal.era} · {state.temporal.time}
          </span>
        </header>

        {/* 书页正文（中央限宽，大屏加宽） */}
        <div className="mx-auto w-full max-w-3xl flex-1 px-6 max-sm:pb-16 xl:max-w-4xl">
          <StoryStream
            messages={messages}
            streamingText={streamingText}
            rerollingId={rerollingId}
            rerollingText={rerollingText}
            busy={anyBusy}
            error={genError}
            onRetry={retry}
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
          />
        </div>

        {/* 右缘符文列 + 抽屉 */}
        <RuneRail mode={state.world.mode} active={drawerTab} onOpen={(t) => setDrawerTab(t)} />
        <PlayDrawer
          tab={drawerTab}
          world={state.world}
          gods={state.gods}
          timeline={state.timeline}
          avatars={state.avatars}
          recentRewrite={state.recentRewrite}
          busyKinds={{ chat: busy, settlement: settling, rewrite: rewriteBusy }}
          initialEntityId={drawerEntityId}
          onStateChanged={() => reloadState()}
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
