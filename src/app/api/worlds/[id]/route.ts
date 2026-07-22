import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  parsePersistedWorldDeck,
  type WorldDeck,
} from "@/lib/cards/schemas";
import { assertModeTransition, WorldModeSchema } from "@/lib/world-mode";
import { validateDeckReferences } from "@/lib/abilities/validator";

/**
 * GET    /api/worlds/[id] —— 读取世界（含草稿卡组）
 * PATCH  /api/worlds/[id] —— 手改卡组（记录 lockedPaths）
 * DELETE /api/worlds/[id] —— 删除存档
 */

const PatchSchema = z.object({
  deck: z.unknown(),
  /** 本次手改涉及的字段路径（点分）——将被标记为 player_locked */
  editedPaths: z.array(z.string()).default([]),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const world = await prisma.world.findUnique({
    where: { id },
    include: {
      timelines: { select: { id: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!world) return NextResponse.json({ error: "不存在" }, { status: 404 });
  if (world.draftDeck) {
    try {
      return NextResponse.json({ world: { ...world, draftDeck: parsePersistedWorldDeck(world.draftDeck) } });
    } catch {
      return NextResponse.json({ error: "草稿卡组已损坏" }, { status: 500 });
    }
  }
  return NextResponse.json({ world });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const world = await prisma.world.findUnique({
    where: { id },
    select: { mode: true, lockedPaths: true },
  });
  if (!world) return NextResponse.json({ error: "不存在" }, { status: 404 });

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "卡组校验失败" }, { status: 400 });
  }

  const mode = WorldModeSchema.parse(world.mode);
  const submittedMode = body.deck && typeof body.deck === "object"
    ? (body.deck as { mode?: unknown }).mode
    : undefined;
  try {
    assertModeTransition(mode, WorldModeSchema.parse(submittedMode));
  } catch {
    return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
  }

  let deck: WorldDeck;
  try {
    deck = mode === "pantheon"
      ? PantheonWorldDeckSchema.parse(body.deck)
      : CreatorWorldDeckSchema.parse(body.deck);
    validateDeckReferences(deck);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "卡组校验失败", issues: [message] },
      { status: 400 },
    );
  }

  const lockedPaths = [...new Set([...world.lockedPaths, ...body.editedPaths])];
  await prisma.world.update({
    where: { id },
    data: {
      name: deck.worldName,
      draftDeck: deck as unknown as Prisma.InputJsonValue,
      lockedPaths,
      themeCard: deck.theme as unknown as Prisma.InputJsonValue,
      styleCard: deck.style as unknown as Prisma.InputJsonValue,
      cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
      fusionAxiom: deck.fusionAxiom
        ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });

  return NextResponse.json({ ok: true, lockedPaths });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.world.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
