import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parsePersistedWorldDeck } from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { WorldModeSchema } from "@/lib/world-mode";
import { archiveWorldMaterials } from "@/lib/materials/archive-world";
import {
  EmbarkConflictError,
  EmbarkDraftError,
  EmbarkModeMismatchError,
  runClaimedEmbarkTransaction,
} from "@/lib/embark/mutations";
import { withAuth } from "@/lib/auth/route";
import { requireWorld } from "@/lib/auth/ownership";

export {
  claimDraftWorld,
  EmbarkConflictError,
  EmbarkDraftError,
  EmbarkModeMismatchError,
  materializeEmbarkDeck,
  runClaimedEmbarkTransaction,
  runEmbarkTransaction,
} from "@/lib/embark/mutations";

/** POST /api/worlds/[id]/embark —— 开局：草稿卡组物化为时间线、诸神、百科实体和首个内部记录段 */
export const maxDuration = 60;


export const POST = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!(await requireWorld(userId, id))) {
    return NextResponse.json({ error: "世界草稿不存在" }, { status: 404 });
  }
  try {
    let temporal = { era: "未名纪元", time: "此刻" };
    const result = await runClaimedEmbarkTransaction(prisma, id, async (tx) => {
      const world = await tx.world.findUnique({ where: { id } });
      if (!world?.draftDeck) {
        throw new EmbarkDraftError("世界草稿不存在");
      }

      const mode = WorldModeSchema.parse(world.mode);
      const deck = parsePersistedWorldDeck(world.draftDeck);
      if (deck.mode !== mode) {
        throw new EmbarkModeMismatchError("世界模式不可更改");
      }
      validateDeckReferences(deck);
      temporal = {
        era: deck.epochConflict.epochName,
        time: deck.epochConflict.yearLabel,
      };
      return deck;
    });
    try {
      await archiveWorldMaterials(id);
    } catch (archiveError) {
      console.error("Failed to archive initial materials", archiveError);
    }
    return NextResponse.json({ ...result, temporal });
  } catch (error) {
    if (error instanceof EmbarkModeMismatchError) {
      return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
    }
    if (error instanceof EmbarkConflictError) {
      const world = await prisma.world.findUnique({ where: { id }, select: { id: true } });
      return NextResponse.json(
        { error: world === null ? "世界草稿不存在" : "该世界已开局" },
        { status: world === null ? 404 : 409 },
      );
    }
    if (error instanceof EmbarkDraftError) {
      return NextResponse.json({ error: "世界草稿不存在" }, { status: 404 });
    }
    console.error("Failed to materialize embark deck", error);
    return NextResponse.json({ error: "开局物化失败" }, { status: 500 });
  }
});
