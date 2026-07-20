import { describe, expect, it } from "vitest";
import { ExtractionSchema, extractorUserPrompt } from "@/lib/prompts/extractor";
import type {
  AbilityEventRecord,
  AbilityMutationTx,
  AbilityStoredRecord,
} from "./mutations";
import {
  applyAbilityExtraction,
  type AbilityExtractionClient,
  type AbilityExtractionOwner,
} from "./extraction";

function storedAbility(
  overrides: Partial<AbilityStoredRecord> & Pick<AbilityStoredRecord, "id" | "entityId" | "name" | "kind">,
): AbilityStoredRecord {
  return {
    timelineId: "timeline-1",
    godId: null,
    sourceAbilityId: null,
    effect: "依照既定技法行动",
    trigger: "主动施展",
    cost: "消耗体力",
    limitations: "必须完成训练",
    mastery: "novice",
    state: "normal",
    visibility: "known",
    rumorText: null,
    bloodlineJustification: null,
    lockedFields: [],
    version: 1,
    ...overrides,
  };
}

function extractionFixture() {
  const owners: AbilityExtractionOwner[] = [
    { id: "race-1", type: "race", name: "山民", aliases: [], raceId: null },
    { id: "race-2", type: "race", name: "羽民", aliases: [], raceId: null },
    { id: "character-1", type: "character", name: "阿岚", aliases: ["石女"], raceId: "race-1" },
  ];
  const abilities = new Map<string, AbilityStoredRecord>([
    [
      "tradition-native",
      storedAbility({
        id: "tradition-native",
        entityId: "race-1",
        name: "踏岩步",
        kind: "racial_tradition",
        mastery: "adept",
      }),
    ],
    [
      "tradition-foreign",
      storedAbility({
        id: "tradition-foreign",
        entityId: "race-2",
        name: "乘风术",
        kind: "racial_tradition",
        mastery: "adept",
      }),
    ],
    [
      "locked-personal",
      storedAbility({
        id: "locked-personal",
        entityId: "character-1",
        name: "听石心诀",
        kind: "personal",
        effect: "聆听岩层回声",
        lockedFields: ["effect"],
      }),
    ],
    [
      "trainable-personal",
      storedAbility({
        id: "trainable-personal",
        entityId: "character-1",
        name: "凿阵术",
        kind: "personal",
      }),
    ],
  ]);
  const messages = [
    {
      id: "message-4",
      index: 4,
      content: "阿岚在三年苦修后独自凿成七重石阵，凿阵术由生涩臻于纯熟。阿岚的听石心诀发生异变，仿佛能直接听见整座山脉的未来。",
      scale: "years",
    },
    {
      id: "message-8",
      index: 8,
      content: "山民长老见证阿岚走完断崖石阶，并正式授予她踏岩步的传承石符。",
      scale: "scene",
    },
  ];
  const events = new Map<string, AbilityEventRecord>();
  let nextAbility = 1;
  let nextEvent = 1;

  const tx = {
    entity: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const owner = owners.find((candidate) => candidate.id === where.id);
        return owner
          ? { id: owner.id, timelineId: "timeline-1", type: owner.type, raceId: owner.raceId }
          : null;
      },
    },
    god: { findUnique: async () => null },
    ability: {
      findUnique: async ({ where }: { where: { id: string } }) => abilities.get(where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        [...abilities.values()].find((ability) => {
          if (typeof where.entityId === "string" && ability.entityId !== where.entityId) return false;
          if (typeof where.sourceAbilityId === "string" && ability.sourceAbilityId !== where.sourceAbilityId) return false;
          const id = where.id as { not?: string } | undefined;
          return id?.not === undefined || ability.id !== id.not;
        }) ?? null,
      create: async ({ data }: { data: Omit<AbilityStoredRecord, "id" | "version"> }) => {
        const created = storedAbility({
          ...data,
          id: `learned-${nextAbility++}`,
          version: 1,
        });
        abilities.set(created.id, created);
        return created;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; version: number };
        data: Parameters<AbilityMutationTx["ability"]["updateMany"]>[0]["data"];
      }) => {
        const current = abilities.get(where.id);
        if (!current || current.version !== where.version) throw new Error("optimistic conflict");
        const { version, ...patch } = data;
        const updated = { ...current, ...patch, version: current.version + version.increment };
        abilities.set(updated.id, updated);
        return { count: 1 };
      },
    },
    chapter: {
      findUnique: async () => ({ id: "chapter-1", timelineId: "timeline-1" }),
    },
    message: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const message = messages.find((candidate) => candidate.id === where.id);
        return message
          ? { id: message.id, chapterId: "chapter-1", scale: message.scale }
          : null;
      },
    },
    abilityEvent: {
      findUnique: async ({ where }: { where: { dedupeKey: string } }) =>
        events.get(where.dedupeKey) ?? null,
      create: async ({ data }: { data: Omit<AbilityEventRecord, "id"> }) => {
        if (events.has(data.dedupeKey)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        const event = { id: `event-${nextEvent++}`, ...data };
        events.set(event.dedupeKey, event);
        return event;
      },
    },
  } satisfies AbilityMutationTx & {
    ability: AbilityMutationTx["ability"] & {
      create(args: { data: Omit<AbilityStoredRecord, "id" | "version"> }): Promise<AbilityStoredRecord>;
    };
  };

  const client = {
    ability: tx.ability,
    abilityEvent: tx.abilityEvent,
    $transaction: async <T>(operation: (transaction: typeof tx) => Promise<T>) => {
      const abilitySnapshot = new Map(abilities);
      const eventSnapshot = new Map(events);
      try {
        return await operation(tx);
      } catch (error) {
        abilities.clear();
        abilitySnapshot.forEach((value, key) => abilities.set(key, value));
        events.clear();
        eventSnapshot.forEach((value, key) => events.set(key, value));
        throw error;
      }
    },
  } as unknown as AbilityExtractionClient;

  return { client, owners, messages, abilities, events };
}

const baseExtraction = {
  newEntities: [],
  entityUpdates: [],
  godUpdates: [],
  revealSections: [],
};

describe("能力章末抽取契约", () => {
  it("要求能力变化携带证据消息 index 与至少十二字的正文证据", () => {
    const parsed = ExtractionSchema.parse({
      ...baseExtraction,
      abilityChanges: [
        {
          abilityId: "trainable-personal",
          ownerName: "阿岚",
          type: "improved",
          patch: { mastery: "adept" },
          evidenceMessageIndex: 4,
          evidence: "阿岚独自凿成七重石阵，技艺臻于纯熟",
        },
      ],
    });
    expect(parsed.abilityChanges[0]).toMatchObject({ evidenceMessageIndex: 4 });

    expect(
      ExtractionSchema.safeParse({
        ...baseExtraction,
        abilityChanges: [{ ...parsed.abilityChanges[0], evidence: "苦练有成" }],
      }).success,
    ).toBe(false);
  });

  it("按 [messageId | index | scale] 标注正文并提供能力、角色和种族上下文", () => {
    const prompt = extractorUserPrompt({
      chapterMessages: [
        { id: "message-4", index: 4, scale: "years", content: "阿岚苦修三年。", role: "narrator" },
      ],
      knownEntities: "阿岚(character) race=山民",
      knownGods: "—",
      knownAbilities: "[trainable-personal] 阿岚·凿阵术 locked=[]",
      lockedPaths: "—",
      scaleNote: "数年跨度",
    });

    expect(prompt).toContain("[message-4 | 4 | years]");
    expect(prompt).toContain("阿岚苦修三年");
    expect(prompt).toContain("trainable-personal");
  });
});

describe("applyAbilityExtraction", () => {
  it("用 mock LLM 跑一章：逐项拒绝非法变化并继续习得技艺，续跑保持幂等", async () => {
    const fixture = extractionFixture();
    const mockLlmExtraction = ExtractionSchema.parse({
      ...baseExtraction,
      abilityChanges: [
      {
        abilityId: "trainable-personal",
        ownerName: "阿岚",
        type: "improved" as const,
        patch: { mastery: "adept" as const },
        evidenceMessageIndex: 4,
        evidence: "正文里并不存在这段足以支持升级的训练证据",
      },
      {
        ownerName: "阿岚",
        sourceAbilityId: "tradition-foreign",
        type: "learned" as const,
        patch: { mastery: "novice" as const },
        evidenceMessageIndex: 8,
        evidence: "山民长老见证阿岚走完断崖石阶，并正式授予她踏岩步的传承石符",
      },
      {
        abilityId: "locked-personal",
        ownerName: "阿岚",
        type: "mutated" as const,
        patch: { effect: "直接听见整座山脉的未来" },
        evidenceMessageIndex: 4,
        evidence: "阿岚的听石心诀发生异变，仿佛能直接听见整座山脉的未来",
      },
      {
        abilityId: "trainable-personal",
        ownerName: "阿岚",
        type: "improved" as const,
        patch: { mastery: "adept" as const },
        evidenceMessageIndex: 4,
        evidence: "阿岚在三年苦修后独自凿成七重石阵，凿阵术由生涩臻于纯熟",
      },
      {
        ownerName: "阿岚",
        sourceAbilityId: "tradition-native",
        type: "learned" as const,
        patch: { mastery: "novice" as const },
        evidenceMessageIndex: 8,
        evidence: "山民长老见证阿岚走完断崖石阶，并正式授予她踏岩步的传承石符",
      },
      ],
    });
    const changes = mockLlmExtraction.abilityChanges;

    const first = await applyAbilityExtraction(fixture.client, {
      timelineId: "timeline-1",
      chapterId: "chapter-1",
      owners: fixture.owners,
      messages: fixture.messages,
      changes,
    });

    expect(first.applied).toHaveLength(2);
    expect(first.rejected.map(({ reason }) => reason)).toEqual([
      expect.stringMatching(/证据/),
      expect.stringMatching(/跨种族|主种族/),
      expect.stringMatching(/effect|锁定/),
    ]);
    expect([...fixture.events.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: "trainable-personal",
          chapterId: "chapter-1",
          messageId: "message-4",
          scale: "years",
          evidence: "阿岚在三年苦修后独自凿成七重石阵，凿阵术由生涩臻于纯熟",
        }),
        expect.objectContaining({
          chapterId: "chapter-1",
          messageId: "message-8",
          type: "learned",
          scale: "scene",
          evidence: "山民长老见证阿岚走完断崖石阶，并正式授予她踏岩步的传承石符",
        }),
      ]),
    );
    expect(
      [...fixture.abilities.values()].find(
        (ability) => ability.entityId === "character-1" && ability.sourceAbilityId === "tradition-native",
      ),
    ).toMatchObject({ mastery: "novice", version: 2 });

    const second = await applyAbilityExtraction(fixture.client, {
      timelineId: "timeline-1",
      chapterId: "chapter-1",
      owners: fixture.owners,
      messages: fixture.messages,
      changes,
    });

    expect(second.applied).toHaveLength(2);
    expect(second.applied.every(({ applied }) => applied === false)).toBe(true);
    expect(fixture.events).toHaveLength(2);
    expect(fixture.abilities.get("trainable-personal")).toMatchObject({ mastery: "adept", version: 2 });
    expect(
      [...fixture.abilities.values()].find(
        (ability) => ability.entityId === "character-1" && ability.sourceAbilityId === "tradition-native",
      ),
    ).toMatchObject({ mastery: "novice", version: 2 });
  });
});

it("拒绝虽然来自正文但与 improved 能力和事件无关的长引用", async () => {
  const fixture = extractionFixture();
  fixture.messages[0]!.content += " 天边乌云散去，商队点起灯火后继续向北方城镇赶路。";

  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: fixture.owners,
    messages: fixture.messages,
    changes: [{
      abilityId: "trainable-personal",
      ownerName: "阿岚",
      type: "improved",
      patch: { mastery: "adept" },
      evidenceMessageIndex: 4,
      evidence: "天边乌云散去，商队点起灯火后继续向北方城镇赶路",
    }],
  });

  expect(result.applied).toHaveLength(0);
  expect(result.rejected[0]?.reason).toMatch(/相关|支撑|能力名|事件/);
});
