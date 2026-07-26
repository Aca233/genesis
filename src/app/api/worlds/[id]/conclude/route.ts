import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import { FinaleSchema, finaleSystem, finaleUserPrompt } from "@/lib/prompts/finale";
import { resolveTemporalState } from "@/lib/chat/continuous-state";
import {
  OPERATION_LEASE_RENEW_MS,
  WorldOperationConflictError,
  claimWorldOperation,
  releaseWorldOperation,
  renewWorldOperation,
  type WorldOperationClient,
} from "@/lib/reality/operation-lock";

/**
 * POST /api/worlds/[id]/conclude —— 陨灭终章：玩家神陨灭后将此界写入史册。
 * 复用 settlement 操作租约：与叙事/整理/改写天然互斥。成功后
 * world.status=concluded + 当前章 settled（既有只读锁双重生效）；
 * LLM 或事务失败时世界保持 playing，可重试。
 */

export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const world = await prisma.world.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      mode: true,
      status: true,
      activeTimelineId: true,
      styleCard: true,
      themeCard: true,
      // 纪元回退链与 state 路由同款（draftDeck.epochConflict → themeCard.eraSystem）
      draftDeck: true,
    },
  });
  if (world === null) {
    return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  }
  if (world.mode !== "pantheon") {
    return NextResponse.json({ error: "唯共世诸神之界有陨灭终章" }, { status: 400 });
  }
  if (world.status !== "playing") {
    return NextResponse.json({ error: "此界当前不可成史" }, { status: 409 });
  }
  if (!world.activeTimelineId) {
    return NextResponse.json({ error: "世界尚未开局（无活动时间线）" }, { status: 404 });
  }
  const timelineId = world.activeTimelineId;

  const playerGod = await prisma.god.findFirst({
    where: { timelineId, isPlayer: true },
  });
  if (playerGod === null) {
    return NextResponse.json({ error: "玩家神不存在" }, { status: 404 });
  }
  if (playerGod.rank !== "fallen") {
    return NextResponse.json({ error: "神焰未熄，终章不可强书" }, { status: 409 });
  }

  const currentChapter = await prisma.chapter.findFirst({
    where: { timelineId },
    orderBy: { index: "desc" },
    select: { id: true, index: true, settleState: true },
  });
  if (currentChapter === null) {
    return NextResponse.json({ error: "时间线尚无内部记录段" }, { status: 404 });
  }
  if (currentChapter.settleState !== "open") {
    return NextResponse.json({ error: "此段整理未竟，请先完成世界整理" }, { status: 409 });
  }

  const db = prisma as unknown as WorldOperationClient;
  const token = crypto.randomUUID();
  const operation = await claimWorldOperation(db, id, "settlement", token);
  if (!operation.acquired) {
    return NextResponse.json(
      { error: new WorldOperationConflictError(operation.activeKind).message },
      { status: 409 },
    );
  }
  const heartbeat = setInterval(
    () => void renewWorldOperation(db, id, "settlement", token),
    OPERATION_LEASE_RENEW_MS,
  );
  try {
    // ── 组装终章上下文 ──
    const [timeline, chronicleDesc, chosen, gods, proseChapters] = await Promise.all([
      prisma.timeline.findUnique({
        where: { id: timelineId },
        select: { realityState: true, observerState: true },
      }),
      prisma.chronicleEntry.findMany({
        where: { timelineId, revealed: true },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { yearLabel: true, text: true },
      }),
      prisma.entity.findMany({
        where: { timelineId, isChosen: true },
        select: { name: true, summary: true },
      }),
      prisma.god.findMany({
        where: { timelineId },
        orderBy: { createdAt: "asc" },
        select: { name: true, rank: true, isPlayer: true },
      }),
      // 当前章 + 上一章正文尾部（截断在 finaleUserPrompt 内完成）
      prisma.chapter.findMany({
        where: {
          timelineId,
          index: { in: [currentChapter.index - 1, currentChapter.index] },
        },
        orderBy: { index: "asc" },
        select: {
          messages: { orderBy: { index: "asc" }, select: { content: true } },
        },
      }),
    ]);

    const draftDeck = world.draftDeck && typeof world.draftDeck === "object"
      ? world.draftDeck as { epochConflict?: { epochName?: string; yearLabel?: string } }
      : null;
    const temporal = resolveTemporalState({
      realityState: timeline?.realityState ?? null,
      observerState: timeline?.observerState ?? null,
      epochName: draftDeck?.epochConflict?.epochName ?? null,
      yearLabel: draftDeck?.epochConflict?.yearLabel ?? null,
      eraSystem: world.themeCard && typeof world.themeCard === "object"
        ? (world.themeCard as { eraSystem?: string }).eraSystem
        : null,
    });

    const finale = await completeStructured("backstage", {
      task: "finale",
      system: finaleSystem(),
      user: finaleUserPrompt({
        worldName: world.name,
        styleCard: world.styleCard,
        themeCard: world.themeCard,
        era: temporal.era,
        time: temporal.time,
        playerGod: `${playerGod.name}｜位阶：${playerGod.rank}｜领域：${playerGod.domains.join("、") || "—"}｜信仰疆域：${playerGod.faithScope ?? "—"}`,
        gods: gods
          .map((god) => `${god.name}（${god.rank}${god.isPlayer ? "，玩家神" : ""}）`)
          .join("\n"),
        chosen: chosen.map((entity) => `${entity.name}：${entity.summary}`).join("\n"),
        recentChronicle: [...chronicleDesc]
          .reverse()
          .map((entry) => `[${entry.yearLabel}] ${entry.text}`)
          .join("\n"),
        recentProse: proseChapters
          .flatMap((chapter) => chapter.messages)
          .map((message) => message.content)
          .join("\n\n"),
      }),
      schema: FinaleSchema,
      maxTokens: 8000,
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
    });

    const messageId = await prisma.$transaction(async (tx) => {
      // CAS：并发切线 / 二次提交时整体回滚，世界保持 playing
      const concluded = await tx.world.updateMany({
        where: { id, status: "playing", activeTimelineId: timelineId },
        data: { status: "concluded" },
      });
      if (concluded.count !== 1) {
        throw new Error("此界状态已变化，请刷新后重试");
      }
      const lastMessage = await tx.message.findFirst({
        where: { chapterId: currentChapter.id },
        orderBy: { index: "desc" },
        select: { index: true },
      });
      const saved = await tx.message.create({
        data: {
          id: crypto.randomUUID(),
          chapterId: currentChapter.id,
          index: (lastMessage?.index ?? 0) + 1,
          role: "narrator",
          content: finale.finaleProse,
          scale: "epoch",
          meta: { kind: "finale", suggestions: [] } as Prisma.InputJsonValue,
        },
      });
      for (const entry of finale.chronicleEntries) {
        await tx.chronicleEntry.create({
          data: {
            timelineId,
            chapterIndex: currentChapter.index,
            yearLabel: entry.yearLabel,
            text: entry.text,
            entityIds: [],
            godIds: [playerGod.id],
            revealed: true,
            source: "narrative",
          },
        });
      }
      const settled = await tx.chapter.updateMany({
        where: { id: currentChapter.id, settleState: "open" },
        data: { settleState: "settled" },
      });
      if (settled.count !== 1) {
        throw new Error("当前记录段状态已变化，请刷新后重试");
      }
      return saved.id;
    });

    return NextResponse.json({ messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `终章未能落笔：${message}` },
      { status: 500 },
    );
  } finally {
    clearInterval(heartbeat);
    await releaseWorldOperation(db, id, "settlement", token);
  }
}
