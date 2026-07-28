import type { MaterialVersion, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorldDeck } from "@/lib/cards/schemas";
import { extractDeckMaterials, type ExtractedMaterial } from "./extract-deck";
import { MATERIAL_SCHEMA_VERSION, parseMaterialVersionContent, type MaterialVersionContent } from "./schemas";
import { MaterialDependencySchema, type MaterialDependency } from "./types";

export async function archiveInitialDeck(
  tx: Prisma.TransactionClient,
  userId: string,
  input: { worldId: string; worldName: string; deck: WorldDeck },
): Promise<void> {
  // 与逐条 upsert 语义一致：同一 (sourceKind, sourceRef) 以先出现的素材为准
  const cardKey = (sourceKind: string, sourceRef: string) => `${sourceKind}\u0000${sourceRef}`;
  const entries = new Map<string, { material: ExtractedMaterial; sourceRef: string }>();
  for (const material of extractDeckMaterials(input.deck)) {
    const sourceRef = `${input.worldId}:${material.sourceKind}:${material.sourceRef}`;
    const key = cardKey(material.sourceKind, sourceRef);
    if (!entries.has(key)) entries.set(key, { material, sourceRef });
  }
  if (entries.size === 0) return;

  // 1) 批量定位已有素材卡，一次性补齐缺失的卡（原 upsert 的 update 为空对象，已存在的卡无需改写）
  const cardSelect = { id: true, sourceKind: true, sourceRef: true, defaultVersionId: true } as const;
  const existingCards = await tx.materialCard.findMany({
    where: { userId, OR: [...entries.values()].map(({ material, sourceRef }) => ({ sourceKind: material.sourceKind, sourceRef })) },
    select: cardSelect,
  });
  const cardByKey = new Map(existingCards.map((card) => [cardKey(card.sourceKind, card.sourceRef), card]));
  const missingEntries = [...entries].filter(([key]) => !cardByKey.has(key));
  if (missingEntries.length > 0) {
    const createdCards = await tx.materialCard.createManyAndReturn({
      data: missingEntries.map(([, { material, sourceRef }]) => ({
        userId, kind: material.kind, name: material.name, summary: material.summary,
        sourceWorldId: input.worldId, sourceWorldName: input.worldName,
        sourceKind: material.sourceKind, sourceRef,
      })),
      select: cardSelect,
    });
    for (const card of createdCards) cardByKey.set(cardKey(card.sourceKind, card.sourceRef), card);
  }

  // 2) 批量查已有初始版本，缺失的一次性创建（原 create 无嵌套写入，可安全批量插入）
  const initialIdByCardId = new Map<string, string>();
  const existingInitials = await tx.materialVersion.findMany({
    where: { cardId: { in: [...cardByKey.values()].map((card) => card.id) }, isInitial: true },
    select: { id: true, cardId: true },
  });
  for (const version of existingInitials) {
    if (!initialIdByCardId.has(version.cardId)) initialIdByCardId.set(version.cardId, version.id);
  }
  const versionEntries = [...entries].filter(([key]) => !initialIdByCardId.has(cardByKey.get(key)!.id));
  if (versionEntries.length > 0) {
    const createdVersions = await tx.materialVersion.createManyAndReturn({
      data: versionEntries.map(([key, { material }]) => ({
        cardId: cardByKey.get(key)!.id, version: 1, name: "初始版 · 创世时", isInitial: true,
        schemaVersion: MATERIAL_SCHEMA_VERSION,
        content: material.content as unknown as Prisma.InputJsonValue,
        dependencies: material.dependencies as unknown as Prisma.InputJsonValue,
      })),
      select: { id: true, cardId: true },
    });
    for (const version of createdVersions) initialIdByCardId.set(version.cardId, version.id);
  }

  // 3) 回填缺失的默认版本指针（同一事务连接上排队执行）
  await Promise.all([...cardByKey.values()]
    .filter((card) => !card.defaultVersionId)
    .map((card) => tx.materialCard.update({ where: { id: card.id }, data: { defaultVersionId: initialIdByCardId.get(card.id)! } })));
}

export async function createMaterialVersion(userId: string, input: {
  cardId: string; name: string; note?: string; content: MaterialVersionContent;
  dependencies: MaterialDependency[]; parentVersionId?: string; setDefault?: boolean;
}): Promise<MaterialVersion> {
  const content = parseMaterialVersionContent(input.content);
  const dependencies = MaterialDependencySchema.array().parse(input.dependencies);
  return prisma.$transaction(async (tx) => {
    const card = await tx.materialCard.findFirstOrThrow({ where: { id: input.cardId, userId } });
    if (input.parentVersionId) {
      await tx.materialVersion.findFirstOrThrow({ where: { id: input.parentVersionId, cardId: card.id } });
    }
    const latest = await tx.materialVersion.aggregate({ where: { cardId: card.id }, _max: { version: true } });
    const created = await tx.materialVersion.create({
      data: {
        cardId: card.id, version: (latest._max.version ?? 0) + 1,
        name: input.name, note: input.note,
        content: content as unknown as Prisma.InputJsonValue,
        dependencies: dependencies as unknown as Prisma.InputJsonValue,
        schemaVersion: MATERIAL_SCHEMA_VERSION,
        parentVersionId: input.parentVersionId,
      },
    });
    if (input.setDefault) await tx.materialCard.update({ where: { id: card.id }, data: { defaultVersionId: created.id } });
    return created;
  }, { isolationLevel: "Serializable" });
}

export async function updateMaterialCardIndex(
  userId: string,
  cardId: string,
  patch: { favorite?: boolean; hidden?: boolean; lastUsedAt?: Date | null },
) {
  return prisma.materialCard.update({ where: { id: cardId, userId }, data: patch });
}

export async function setDefaultMaterialVersion(userId: string, cardId: string, versionId: string) {
  const version = await prisma.materialVersion.findFirst({ where: { id: versionId, cardId, card: { userId } } });
  if (!version) throw new Error("素材版本不属于该卡片");
  return prisma.materialCard.update({ where: { id: cardId }, data: { defaultVersionId: versionId } });
}

export async function deleteMaterialVersion(userId: string, versionId: string) {
  return prisma.$transaction(async (tx) => {
    const version = await tx.materialVersion.findFirstOrThrow({ where: { id: versionId, card: { userId } }, include: { card: { include: { versions: { select: { id: true } } } } } });
    if (version.card.defaultVersionId === version.id) throw new Error("默认版本不可删除，请先切换默认版本");
    if (version.card.versions.length <= 1) throw new Error("素材卡至少保留一个版本");
    return tx.materialVersion.delete({ where: { id: version.id } });
  });
}
