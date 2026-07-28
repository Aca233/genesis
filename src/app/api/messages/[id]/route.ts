import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assertMessageEditable,
  MessageCheckpointError,
} from "@/lib/chat/message-edit-policy";
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";

/**
 * 消息四件套之「朱批」与「裁去」（docs/01 §3.2）
 * PATCH  /api/messages/[id] —— 编辑消息内容（meta.edited=true）
 * DELETE /api/messages/[id] —— 裁去该消息及同章其后所有消息
 */

const PatchSchema = z.object({ content: z.string().min(1) });

type VariantItem = { content: string; meta?: unknown; chosen?: boolean };

function asVariants(value: unknown): VariantItem[] | null {
  return Array.isArray(value) ? (value as VariantItem[]) : null;
}

export const PATCH = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请求体不合法" }, { status: 400 });
  }
  const { content } = parsed.data;

  const message = await prisma.message.findFirst({
    where: ownedWhere.message(userId, id),
    include: {
      chapter: {
        select: {
          settleState: true,
          timelineId: true,
          timeline: {
            select: { world: { select: { activeTimelineId: true } } },
          },
        },
      },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }
  try {
    assertMessageEditable({
      settleState: message.chapter.settleState,
      timelineId: message.chapter.timelineId,
      activeTimelineId: message.chapter.timeline.world.activeTimelineId,
    });
  } catch (error) {
    if (error instanceof MessageCheckpointError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // meta.edited = true（保留其余 meta 字段）
  const meta = {
    ...(message.meta && typeof message.meta === "object" ? message.meta : {}),
    edited: true,
  };

  // narrator 消息：同步 variants 中当前 chosen 项的 content
  let variants = message.variants as Prisma.InputJsonValue | undefined;
  if (message.role === "narrator") {
    const list = asVariants(message.variants);
    if (list) {
      variants = list.map((v) =>
        v.chosen ? { ...v, content } : v,
      ) as Prisma.InputJsonValue;
    }
  }

  const updated = await prisma.message.update({
    where: { id },
    data: {
      content,
      meta: meta as Prisma.InputJsonValue,
      ...(variants !== undefined ? { variants } : {}),
    },
  });

  return NextResponse.json({ message: updated });
});

export const DELETE = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const message = await prisma.message.findFirst({
    where: ownedWhere.message(userId, id),
    include: {
      chapter: {
        select: {
          settleState: true,
          timelineId: true,
          timeline: {
            select: { world: { select: { activeTimelineId: true } } },
          },
        },
      },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }
  try {
    assertMessageEditable({
      settleState: message.chapter.settleState,
      timelineId: message.chapter.timelineId,
      activeTimelineId: message.chapter.timeline.world.activeTimelineId,
    });
  } catch (error) {
    if (error instanceof MessageCheckpointError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // 事务：删除该消息及同章 index >= 它的全部（含自身）
  const { count } = await prisma.$transaction(async (tx) => {
    return tx.message.deleteMany({
      where: { chapterId: message.chapterId, index: { gte: message.index } },
    });
  });

  return NextResponse.json({ deleted: count });
});
