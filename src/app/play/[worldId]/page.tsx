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
import { RuneRail } from "@/components/play/RuneRail";
import { PlayDrawer } from "@/components/play/PlayDrawer";

/**
 * 对局主界面（M1.6–M1.8）：中央书页正文 + 底部输入区 + 右缘符文列/抽屉。
 * 编排：GET state → （空章）自动 opening → say/continue/reroll SSE 流。
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

  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(null);

  const chapterId = state?.currentChapter.id;

  // ── 数据同步 ──

  /** 与后端对齐当前章消息（error 后、done 后统一调用） */
  const syncMessages = useCallback(async (cid: string) => {
    const res = await fetch(`/api/chapters/${cid}/messages`);
    if (!res.ok) return;
    const json = (await res.json()) as { messages: MessageRow[] };
    setMessages(json.messages);
  }, []);

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
        if (last && ["scene", "era", "epoch"].includes(last.scale)) {
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
      let acc = "";
      await streamNarration("/api/chat", body, {
        onText: (t) => {
          acc += t;
          setStreamingText(acc);
        },
        onDone: async () => {
          // narrator 已落库 → 拉取对齐（含玩家消息与 meta）
          await syncMessages(body.chapterId);
          setStreamingText(null);
        },
        onError: async (msg) => {
          // say 的玩家消息可能已落库 → 对齐
          await syncMessages(body.chapterId);
          setStreamingText(null);
          setGenError(msg);
        },
      });
    },
    [syncMessages],
  );

  // 空章自动开场（严格模式防抖：仅触发一次；defer 避免 effect 内同步 setState）
  const openingFired = useRef(false);
  useEffect(() => {
    if (!state || !chapterId || openingFired.current) return;
    if (state.messages.length > 0 || state.prevChapterTail.length > 0) return;
    openingFired.current = true;
    const t = setTimeout(() => {
      void runChat({ chapterId, scale: "scene", mode: "opening" });
    }, 0);
    return () => clearTimeout(t);
  }, [state, chapterId, runChat]);

  // ── 输入区动作 ──

  const send = useCallback(
    (content: string) => {
      if (!chapterId || busyRef.current) return;
      void runChat({ chapterId, content, scale, mode: "say" });
    },
    [chapterId, scale, runChat],
  );

  const doContinue = useCallback(
    (directive?: string) => {
      if (!chapterId || busyRef.current) return;
      void runChat({ chapterId, scale, mode: "continue", directive });
    },
    [chapterId, scale, runChat],
  );

  /** 重试：重新对齐消息后允许再发（不自动重发） */
  const retry = useCallback(() => {
    if (!chapterId) return;
    setGenError(null);
    void syncMessages(chapterId);
  }, [chapterId, syncMessages]);

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
      let acc = "";
      void streamNarration(`/api/messages/${id}/variants`, {}, {
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
      });
    },
    [chapterId, syncMessages],
  );

  // ── 派生：AI 建议 / 翻章提示（最新 narrator 消息） ──

  const lastNarrator = [...messages].reverse().find((m) => m.role === "narrator");
  const lastMeta: MessageMeta = lastNarrator?.meta ?? {};
  const isLatest = lastNarrator && lastNarrator.index === messages.at(-1)?.index;
  const suggestions = isLatest ? (lastMeta.suggestions ?? []) : [];
  const chapterBreakHint = isLatest ? lastMeta.chapterBreakHint === true : false;

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
    <main className="relative flex min-h-screen flex-col">
      {/* 世界名（页眉淡墨） */}
      <header className="pointer-events-none sticky top-0 z-20 bg-gradient-to-b from-[var(--paper)] via-[var(--paper)]/80 to-transparent px-6 pb-4 pt-3 text-center">
        <span
          className="pointer-events-auto text-sm tracking-widest text-ink-faint"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {state.world.name}
        </span>
      </header>

      {/* 书页正文（中央限宽） */}
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 max-sm:pb-16">
        <StoryStream
          chapterIndex={state.currentChapter.index}
          chapterTitle={state.currentChapter.title}
          prevTail={state.prevChapterTail}
          messages={messages}
          streamingText={streamingText}
          rerollingId={rerollingId}
          rerollingText={rerollingText}
          busy={busy}
          error={genError}
          onRetry={retry}
          onEdit={edit}
          onCut={cut}
          onReroll={reroll}
          onSwitchVariant={switchVariant}
        />

        <InputDeck
          scale={scale}
          onScaleChange={setScale}
          suggestions={suggestions}
          chapterBreakHint={chapterBreakHint}
          busy={busy}
          canContinue={messages.length > 0}
          onSend={send}
          onContinue={doContinue}
        />
      </div>

      {/* 右缘符文列 + 抽屉 */}
      <RuneRail active={drawerTab} onOpen={(t) => setDrawerTab(t)} />
      <PlayDrawer
        tab={drawerTab}
        world={state.world}
        gods={state.gods}
        onClose={() => setDrawerTab(null)}
      />
    </main>
  );
}
