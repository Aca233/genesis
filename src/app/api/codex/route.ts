import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/codex?timelineId=xxx —— 众生录列表（轻量，无 sections）
 * 排序：标星在前 → active 在前 → 名字
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const timelineId = url.searchParams.get("timelineId");
  if (!timelineId) {
    return NextResponse.json({ error: "缺少 timelineId" }, { status: 400 });
  }

  const entities = await prisma.entity.findMany({
    where: { timelineId },
    select: {
      id: true,
      type: true,
      name: true,
      aliases: true,
      emblemSeed: true,
      imageUrl: true,
      starred: true,
      isChosen: true,
      heat: true,
      summary: true,
      scenePresence: true,
    },
    orderBy: [{ starred: "desc" }, { heat: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ entities });
}
