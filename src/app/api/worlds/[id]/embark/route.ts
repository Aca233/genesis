import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parsePersistedWorldDeck } from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { archiveWorldMaterials } from "@/lib/materials/archive-world";
import {
  EmbarkConflictError,
  EmbarkDraftError,
  runClaimedEmbarkTransaction,
} from "@/lib/embark/mutations";

export {
  claimDraftWorld,
  EmbarkConflictError,
  EmbarkDraftError,
  materializeEmbarkDeck,
  runClaimedEmbarkTransaction,
  runEmbarkTransaction,
} from "@/lib/embark/mutations";

/** POST /api/worlds/[id]/embark —— 开局：草稿卡组物化为时间线+诸神+百科实体+第一章 */
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await runClaimedEmbarkTransaction(prisma, id, async (tx) => {
      const world = await tx.world.findUnique({ where: { id } });
      if (!world?.draftDeck) {
        throw new EmbarkDraftError("世界草稿不存在");
      }

      const deck = parsePersistedWorldDeck(world.draftDeck);
      validateDeckReferences(deck);
      return deck;
    });
    try {
      await archiveWorldMaterials(id);
    } catch (archiveError) {
      console.error("Failed to archive initial materials", archiveError);
    }
    return NextResponse.json(result);
  } catch (error) {
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
}
