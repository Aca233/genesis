import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { WorldModeSchema } from "@/lib/world-mode";
import {
  isOmniscientViewer,
  projectChronicleForViewer,
  realityViewerFromPersistence,
} from "@/lib/reality/visibility";

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

  const timeline = await prisma.timeline.findUnique({
    where: { id: timelineId },
    select: {
      observerState: true,
      world: { select: { mode: true } },
    },
  });
  if (!timeline) {
    return NextResponse.json({ error: "时间线不存在" }, { status: 404 });
  }
  const viewer = realityViewerFromPersistence(
    WorldModeSchema.parse(timeline.world.mode),
    timeline.observerState,
  );
  const omniscient = isOmniscientViewer(viewer);

  const [entries, timeRows, gods, entities] = await Promise.all([
    prisma.chronicleEntry.findMany({
      where: {
        timelineId,
        ...(omniscient ? {} : { revealed: true }),
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
        revealed: true,
        revealedAtChapter: true,
        source: true,
      },
    }),
    prisma.chronicleEntry.findMany({
      where: { timelineId },
      orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
      select: { chapterIndex: true, yearLabel: true },
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
  const timeByInternalIndex = new Map<number, string>();
  for (const row of timeRows) {
    if (!timeByInternalIndex.has(row.chapterIndex) && row.yearLabel.trim()) {
      timeByInternalIndex.set(row.chapterIndex, row.yearLabel);
    }
  }
  const godById = new Map(gods.map((god) => [god.id, god]));

  return NextResponse.json({
    entries: entries.flatMap((entry) => {
      const projection = projectChronicleForViewer(entry, viewer);
      return projection === null ? [] : [{
        ...projection,
        gods: entry.godIds.flatMap((id) => {
          const god = godById.get(id);
          return god ? [god] : [];
        }),
        yearLabel: entry.yearLabel.trim()
          || timeByInternalIndex.get(entry.chapterIndex)
          || "时间未载",
        revealedAtTimeLabel: entry.revealedAtChapter === null
          ? null
          : timeByInternalIndex.get(entry.revealedAtChapter) ?? null,
      }];
    }),
    gods,
    entities,
  });
}
