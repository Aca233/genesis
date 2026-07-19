import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/worlds/[id]/entity-index —— 正文实体微光链接的轻量索引
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const world = await prisma.world.findUnique({
    where: { id },
    select: { activeTimelineId: true },
  });
  if (!world?.activeTimelineId) {
    return NextResponse.json({ index: [] });
  }

  const index = await prisma.entity.findMany({
    where: { timelineId: world.activeTimelineId },
    select: {
      id: true,
      name: true,
      aliases: true,
      type: true,
      summary: true,
      emblemSeed: true,
      imageUrl: true,
    },
  });

  return NextResponse.json({ index });
}
