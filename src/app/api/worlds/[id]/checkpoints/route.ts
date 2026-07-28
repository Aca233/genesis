import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";

/**
 * GET /api/worlds/[id]/checkpoints —— 只读列出当前现实的已结算检查点。
 * eligible 标记该章快照是否为 v2（可回溯）；旧存档快照降级为不可回溯。
 * 与 GET /realities 一致不做模式门禁（只读）。
 */

type Context = { params: Promise<{ id: string }> };

export type CheckpointDto = {
  chapterId: string;
  index: number;
  timeLabel: string;
  excerpt: string | null;
  eligible: boolean;
  settledAt: string;
};

export const GET = withAuth(async (userId, _request: Request, { params }: Context) => {
  const { id } = await params;
  const world = await prisma.world.findFirst({
    where: ownedWhere.world(userId, id),
    select: { activeTimelineId: true },
  });
  if (world === null || world.activeTimelineId === null) {
    return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  }
  const activeId = world.activeTimelineId;

  const [chapters, eligibleRows, labels] = await Promise.all([
    prisma.chapter.findMany({
      where: { timelineId: activeId, settleState: "settled" },
      orderBy: { index: "desc" },
      select: { id: true, index: true, title: true, summary: true, settleUpdatedAt: true },
    }),
    // Json path 过滤只取快照版本，避免拉取整份多兆快照
    prisma.chapter.findMany({
      where: {
        timelineId: activeId,
        settleState: "settled",
        snapshot: { path: ["snapshotVersion"], equals: 2 },
      },
      select: { id: true },
    }),
    prisma.chronicleEntry.findMany({
      where: { timelineId: activeId, revealed: true },
      orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
      select: { chapterIndex: true, yearLabel: true, text: true },
    }),
  ]);

  const eligibleIds = new Set(eligibleRows.map((row) => row.id));
  const labelByChapter = new Map<number, string>();
  const excerptByChapter = new Map<number, string>();
  for (const row of labels) {
    if (!labelByChapter.has(row.chapterIndex) && row.yearLabel.trim()) {
      labelByChapter.set(row.chapterIndex, row.yearLabel);
    }
    if (!excerptByChapter.has(row.chapterIndex)) {
      excerptByChapter.set(row.chapterIndex, `${Array.from(row.text).slice(0, 80).join("")}…`);
    }
  }

  const checkpoints: CheckpointDto[] = chapters.map((chapter) => ({
    chapterId: chapter.id,
    index: chapter.index,
    timeLabel: labelByChapter.get(chapter.index) ?? `第${chapter.index}卷`,
    excerpt: excerptByChapter.get(chapter.index) ?? null,
    eligible: eligibleIds.has(chapter.id),
    settledAt: chapter.settleUpdatedAt.toISOString(),
  }));

  return NextResponse.json({ checkpoints });
});
