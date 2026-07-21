import type { MaterialVersion, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PantheonWorldDeck } from "@/lib/cards/schemas";
import { extractDeckMaterials } from "./extract-deck";
import { MATERIAL_SCHEMA_VERSION, parseMaterialVersionContent, type MaterialVersionContent } from "./schemas";
import { MaterialDependencySchema, type MaterialDependency } from "./types";

export async function archiveInitialDeck(
  tx: Prisma.TransactionClient,
  input: { worldId: string; worldName: string; deck: PantheonWorldDeck },
): Promise<void> {
  for (const material of extractDeckMaterials(input.deck)) {
    const sourceRef = `${input.worldId}:${material.sourceKind}:${material.sourceRef}`;
    const card = await tx.materialCard.upsert({
      where: { userId_sourceKind_sourceRef: { userId: "local", sourceKind: material.sourceKind, sourceRef } },
      create: {
        userId: "local", kind: material.kind, name: material.name, summary: material.summary,
        sourceWorldId: input.worldId, sourceWorldName: input.worldName,
        sourceKind: material.sourceKind, sourceRef,
      },
      update: {},
    });
    let initial = await tx.materialVersion.findFirst({ where: { cardId: card.id, isInitial: true } });
    if (!initial) {
      initial = await tx.materialVersion.create({
        data: {
          cardId: card.id, version: 1, name: "初始版 · 创世时", isInitial: true,
          schemaVersion: MATERIAL_SCHEMA_VERSION,
          content: material.content as unknown as Prisma.InputJsonValue,
          dependencies: material.dependencies as unknown as Prisma.InputJsonValue,
        },
      });
    }
    if (!card.defaultVersionId) {
      await tx.materialCard.update({ where: { id: card.id }, data: { defaultVersionId: initial.id } });
    }
  }
}

export async function createMaterialVersion(input: {
  cardId: string; name: string; note?: string; content: MaterialVersionContent;
  dependencies: MaterialDependency[]; parentVersionId?: string; setDefault?: boolean;
}): Promise<MaterialVersion> {
  const content = parseMaterialVersionContent(input.content);
  const dependencies = MaterialDependencySchema.array().parse(input.dependencies);
  return prisma.$transaction(async (tx) => {
    const card = await tx.materialCard.findFirstOrThrow({ where: { id: input.cardId, userId: "local" } });
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
  cardId: string,
  patch: { favorite?: boolean; hidden?: boolean; lastUsedAt?: Date | null },
) {
  return prisma.materialCard.update({ where: { id: cardId, userId: "local" }, data: patch });
}

export async function setDefaultMaterialVersion(cardId: string, versionId: string) {
  const version = await prisma.materialVersion.findFirst({ where: { id: versionId, cardId, card: { userId: "local" } } });
  if (!version) throw new Error("素材版本不属于该卡片");
  return prisma.materialCard.update({ where: { id: cardId }, data: { defaultVersionId: versionId } });
}

export async function deleteMaterialVersion(versionId: string) {
  return prisma.$transaction(async (tx) => {
    const version = await tx.materialVersion.findFirstOrThrow({ where: { id: versionId, card: { userId: "local" } }, include: { card: { include: { versions: { select: { id: true } } } } } });
    if (version.card.defaultVersionId === version.id) throw new Error("默认版本不可删除，请先切换默认版本");
    if (version.card.versions.length <= 1) throw new Error("素材卡至少保留一个版本");
    return tx.materialVersion.delete({ where: { id: version.id } });
  });
}
