import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { extractDeckMaterials } from "./extract-deck";
import { archiveInitialDeck } from "./repository";
import { MATERIAL_SCHEMA_VERSION } from "./schemas";

type CardRow = { id: string; sourceKind: string; sourceRef: string; defaultVersionId: string | null };
type VersionRow = { id: string; cardId: string; isInitial: boolean };

/** 内存版事务客户端：只实现 archiveInitialDeck 用到的批量查询。 */
function createFakeTx(seed: { cards?: CardRow[]; versions?: VersionRow[] } = {}) {
  const cards: CardRow[] = [...(seed.cards ?? [])];
  const versions: VersionRow[] = [...(seed.versions ?? [])];
  let nextId = 0;
  const store = {
    materialCard: {
      findMany: vi.fn(async ({ where }: { where: { OR: { sourceKind: string; sourceRef: string }[] } }) =>
        cards.filter((card) => where.OR.some((pair) => pair.sourceKind === card.sourceKind && pair.sourceRef === card.sourceRef))),
      createManyAndReturn: vi.fn(async ({ data }: { data: { sourceKind: string; sourceRef: string }[] }) =>
        data.map((row) => {
          const created: CardRow = { id: `card-${++nextId}`, sourceKind: row.sourceKind, sourceRef: row.sourceRef, defaultVersionId: null };
          cards.push(created);
          return created;
        })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { defaultVersionId: string } }) => {
        const card = cards.find((item) => item.id === where.id)!;
        card.defaultVersionId = data.defaultVersionId;
        return card;
      }),
    },
    materialVersion: {
      findMany: vi.fn(async ({ where }: { where: { cardId: { in: string[] }; isInitial: boolean } }) =>
        versions.filter((version) => where.cardId.in.includes(version.cardId) && version.isInitial === where.isInitial)),
      createManyAndReturn: vi.fn(async ({ data }: { data: { cardId: string }[] }) =>
        data.map((row) => {
          const created: VersionRow = { id: `version-${++nextId}`, cardId: row.cardId, isInitial: true };
          versions.push(created);
          return created;
        })),
    },
  };
  return { tx: store as unknown as Prisma.TransactionClient, store, cards, versions };
}

const worldInput = { worldId: "world-1", worldName: "测试界" } as const;

describe("archiveInitialDeck", () => {
  it("首次归档只用固定数量的批量查询写入全部素材", async () => {
    const deck = completeDeck();
    const materials = extractDeckMaterials(deck);
    const { tx, store, cards, versions } = createFakeTx();

    await archiveInitialDeck(tx, "test-user", { ...worldInput, deck });

    // 批量查询各一次，而非逐素材 4 次往返
    expect(store.materialCard.findMany).toHaveBeenCalledTimes(1);
    expect(store.materialCard.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(store.materialVersion.findMany).toHaveBeenCalledTimes(1);
    expect(store.materialVersion.createManyAndReturn).toHaveBeenCalledTimes(1);

    expect(cards).toHaveLength(materials.length);
    expect(versions).toHaveLength(materials.length);
    // 卡片写入保留原 upsert 的 create 字段与组合 sourceRef
    const cardData = store.materialCard.createManyAndReturn.mock.calls[0]![0].data as Record<string, unknown>[];
    expect(cardData[0]).toMatchObject({
      userId: "test-user", kind: materials[0]!.kind, name: materials[0]!.name, summary: materials[0]!.summary,
      sourceWorldId: "world-1", sourceWorldName: "测试界",
      sourceKind: materials[0]!.sourceKind, sourceRef: `world-1:${materials[0]!.sourceKind}:${materials[0]!.sourceRef}`,
    });
    // 版本写入保留原 create 的初始版字段
    const versionData = store.materialVersion.createManyAndReturn.mock.calls[0]![0].data as Record<string, unknown>[];
    expect(versionData[0]).toMatchObject({
      version: 1, name: "初始版 · 创世时", isInitial: true, schemaVersion: MATERIAL_SCHEMA_VERSION,
      content: materials[0]!.content, dependencies: materials[0]!.dependencies,
    });
    // 每张卡都回填了自己初始版本的默认指针
    expect(store.materialCard.update).toHaveBeenCalledTimes(materials.length);
    for (const card of cards) {
      const initial = versions.find((version) => version.cardId === card.id && version.isInitial);
      expect(card.defaultVersionId).toBe(initial!.id);
    }
  });

  it("重复归档幂等：不新建卡、不新建版本、不改默认指针", async () => {
    const deck = completeDeck();
    const first = createFakeTx();
    await archiveInitialDeck(first.tx, "test-user", { ...worldInput, deck });

    const second = createFakeTx({ cards: first.cards, versions: first.versions });
    await archiveInitialDeck(second.tx, "test-user", { ...worldInput, deck });

    expect(second.store.materialCard.createManyAndReturn).not.toHaveBeenCalled();
    expect(second.store.materialVersion.createManyAndReturn).not.toHaveBeenCalled();
    expect(second.store.materialCard.update).not.toHaveBeenCalled();
    expect(second.cards).toHaveLength(first.cards.length);
    expect(second.versions).toHaveLength(first.versions.length);
  });

  it("为缺初始版本的既有卡补建版本并回填默认指针", async () => {
    const deck = completeDeck();
    const materials = extractDeckMaterials(deck);
    const existing: CardRow = {
      id: "card-existing", sourceKind: materials[0]!.sourceKind,
      sourceRef: `world-1:${materials[0]!.sourceKind}:${materials[0]!.sourceRef}`, defaultVersionId: null,
    };
    const { tx, store, versions } = createFakeTx({ cards: [existing] });

    await archiveInitialDeck(tx, "test-user", { ...worldInput, deck });

    // 既有卡不重建，其余素材照常补齐
    const cardData = store.materialCard.createManyAndReturn.mock.calls[0]![0].data as { sourceRef: string }[];
    expect(cardData).toHaveLength(materials.length - 1);
    expect(cardData.some((row) => row.sourceRef === existing.sourceRef)).toBe(false);
    // 既有卡补建初始版本并指为默认
    const initial = versions.find((version) => version.cardId === existing.id);
    expect(initial).toBeDefined();
    expect(existing.defaultVersionId).toBe(initial!.id);
  });

  it("重复 sourceRef 以先出现的素材为准", async () => {
    const deck = completeDeck();
    // 让第二个人物的首个能力与第一个人物的首个能力同 ref，制造重复的组合 sourceRef
    const duplicatedRef = deck.majorCharacters[0]!.abilities[0]!.ref;
    deck.majorCharacters[1]!.abilities[0]!.ref = duplicatedRef;
    const { tx, store, cards } = createFakeTx();

    await archiveInitialDeck(tx, "test-user", { ...worldInput, deck });

    const sourceRef = `world-1:ability:${duplicatedRef}`;
    const duplicatedCards = cards.filter((card) => card.sourceRef === sourceRef);
    expect(duplicatedCards).toHaveLength(1);
    const versionData = store.materialVersion.createManyAndReturn.mock.calls[0]![0].data as { cardId: string; content: { owner?: { sourceRef: string } } }[];
    const version = versionData.find((row) => row.cardId === duplicatedCards[0]!.id);
    expect(version?.content.owner?.sourceRef).toBe(deck.majorCharacters[0]!.ref);
  });
});
