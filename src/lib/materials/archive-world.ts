import { prisma } from "@/lib/db";
import { parsePersistedWorldDeck } from "@/lib/cards/schemas";
import { archiveInitialDeck } from "./repository";

function safeArchiveError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export async function archiveWorldMaterials(worldId: string): Promise<void> {
  const claimed = await prisma.world.updateMany({
    where: { id: worldId, materialArchiveStatus: { in: ["pending", "failed"] } },
    data: { materialArchiveStatus: "running", materialArchiveError: null },
  });
  if (claimed.count !== 1) {
    const world = await prisma.world.findUnique({ where: { id: worldId }, select: { materialArchiveStatus: true } });
    if (world?.materialArchiveStatus === "completed") return;
    throw new Error("素材归档正在进行或世界不存在");
  }
  try {
    await prisma.$transaction(async (tx) => {
      const world = await tx.world.findUniqueOrThrow({ where: { id: worldId }, select: { id: true, name: true, draftDeck: true } });
      if (!world.draftDeck) throw new Error("世界缺少可归档的最终创世卡组");
      const deck = parsePersistedWorldDeck(world.draftDeck);
      if (deck.mode !== "pantheon") throw new Error("当前素材归档尚不支持创世主模式");
      await archiveInitialDeck(tx, { worldId: world.id, worldName: world.name, deck });
      await tx.world.update({ where: { id: world.id }, data: { materialArchiveStatus: "completed", materialArchiveError: null } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    await prisma.world.updateMany({ where: { id: worldId }, data: { materialArchiveStatus: "failed", materialArchiveError: safeArchiveError(error) } });
    throw error;
  }
}
