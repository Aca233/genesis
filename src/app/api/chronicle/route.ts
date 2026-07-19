import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/chronicle?timelineId=xxx&entityId=&godId= —— 年表（已揭示条目）
 * 附过滤器选项（诸神/实体名单）。
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const timelineId = url.searchParams.get("timelineId");
  const entityId = url.searchParams.get("entityId");
  const godId = url.searchParams.get("godId");
  if (!timelineId) {
    return NextResponse.json({ error: "缺少 timelineId" }, { status: 400 });
  }

  const [entries, gods, entities] = await Promise.all([
    prisma.chronicleEntry.findMany({
      where: {
        timelineId,
        revealed: true,
        ...(entityId ? { entityIds: { has: entityId } } : {}),
        ...(godId ? { godIds: { has: godId } } : {}),
      },
      orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        chapterIndex: true,
        yearLabel: true,
        text: true,
        entityIds: true,
        godIds: true,
        revealedAtChapter: true,
        source: true,
      },
    }),
    prisma.god.findMany({
      where: { timelineId, tier: { in: ["major", "player"] } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.entity.findMany({
      where: { timelineId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({ entries, gods, entities });
}
