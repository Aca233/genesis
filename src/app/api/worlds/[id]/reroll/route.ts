import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import { WorldDeckSchema, DECK_CARD_KEYS } from "@/lib/cards/schemas";
import { GENESIS_SYSTEM, rerollUserPrompt } from "@/lib/prompts/genesis";

/**
 * POST /api/worlds/[id]/reroll —— 单卡重掷（其余卡组为约束；player_locked 保留）
 * body: { cardKey: DeckCardKey, note?: string }
 */

const BodySchema = z.object({
  cardKey: z.enum(DECK_CARD_KEYS),
  note: z.string().max(500).optional(),
});

export const maxDuration = 300;

/** 按路径读值（"playerGod.name" / "majorGods.0.voice"） */
function getPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

/** 按路径写值 */
function setPath(obj: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce<unknown>(
    (acc, key) =>
      acc && typeof acc === "object"
        ? (acc as Record<string, unknown>)[key]
        : undefined,
    obj,
  );
  if (target && typeof target === "object") {
    (target as Record<string, unknown>)[last] = value;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { cardKey, note } = BodySchema.parse(await request.json());

  const world = await prisma.world.findUnique({ where: { id } });
  if (!world?.draftDeck) {
    return NextResponse.json({ error: "世界草稿不存在" }, { status: 404 });
  }

  const lockedInCard = world.lockedPaths.filter(
    (p) => p === cardKey || p.startsWith(`${cardKey}.`),
  );

  let deck;
  try {
    deck = await completeStructured("narrative", {
      task: "genesis",
      system: GENESIS_SYSTEM,
      user: rerollUserPrompt({
        decree: world.genesisInput,
        cardKey,
        currentDeckJson: JSON.stringify(world.draftDeck),
        lockedNote: lockedInCard.length ? lockedInCard.join(", ") : undefined,
        playerNote: note,
      }),
      schema: WorldDeckSchema,
      maxTokens: 16000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 服务端强制：player_locked 路径以旧值覆写（不信任模型的「保留」承诺）
  const merged = deck as unknown as Record<string, unknown>;
  for (const path of lockedInCard) {
    const oldValue = getPath(world.draftDeck, path);
    if (oldValue !== undefined) setPath(merged, path, oldValue);
  }

  await prisma.world.update({
    where: { id },
    data: {
      name: deck.worldName,
      draftDeck: merged as Prisma.InputJsonValue,
      themeCard: deck.theme as unknown as Prisma.InputJsonValue,
      styleCard: deck.style as unknown as Prisma.InputJsonValue,
      cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
      fusionAxiom: deck.fusionAxiom
        ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });

  return NextResponse.json({ deck: merged });
}
