import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/chapters/[id]/messages —— 章内消息全量（兜底刷新）
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const chapter = await prisma.chapter.findUnique({
    where: { id },
    include: { messages: { orderBy: { index: "asc" } } },
  });
  if (!chapter) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }
  return NextResponse.json({ messages: chapter.messages });
}
