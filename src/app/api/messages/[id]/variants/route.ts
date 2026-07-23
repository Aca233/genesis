import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ScaleSchema } from "@/lib/cards/schemas";
import { buildNarratorContext } from "@/lib/context/builder";
import { narratorSSE } from "@/lib/context/sse";
import type { NarratorMeta } from "@/lib/prompts/narrator";

/**
 * 消息四件套之「异文」（docs/01 §3.2）
 * POST  /api/messages/[id]/variants —— 另掷异文（SSE 流，仅 narrator 消息）
 * PATCH /api/messages/[id]/variants —— 切换定稿 body: { index }
 */

export const maxDuration = 300;

type VariantItem = { content: string; meta?: NarratorMeta; chosen?: boolean };

function asVariants(value: unknown): VariantItem[] {
  return Array.isArray(value) ? (value as VariantItem[]) : [];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const message = await prisma.message.findUnique({
    where: { id },
    include: {
      chapter: { include: { timeline: { select: { worldId: true } } } },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }
  if (message.role !== "narrator") {
    return NextResponse.json({ error: "只有叙事消息可另掷异文" }, { status: 400 });
  }
  if (message.chapter.settleState !== "open") {
    return NextResponse.json({ error: "本章已成史，不可另掷" }, { status: 409 });
  }

  const scaleParsed = ScaleSchema.safeParse(message.scale);
  const scale = scaleParsed.success ? scaleParsed.data : "scene";

  // 上下文 = 该消息之前的窗口（剔除该消息及其后的一切）。
  // 前一条若是玩家神谕，则以 say 模式重推该输入；否则视作续写/开场重掷。
  const prev = await prisma.message.findUnique({
    where: {
      chapterId_index: { chapterId: message.chapterId, index: message.index - 1 },
    },
  });

  const isSay = prev?.role === "player";
  const messages = await buildNarratorContext({
    worldId: message.chapter.timeline.worldId,
    chapterId: message.chapterId,
    scale,
    ...(isSay
      ? {
          mode: "say" as const,
          playerInput: prev!.content,
          beforeIndex: prev!.index, // 窗口剔除该玩家消息，由 builder 末尾单独注入
        }
      : message.index === 1
        ? { mode: "opening" as const, beforeIndex: message.index }
        : {
            mode: "continue" as const,
            directive: "以全新的角度与措辞重新演绎接下来这一段，不要复述先前的写法。",
            beforeIndex: message.index,
          }),
  });

  return narratorSSE({
    messages,
    cacheNamespace: `narrative:${message.chapter.timeline.worldId}:v1`,
    signal: request.signal,
    onDone: async ({ prose, meta }) => {
      // 重读最新 variants（避免并发覆盖），旧候选全部 chosen=false，新候选定稿
      const fresh = await prisma.message.findUniqueOrThrow({ where: { id } });
      const variants = asVariants(fresh.variants).map((v) => ({
        ...v,
        chosen: false,
      }));
      variants.push({ content: prose, meta, chosen: true });

      await prisma.message.update({
        where: { id },
        data: {
          content: prose,
          meta: meta as unknown as Prisma.InputJsonValue,
          variants: variants as Prisma.InputJsonValue,
        },
      });
      return {
        messageId: id,
        meta,
        followUp: { kind: "none" },
      };
    },
  });
}

const PatchSchema = z.object({ index: z.number().int().min(0) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求体不合法" }, { status: 400 });
  }
  const { index } = parsed.data;

  const message = await prisma.message.findUnique({ where: { id } });
  if (!message) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }
  const variants = asVariants(message.variants);
  if (index >= variants.length) {
    return NextResponse.json({ error: "异文序号越界" }, { status: 400 });
  }

  const next = variants.map((v, i) => ({ ...v, chosen: i === index }));
  const target = next[index];

  const updated = await prisma.message.update({
    where: { id },
    data: {
      content: target.content,
      meta: (target.meta ?? { suggestions: [], chapterBreakHint: false }) as unknown as Prisma.InputJsonValue,
      variants: next as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ message: updated });
}
