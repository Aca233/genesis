import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { materializeDeckAbilities } from "./embark";
import {
  materializeEmbarkDeck,
  runEmbarkTransaction,
} from "@/lib/embark/mutations";

import { completeCreatorDeck, completeDeck } from "./embark.test-fixtures";

type StoredAbility = {
  id: string;
  timelineId: string;
  entityId: string | null;
  godId: string | null;
  sourceAbilityId: string | null;
  kind: string;
  name: string;
  bloodlineJustification?: string | null;
};

function fakeTransaction() {
  const entities = new Map<string, { id: string; timelineId: string; type: string; raceId: string | null }>([
    ["race-db-human", { id: "race-db-human", timelineId: "timeline-1", type: "race", raceId: null }],
    ...Array.from({ length: 6 }, (_, index) => [
      `character-db-${index + 1}`,
      { id: `character-db-${index + 1}`, timelineId: "timeline-1", type: "character", raceId: "race-db-human" },
    ] as const),
  ]);
  const gods = new Map<string, { id: string; timelineId: string }>([
    ["god-db-player", { id: "god-db-player", timelineId: "timeline-1" }],
    ...Array.from({ length: 4 }, (_, index) => [
      `god-db-major-${index + 1}`,
      { id: `god-db-major-${index + 1}`, timelineId: "timeline-1" },
    ] as const),
  ]);
  const abilities: StoredAbility[] = [];
  const memberships: Array<{ characterId: string; factionId: string; role: string; isPrimary: boolean }> = [];

  return {
    abilities,
    memberships,
    tx: {
      entity: { findUnique: async ({ where }: { where: { id: string } }) => entities.get(where.id) ?? null },
      god: { findUnique: async ({ where }: { where: { id: string } }) => gods.get(where.id) ?? null },
      ability: {
        findUnique: async ({ where }: { where: { id: string } }) => abilities.find((ability) => ability.id === where.id) ?? null,
        create: async ({ data }: { data: Omit<StoredAbility, "id"> }) => {
          const created = { ...data, id: `ability-db-${abilities.length + 1}` };
          abilities.push(created);
          return created;
        },
      },
      entityMembership: {
        create: async ({ data }: { data: { characterId: string; factionId: string; role: string; isPrimary: boolean } }) => {
          memberships.push(data);
          return { id: `membership-${memberships.length}`, ...data };
        },
      },
    },
  };
}

describe("materializeDeckAbilities", () => {
  it("物化完整卡组的能力、来源映射与人物势力关系", async () => {
    const deck = completeDeck();
    const fake = fakeTransaction();
    const ids = {
      raceByRef: new Map([["race-human", "race-db-human"]]),
      factionByRef: new Map([
        ["faction-court", "faction-db-court"],
        ["faction-archive", "faction-db-archive"],
      ]),
      characterByRef: new Map(Array.from({ length: 6 }, (_, index) => [`character-${index + 1}`, `character-db-${index + 1}`])),
      godByRef: new Map<string, string>([
        ["god-player", "god-db-player"],
        ...Array.from({ length: 4 }, (_, index) =>
          [`god-major-${index + 1}`, `god-db-major-${index + 1}`] as [string, string],
        ),
      ]),
      abilityByRef: new Map<string, string>(),
    };

    await materializeDeckAbilities(fake.tx, "timeline-1", deck, ids);

    expect(ids.abilityByRef.get("ability-human-sight")).toBe("ability-db-1");
    expect(fake.memberships).toContainEqual({
      characterId: "character-db-1",
      factionId: "faction-db-court",
      role: "执政官",
      isPrimary: true,
    });
    expect(fake.abilities.filter((ability) => ability.entityId === "race-db-human")).toHaveLength(2);
    expect(fake.abilities.filter((ability) => ability.godId !== null)).toHaveLength(15);
    expect(fake.abilities.filter((ability) => ability.kind === "personal")).toHaveLength(12);

    const learned = fake.abilities.find(
      (ability) => ability.name === "ability-human-ritual之能" && ability.entityId === "character-db-1",
    );
    expect(learned?.entityId).toBe("character-db-1");
    expect(learned?.sourceAbilityId).toBe(ids.abilityByRef.get("ability-human-ritual"));
    expect(fake.abilities.find((ability) => ability.name === "ability-character-1-override之能")?.sourceAbilityId)
      .toBe(ids.abilityByRef.get("ability-human-sight"));
  });

  it("Creator 仅物化主神神权及共享的种族和人物能力", async () => {
    const deck = completeCreatorDeck();
    const fake = fakeTransaction();
    const ids = {
      raceByRef: new Map([["race-human", "race-db-human"]]),
      factionByRef: new Map([
        ["faction-court", "faction-db-court"],
        ["faction-archive", "faction-db-archive"],
      ]),
      characterByRef: new Map(Array.from({ length: 6 }, (_, index) => [
        `character-${index + 1}`,
        `character-db-${index + 1}`,
      ])),
      godByRef: new Map<string, string>(Array.from({ length: 4 }, (_, index) => [
        `god-major-${index + 1}`,
        `god-db-major-${index + 1}`,
      ])),
      abilityByRef: new Map<string, string>(),
    };

    await materializeDeckAbilities(fake.tx, "timeline-1", deck, ids);

    expect(fake.abilities.filter((ability) => ability.godId !== null)).toHaveLength(12);
    expect(fake.abilities.some((ability) => ability.name.startsWith("ability-player-"))).toBe(false);
    expect(fake.abilities.filter((ability) => ability.entityId === "race-db-human")).toHaveLength(2);
    expect(fake.abilities.filter((ability) => ability.kind === "personal")).toHaveLength(12);
  });

  it("在同一事务中创建种族、势力、地点、人物、神与第一章", async () => {
    const deck = completeDeck();
    const entities = new Map<string, { id: string; timelineId: string; type: string; raceId: string | null }>();
    const gods = new Map<string, { id: string; timelineId: string }>();
    const abilities: StoredAbility[] = [];
    const entityCreates: Array<Record<string, unknown>> = [];
    const memberships: Array<{ characterId: string; factionId: string; role: string; isPrimary: boolean }> = [];
    let entityIndex = 0;
    let godIndex = 0;

    const tx = {
      timeline: { create: async () => ({ id: "timeline-1" }) },
      god: {
        create: async ({ data }: { data: { timelineId: string } }) => {
          const god = { id: `god-db-${++godIndex}`, timelineId: data.timelineId };
          gods.set(god.id, god);
          return god;
        },
        findUnique: async ({ where }: { where: { id: string } }) => gods.get(where.id) ?? null,
      },
      entity: {
        create: async ({ data }: { data: { timelineId: string; type: string; raceId?: string | null } }) => {
          const entity = {
            id: `entity-db-${++entityIndex}`,
            timelineId: data.timelineId,
            type: data.type,
            raceId: data.raceId ?? null,
          };
          entities.set(entity.id, entity);
          entityCreates.push(data as unknown as Record<string, unknown>);
          return entity;
        },
        findUnique: async ({ where }: { where: { id: string } }) => entities.get(where.id) ?? null,
      },
      ability: {
        findUnique: async ({ where }: { where: { id: string } }) => abilities.find((ability) => ability.id === where.id) ?? null,
        create: async ({ data }: { data: Omit<StoredAbility, "id"> }) => {
          const ability = { ...data, id: `ability-db-${abilities.length + 1}` };
          abilities.push(ability);
          return ability;
        },
      },
      entityMembership: {
        create: async ({ data }: { data: { characterId: string; factionId: string; role: string; isPrimary: boolean } }) => {
          memberships.push(data);
          return { id: `membership-${memberships.length}`, ...data };
        },
      },
      chapter: { create: async () => ({ id: "chapter-1" }) },
      world: { update: async () => ({ id: "world-1" }) },
    } as unknown as Prisma.TransactionClient;

    await expect(materializeEmbarkDeck(tx, "world-1", deck)).resolves.toEqual({
      timelineId: "timeline-1",
      chapterId: "chapter-1",
    });

    expect(entityCreates.map(({ type }) => type)).toEqual([
      "race",
      "faction",
      "faction",
      "place",
      "character",
      "character",
      "character",
      "character",
      "character",
      "character",
    ]);
    expect([...entities.values()].filter((entity) => entity.type === "character").every(
      (character) => character.raceId === "entity-db-1",
    )).toBe(true);
    expect(entityCreates[1]?.sections).toEqual({
      create: expect.arrayContaining([
        expect.objectContaining({ key: "keyFigures", content: { names: ["人物1", "人物2"] } }),
      ]),
    });
    expect(memberships).toContainEqual(expect.objectContaining({ role: "执政官", isPrimary: true }));
    expect(abilities.filter((ability) => ability.godId !== null)).toHaveLength(15);
  });

  it("引用物化失败时事务不提交任何已暂存写入", async () => {
    const deck = completeDeck();
    deck.majorCharacters[0]!.learnedTraditionRefs = [{ sourceAbilityRef: "missing-tradition" }];
    const committedWrites: string[] = [];

    const transactionRunner = {
      $transaction: async <T,>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => {
        const stagedWrites: string[] = [];
        const entities = new Map<string, { id: string; timelineId: string; type: string; raceId: string | null }>();
        const gods = new Map<string, { id: string; timelineId: string }>();
        const abilities: StoredAbility[] = [];
        let entityIndex = 0;
        let godIndex = 0;

        const tx = {
          timeline: {
            create: async () => {
              stagedWrites.push("timeline");
              return { id: "timeline-rollback" };
            },
          },
          god: {
            create: async ({ data }: { data: { timelineId: string } }) => {
              const god = { id: `god-rollback-${++godIndex}`, timelineId: data.timelineId };
              gods.set(god.id, god);
              stagedWrites.push("god");
              return god;
            },
            findUnique: async ({ where }: { where: { id: string } }) => gods.get(where.id) ?? null,
          },
          entity: {
            create: async ({ data }: { data: { timelineId: string; type: string; raceId?: string | null } }) => {
              const entity = {
                id: `entity-rollback-${++entityIndex}`,
                timelineId: data.timelineId,
                type: data.type,
                raceId: data.raceId ?? null,
              };
              entities.set(entity.id, entity);
              stagedWrites.push(entity.type);
              return entity;
            },
            findUnique: async ({ where }: { where: { id: string } }) => entities.get(where.id) ?? null,
          },
          ability: {
            findUnique: async ({ where }: { where: { id: string } }) =>
              abilities.find((ability) => ability.id === where.id) ?? null,
            create: async ({ data }: { data: Omit<StoredAbility, "id"> }) => {
              const ability = { ...data, id: `ability-rollback-${abilities.length + 1}` };
              abilities.push(ability);
              stagedWrites.push("ability");
              return ability;
            },
          },
          entityMembership: {
            create: async () => {
              stagedWrites.push("membership");
              return { id: "membership-rollback" };
            },
          },
          chapter: {
            create: async () => {
              stagedWrites.push("chapter");
              return { id: "chapter-rollback" };
            },
          },
          world: {
            update: async () => {
              stagedWrites.push("world-update");
              return { id: "world-rollback" };
            },
          },
        } as unknown as Prisma.TransactionClient;

        const result = await callback(tx);
        committedWrites.push(...stagedWrites);
        return result;
      },
    };

    await expect(runEmbarkTransaction(transactionRunner, "world-rollback", deck)).rejects.toThrow(
      '无法解析能力引用 "missing-tradition"',
    );
    expect(committedWrites).toEqual([]);
  });
});
