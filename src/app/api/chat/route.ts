import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ScaleSchema } from "@/lib/cards/schemas";
import { buildNarratorContext } from "@/lib/context/builder";
import { narratorCompletionSSE, narratorSSE } from "@/lib/context/sse";
import {
  finalizeNarration,
  type NarrationFinalizationClient,
} from "@/lib/chat/finalize";
import {
  prepareGenerationRequest,
  readGenerationCompletion,
  markGenerationFailed,
  OpeningGenerationConflictError,
  type GenerationRequestClient,
} from "@/lib/chat/request";

/**
 * POST /api/chat —— 叙事主循环（SSE 流）
 * body: { chapterId, content?, scale, mode: "say"|"continue"|"opening", directive? }
 * - say：先落玩家 Message，再流式生成 narrator 回复
 * - continue：不落玩家消息，附幕后导演提示续写
 * - opening：第一章开场演出（仅当章内无消息时允许）
 */

export const maxDuration = 300;

const BodySchema = z.object({
  chapterId: z.string().min(1),
  content: z.string().optional(),
  scale: ScaleSchema,
  mode: z.enum(["say", "continue", "opening"]),
  directive: z.string().max(1000).optional(),
  generationId: z.string().min(8).max(128).optional(),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求体不合法" }, { status: 400 });
  }
  const { chapterId, content, scale, mode, directive } = parsed.data;
  const generationId = parsed.data.generationId ?? crypto.randomUUID();

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: {
      timeline: { select: { id: true, worldId: true } },
      messages: { orderBy: { index: "desc" }, take: 1 },
    },
  });
  if (!chapter) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }
  if (chapter.settleState !== "open") {
    return NextResponse.json({ error: "本章已成史，不可续写" }, { status: 409 });
  }

  const lastIndex = chapter.messages[0]?.index ?? 0;

  if (mode === "say" && !content?.trim()) {
    return NextResponse.json({ error: "神谕不能为空" }, { status: 400 });
  }
  // 在任何玩家消息写入前，以 generationId 原子校验/保留整次请求协议。
  const proposedPlayerIndex = mode === "say" ? lastIndex + 1 : null;
  const proposedNarratorIndex = mode === "opening" ? 1 : lastIndex + (mode === "say" ? 2 : 1);
  let prepared;
  try {
    prepared = await prepareGenerationRequest(
      prisma as unknown as GenerationRequestClient,
      {
        generationId,
        chapterId,
        mode,
        scale,
        content: mode === "say" ? content!.trim() : undefined,
        directive: directive?.trim() || undefined,
        playerIndex: proposedPlayerIndex,
        narratorIndex: proposedNarratorIndex,
        chapterHasMessages: lastIndex > 0,
      },
    );
  } catch (error) {
    if (error instanceof OpeningGenerationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  if (prepared.state === "completed") {
    return narratorCompletionSSE({ completion: prepared.completion, signal: request.signal });
  }
  if (prepared.state === "pending") {
    return narratorCompletionSSE({
      signal: request.signal,
      waitForCompletion: () => readGenerationCompletion(
        prisma as unknown as GenerationRequestClient,
        {
          generationId,
          chapterId,
          mode,
          scale,
          content: mode === "say" ? content!.trim() : undefined,
          directive: directive?.trim() || undefined,
          playerIndex: prepared.meta.playerIndex,
          narratorIndex: prepared.meta.narratorIndex,
        },
      ),
    });
  }
  const narratorIndex = prepared.meta.narratorIndex;

  // 组装上下文（say 模式下玩家消息已落库，builder 会把它计入窗口；
  // playerInput 只用于世界书匹配，末尾输入由窗口内最后一条承担会重复——
  // 因此这里以 beforeIndex 剔除刚落库的那条，由 builder 在末尾单独注入）
  let messages;
  try {
    messages = await buildNarratorContext({
      worldId: chapter.timeline.worldId,
      chapterId,
      playerInput: mode === "say" ? content!.trim() : undefined,
      scale,
      mode,
      directive,
      beforeIndex: mode === "say" ? narratorIndex - 1 : undefined,
    });
  } catch (error) {
    await markGenerationFailed(
      prisma as unknown as GenerationRequestClient,
      generationId,
      prepared.attempt!,
      error,
    );
    throw error;
  }

  return narratorSSE({
    messages,
    cacheNamespace: `narrative:${chapter.timeline.worldId}:v1`,
    signal: request.signal,
    onFailure: (error) => markGenerationFailed(
      prisma as unknown as GenerationRequestClient,
      generationId,
      prepared.attempt!,
      error,
    ),
    onDone: async ({ prose, meta, signal }) => {
      const result = await finalizeNarration(
        prisma as unknown as NarrationFinalizationClient,
        {
          generationId,
          chapterId,
          chapterIndex: chapter.index,
          timelineId: chapter.timeline.id,
          narratorIndex,
          attempt: prepared.attempt,
          requestMeta: prepared.meta,
          prose,
          meta,
          scale,
          signal,
          logInvalidReveal: ({ abilityId }) => {
            console.warn("[chat] 跳过非法能力揭示", {
              abilityId,
              timelineId: chapter.timeline.id,
              generationId,
            });
          },
        },
      );
      return { messageId: result.messageId };
    },
  });
}
