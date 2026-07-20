import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeWorldDeck, type WorldDeck } from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { factionSections } from "@/lib/cards/faction-sections";

/**
 * POST /api/worlds/[id]/embark —— 开局：草稿卡组物化为时间线+诸神+百科实体+第一章
 */

export const maxDuration = 60;

function emblemSeed(name: string): string {
  let h = 5381;
  for (const ch of name) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

function raceSections(r: WorldDeck["races"][number]) {
  return [
    { key: "overview", content: { text: r.traits } },
    { key: "lifespan", content: { text: r.lifespan } },
    { key: "distribution", content: { text: r.distribution } },
    { key: "divineTies", content: { text: r.divineTies } },
  ];
}

function placeSections(p: WorldDeck["places"][number]) {
  return [
    { key: "overview", content: { text: p.overview } },
    { key: "kind", content: { text: p.kind } },
    { key: "allegiance", content: { text: p.allegiance } },
  ];
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const world = await prisma.world.findUnique({ where: { id } });
  if (!world?.draftDeck) {
    return NextResponse.json({ error: "世界草稿不存在" }, { status: 404 });
  }
  if (world.status !== "draft") {
    return NextResponse.json({ error: "该世界已开局" }, { status: 409 });
  }

  let deck: WorldDeck;
  try {
    deck = normalizeWorldDeck(world.draftDeck);
    validateDeckReferences(deck);
  } catch {
    return NextResponse.json({ error: "草稿卡组已损坏" }, { status: 500 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const timeline = await tx.timeline.create({
      data: { worldId: world.id },
    });

    // 玩家神
    await tx.god.create({
      data: {
        timelineId: timeline.id,
        name: deck.playerGod.name,
        aliases: [],
        tier: "player",
        isPlayer: true,
        rank: deck.playerGod.rank,
        domains: deck.playerGod.domains,
        persona: {
          origin: deck.playerGod.origin,
          situation: deck.playerGod.situation,
        } as Prisma.InputJsonValue,
        faithScope: deck.playerGod.faithBase,
      },
    });

    // 主神（议程默认隐藏）
    for (const god of deck.majorGods) {
      await tx.god.create({
        data: {
          timelineId: timeline.id,
          name: god.name,
          aliases: god.aliases,
          tier: "major",
          rank: god.rank,
          domains: god.domains,
          persona: { text: god.persona } as Prisma.InputJsonValue,
          voice: god.voice as Prisma.InputJsonValue,
          agenda: god.agenda as unknown as Prisma.InputJsonValue,
          relations: {
            player: {
              label: god.initialRelationToPlayer.label,
              note: god.initialRelationToPlayer.note,
            },
          } as Prisma.InputJsonValue,
          faithScope: god.faithScope,
        },
      });
    }

    // 次要神
    for (const god of deck.minorGods) {
      await tx.god.create({
        data: {
          timelineId: timeline.id,
          name: god.name,
          aliases: [],
          tier: "minor",
          persona: { text: god.brief } as Prisma.InputJsonValue,
        },
      });
    }

    // 百科首批实体
    const entityData: {
      type: string;
      name: string;
      aliases: string[];
      summary: string;
      sections: { key: string; content: Prisma.InputJsonValue }[];
    }[] = [
      ...deck.factions.map((f) => ({
        type: "faction",
        name: f.name,
        aliases: f.aliases,
        summary: f.overview.slice(0, 120),
        sections: factionSections(f, deck.majorCharacters) as {
          key: string;
          content: Prisma.InputJsonValue;
        }[],
      })),
      ...deck.races.map((r) => ({
        type: "race",
        name: r.name,
        aliases: r.aliases,
        summary: r.traits.slice(0, 120),
        sections: raceSections(r) as {
          key: string;
          content: Prisma.InputJsonValue;
        }[],
      })),
      ...deck.places.map((p) => ({
        type: "place",
        name: p.name,
        aliases: p.aliases,
        summary: p.overview.slice(0, 120),
        sections: placeSections(p) as {
          key: string;
          content: Prisma.InputJsonValue;
        }[],
      })),
    ];

    for (const e of entityData) {
      await tx.entity.create({
        data: {
          timelineId: timeline.id,
          type: e.type,
          name: e.name,
          aliases: e.aliases,
          emblemSeed: emblemSeed(e.name),
          summary: e.summary,
          sections: { create: e.sections },
        },
      });
    }

    // 第一章
    const chapter = await tx.chapter.create({
      data: {
        timelineId: timeline.id,
        index: 1,
        title: "创世",
      },
    });

    await tx.world.update({
      where: { id: world.id },
      data: {
        status: "playing",
        activeTimelineId: timeline.id,
        draftDeck: deck as unknown as Prisma.InputJsonValue,
      },
    });

    return { timelineId: timeline.id, chapterId: chapter.id };
  });

  return NextResponse.json(result);
}
