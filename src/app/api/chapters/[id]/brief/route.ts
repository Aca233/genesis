import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";
import {
  ChapterBriefPatchSchema,
  mergeChapterBrief,
  normalizeChapterBrief,
} from "@/lib/context/chapter-brief";
import { prisma } from "@/lib/db";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withAuth(async (userId, _request: Request, { params }: RouteParams) => {
  const { id } = await params;
  const chapter = await prisma.chapter.findFirst({
    where: ownedWhere.chapter(userId, id),
    select: { brief: true },
  });
  if (!chapter) {
    return NextResponse.json({ error: "内部记录段不存在" }, { status: 404 });
  }
  return NextResponse.json({ brief: normalizeChapterBrief(chapter.brief) });
});

export const PATCH = withAuth(async (userId, request: Request, { params }: RouteParams) => {
  const { id } = await params;
  const body = ChapterBriefPatchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: body.error.issues[0]?.message ?? "章节约束不合法" },
      { status: 400 },
    );
  }

  const chapter = await prisma.chapter.findFirst({
    where: ownedWhere.chapter(userId, id),
    select: {
      brief: true,
      settleState: true,
      timeline: {
        select: {
          id: true,
          world: { select: { activeTimelineId: true } },
        },
      },
    },
  });
  if (!chapter) {
    return NextResponse.json({ error: "内部记录段不存在" }, { status: 404 });
  }
  if (chapter.settleState !== "open") {
    return NextResponse.json({ error: "此段已成史，不可修改章节约束" }, { status: 409 });
  }
  if (chapter.timeline.id !== chapter.timeline.world.activeTimelineId) {
    return NextResponse.json({ error: "该现实已被冻结" }, { status: 409 });
  }

  const brief = mergeChapterBrief(chapter.brief, body.data);
  await prisma.chapter.update({
    where: { id },
    data: { brief: brief as unknown as Prisma.InputJsonValue },
    select: { brief: true },
  });
  return NextResponse.json({ brief });
});
