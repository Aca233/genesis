import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/worlds/[id]/export —— 导出存档
 * 组装 { version: 2, exportedAt, world: {...全量私有数据} } JSON 并以附件下载。
 * 导出格式与 POST /api/worlds/import 对偶。
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const world = await prisma.world.findUnique({
    where: { id },
    include: {
      timelines: {
        orderBy: { createdAt: "asc" },
        include: {
          chapters: {
            orderBy: { index: "asc" },
            include: { messages: { orderBy: { index: "asc" } } },
          },
          gods: { orderBy: { createdAt: "asc" } },
          abilities: {
            orderBy: { createdAt: "asc" },
            include: { events: true },
          },
          entities: {
            orderBy: { createdAt: "asc" },
            include: { sections: true, race: true, memberships: true },
          },
          chronicles: { orderBy: { createdAt: "asc" } },
          omens: { orderBy: { createdAt: "asc" } },
        },
      },
      lorebookEntries: true,
    },
  });

  if (!world) {
    return NextResponse.json({ error: "不存在" }, { status: 404 });
  }

  const exportWorld = {
    ...world,
    timelines: world.timelines.map((timeline) => {
      const abilities = timeline.abilities.map(({ events, ...ability }) => {
        void events;
        return ability;
      });
      const abilityEvents = timeline.abilities.flatMap((ability) => ability.events);
      const memberships = Array.from(
        new Map(
          timeline.entities
            .flatMap((entity) => entity.memberships)
            .map((membership) => [membership.id, membership]),
        ).values(),
      );
      const entities = timeline.entities.map(({ race, memberships, ...entity }) => {
        void race;
        void memberships;
        return entity;
      });
      return { ...timeline, entities, abilities, abilityEvents, memberships };
    }),
  };

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    world: exportWorld,
  };

  // 中文文件名：filename 提供 ASCII 回退，filename* 携带 UTF-8 原名
  const encodedName = encodeURIComponent(`genesis-${world.name}.json`);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="genesis-world.json"; filename*=UTF-8''${encodedName}`,
    },
  });
}
