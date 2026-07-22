import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  parsePersistedWorldDeck,
  DECK_CARD_KEYS,
  type WorldDeck,
} from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import {
  genesisSystem,
  rerollReferenceRepairPrompt,
  rerollUserPrompt,
} from "@/lib/prompts/genesis";
import { assertModeTransition, WorldModeSchema, type WorldMode } from "@/lib/world-mode";

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

function parseForMode(value: unknown, mode: WorldMode): WorldDeck {
  return mode === "pantheon"
    ? PantheonWorldDeckSchema.parse(value)
    : CreatorWorldDeckSchema.parse(value);
}

function applyLockedPaths(
  generated: unknown,
  currentDeck: unknown,
  lockedPaths: string[],
  mode: WorldMode,
): WorldDeck {
  const merged = JSON.parse(JSON.stringify(generated)) as Record<string, unknown>;
  for (const path of lockedPaths) {
    const oldValue = getPath(currentDeck, path);
    if (oldValue !== undefined) setPath(merged, path, oldValue);
  }
  return parseForMode(merged, mode);
}

function referenceIssue(deck: WorldDeck): string | null {
  try {
    validateDeckReferences(deck);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
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

  let currentDeck: WorldDeck;
  try {
    currentDeck = parsePersistedWorldDeck(world.draftDeck);
  } catch {
    return NextResponse.json({ error: "草稿卡组已损坏" }, { status: 500 });
  }

  const mode = WorldModeSchema.parse(world.mode);
  try {
    assertModeTransition(mode, currentDeck.mode);
  } catch {
    return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
  }
  if (mode === "creator" && cardKey === "playerGod") {
    return NextResponse.json({ error: "创世主模式不能重掷玩家神" }, { status: 409 });
  }
  const lockedPaths = world.lockedPaths;

  let generated: WorldDeck;
  try {
    const requestOptions = {
      task: "reroll" as const,
      system: genesisSystem(mode),
      user: rerollUserPrompt({
        mode,
        decree: world.genesisInput,
        cardKey,
        currentDeckJson: JSON.stringify(currentDeck),
        lockedNote: lockedPaths.length ? lockedPaths.join(", ") : undefined,
        playerNote: note,
      }),
      maxTokens: 16000,
      cache: { namespace: `reroll:v1:${mode}` },
    };
    generated = mode === "pantheon"
      ? await completeStructured("narrative", { ...requestOptions, schema: PantheonWorldDeckSchema })
      : await completeStructured("narrative", { ...requestOptions, schema: CreatorWorldDeckSchema });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
  try {
    assertModeTransition(mode, generated.mode);
  } catch {
    return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
  }

  let deck: WorldDeck;
  try {
    deck = applyLockedPaths(generated, currentDeck, lockedPaths, mode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `重掷结果与锁定字段无法组成有效卡组：${message}` }, { status: 502 });
  }

  const firstReferenceIssue = referenceIssue(deck);
  if (firstReferenceIssue !== null) {
    try {
      const repairOptions = {
        task: "reroll" as const,
        system: genesisSystem(mode),
        user: rerollReferenceRepairPrompt({
          mode,
          decree: world.genesisInput,
          currentDeckJson: JSON.stringify(deck),
          referenceIssue: firstReferenceIssue,
        }),
        maxTokens: 16000,
        cache: { namespace: `reroll:v1:${mode}` },
      };
      const repaired = mode === "pantheon"
        ? await completeStructured("narrative", { ...repairOptions, schema: PantheonWorldDeckSchema })
        : await completeStructured("narrative", { ...repairOptions, schema: CreatorWorldDeckSchema });
      try {
        assertModeTransition(mode, repaired.mode);
      } catch {
        return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
      }
      deck = applyLockedPaths(repaired, currentDeck, lockedPaths, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `重掷引用修复失败：${message}` }, { status: 502 });
    }

    const repairedReferenceIssue = referenceIssue(deck);
    if (repairedReferenceIssue !== null) {
      return NextResponse.json(
        { error: "重掷引用修复后仍无效", issues: [repairedReferenceIssue] },
        { status: 502 },
      );
    }
  }

  const { count } = await prisma.world.updateMany({
    where: { id, mode, updatedAt: world.updatedAt },
    data: {
      name: deck.worldName,
      draftDeck: deck as unknown as Prisma.InputJsonValue,
      themeCard: deck.theme as unknown as Prisma.InputJsonValue,
      styleCard: deck.style as unknown as Prisma.InputJsonValue,
      cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
      fusionAxiom: deck.fusionAxiom
        ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });
  if (count !== 1) {
    return NextResponse.json(
      { error: "卡组已被其他操作更新，请刷新后重试" },
      { status: 409 },
    );
  }

  return NextResponse.json({ deck });
}
