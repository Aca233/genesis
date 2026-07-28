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
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";

/**
 * GET    /api/worlds/[id] —— 读取世界（含草稿卡组）
 * PATCH  /api/worlds/[id] —— 手改卡组（记录 lockedPaths）
 * DELETE /api/worlds/[id] —— 删除存档
 */

const PatchSchema = z.object({
  deck: z.unknown(),
  /** 本次手改涉及的字段路径（点分）——将被标记为 player_locked */
  editedPaths: z.array(z.string()).default([]),
  /** 客户端最近一次 GET/PATCH 取得的世界 revision。 */
  expectedUpdatedAt: z.coerce.date(),
});

export const GET = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    const world = await prisma.world.findFirst({
      where: ownedWhere.world(userId, id),
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
  } catch (cause) {
    // 未捕获异常兜底：保证错误响应始终为结构化中文 JSON 而非空 500。
    console.error("GET /api/worlds/[id] 未捕获异常：", cause);
    return NextResponse.json(
      { error: "星轨紊乱：世界读取失败，请稍后再试" },
      { status: 500 },
    );
  }
});

export const PATCH = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    const world = await prisma.world.findFirst({
      where: ownedWhere.world(userId, id),
      select: { mode: true, status: true, lockedPaths: true, updatedAt: true },
    });
    if (!world) return NextResponse.json({ error: "不存在" }, { status: 404 });
    if (world.status !== "draft") {
      return NextResponse.json({ error: "世界已开局，不可修改卡组" }, { status: 409 });
    }

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
    const updatedAt = await prisma.$transaction(async (tx) => {
      const { count } = await tx.world.updateMany({
        where: { id, userId, mode, status: "draft", updatedAt: body.expectedUpdatedAt },
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
      if (count !== 1) return null;
      const updated = await tx.world.findUnique({
        where: { id },
        select: { updatedAt: true },
      });
      return updated?.updatedAt ?? null;
    });
    if (updatedAt === null) {
      return NextResponse.json(
        { error: "卡组已被其他操作更新，请刷新后重试" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, lockedPaths, updatedAt });
  } catch (cause) {
    // 未捕获异常兜底：保证错误响应始终为结构化中文 JSON 而非空 500。
    console.error("PATCH /api/worlds/[id] 未捕获异常：", cause);
    return NextResponse.json(
      { error: "此界改写失败，请稍后再试" },
      { status: 500 },
    );
  }
});

export const DELETE = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  try {
    const { count } = await prisma.world.deleteMany({ where: ownedWhere.world(userId, id) });
    if (count === 0) {
      return NextResponse.json({ error: "此界不存在或早已消散" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("DELETE /api/worlds/[id] 未捕获异常：", cause);
    return NextResponse.json(
      { error: "此界消散失败，请稍后再试" },
      { status: 500 },
    );
  }
});
