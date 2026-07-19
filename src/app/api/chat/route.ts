import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ScaleSchema } from "@/lib/cards/schemas";
import { buildNarratorContext } from "@/lib/context/builder";
import { narratorSSE } from "@/lib/context/sse";

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
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求体不合法" }, { status: 400 });
  }
  const { chapterId, content, scale, mode, directive } = parsed.data;

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
  if (mode === "opening" && lastIndex > 0) {
    return NextResponse.json({ error: "本章已有开场，不可重复演出" }, { status: 409 });
  }

  // say：先落玩家消息（即使后续 LLM 失败也保留）
  let nextIndex = lastIndex + 1;
  if (mode === "say") {
    await prisma.message.create({
      data: {
        chapterId,
        index: nextIndex,
        role: "player",
        content: content!.trim(),
        scale,
      },
    });
    nextIndex += 1;
  }

  // 组装上下文（say 模式下玩家消息已落库，builder 会把它计入窗口；
  // playerInput 只用于世界书匹配，末尾输入由窗口内最后一条承担会重复——
  // 因此这里以 beforeIndex 剔除刚落库的那条，由 builder 在末尾单独注入）
  const narratorIndex = nextIndex;
  const messages = await buildNarratorContext({
    worldId: chapter.timeline.worldId,
    chapterId,
    playerInput: mode === "say" ? content!.trim() : undefined,
    scale,
    mode,
    directive,
    beforeIndex: mode === "say" ? narratorIndex - 1 : undefined,
  });

  return narratorSSE({
    messages,
    onDone: async ({ prose, meta }) => {
      const saved = await prisma.message.create({
        data: {
          chapterId,
          index: narratorIndex,
          role: "narrator",
          content: prose,
          scale,
          variants: [{ content: prose, meta, chosen: true }] as Prisma.InputJsonValue,
          meta: meta as unknown as Prisma.InputJsonValue,
        },
      });
      // 查探裁决回填：揭示的隐藏大事记翻转为可见，标注揭晓章
      if (meta.revealedEventIds?.length) {
        await prisma.chronicleEntry.updateMany({
          where: {
            id: { in: meta.revealedEventIds },
            timelineId: chapter.timeline.id,
            revealed: false,
          },
          data: { revealed: true, revealedAtChapter: chapter.index },
        });
      }
      return { messageId: saved.id };
    },
  });
}
