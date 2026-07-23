import { describe, expect, it } from "vitest";
import {
  AbilityExtractionChangeSchema,
  ExtractionSchema,
  extractorUserPrompt,
} from "@/lib/prompts/extractor";
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
    { id: "god-1", type: "god", name: "岩母", aliases: [], raceId: null },
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
      content: "阿岚走完断崖石阶，并正式获授踏岩步的传承石符。",
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
    god: { findUnique: async ({ where }: { where: { id: string } }) => where.id === "god-1" ? { id: "god-1", timelineId: "timeline-1" } : null },
    ability: {
      findUnique: async ({ where }: { where: { id: string } }) => abilities.get(where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        [...abilities.values()].find((ability) => {
          if (typeof where.entityId === "string" && ability.entityId !== where.entityId) return false;
          if (typeof where.sourceAbilityId === "string" && ability.sourceAbilityId !== where.sourceAbilityId) return false;
          if (typeof where.godId === "string" && ability.godId !== where.godId) return false;
          if (typeof where.name === "string" && ability.name !== where.name) return false;
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
      delete: async ({ where }: { where: { id: string } }) => {
        const ability = abilities.get(where.id)!;
        abilities.delete(where.id);
        return ability;
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
      delete(args: { where: { id: string } }): Promise<AbilityStoredRecord>;
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
    const promotion = ExtractionSchema.parse({
      ...baseExtraction,
      majorCharacterPromotions: [{
        name: "阿岚", evidenceMessageIndex: 4,
        evidence: "阿岚独自守住山门，成为山民公认的领袖人物",
      }],
      abilityChanges: [],
    });
    expect(promotion.majorCharacterPromotions[0]).toMatchObject({ name: "阿岚", evidenceMessageIndex: 4 });

    expect(
      AbilityExtractionChangeSchema.safeParse({
        ...(parsed.abilityChanges[0] as Record<string, unknown>), evidence: "苦练有成",
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
        evidence: "阿岚走完断崖石阶，并正式获授踏岩步的传承石符",
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
        evidence: "阿岚走完断崖石阶，并正式获授踏岩步的传承石符",
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
          evidence: "阿岚走完断崖石阶，并正式获授踏岩步的传承石符",
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
  expect(result.rejected[0]?.reason).toMatch(/相关|支撑|能力名|事件|行动者/);
});

it("逐项拒绝 malformed abilityChanges 且继续应用合法项", async () => {
  const fixture = extractionFixture();
  const raw = ExtractionSchema.parse({
    ...baseExtraction,
    abilityChanges: [
      { ownerName: "阿岚", type: "improved", patch: {}, evidence: "缺少消息索引和能力 ID" },
      {
        abilityId: "trainable-personal",
        ownerName: "阿岚",
        type: "improved",
        patch: { mastery: "adept" },
        evidenceMessageIndex: 4,
        evidence: "阿岚在三年苦修后独自凿成七重石阵，凿阵术由生涩臻于纯熟",
      },
    ],
  });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: fixture.owners,
    messages: fixture.messages,
    changes: raw.abilityChanges,
  });
  expect(result.rejected[0]).toMatchObject({ index: 0, reason: expect.stringMatching(/格式|字段|校验/) });
  expect(result.applied).toHaveLength(1);
});

it("拒绝观察者被误认成能力行动者，接受 owner 与完整能力名相连的习得释义", async () => {
  const fixture = extractionFixture();
  fixture.messages.push(
    { id: "message-9", index: 9, scale: "scene", content: "阿岚看见白石终于学会踏岩步，便为同伴鼓掌。" },
    { id: "message-10", index: 10, scale: "scene", content: "阿岚终于能以踏岩步稳稳越过断崖，长老颔首认可。" },
  );
  const invalid = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ ownerName: "阿岚", sourceAbilityId: "tradition-native", type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 9, evidence: "阿岚看见白石终于学会踏岩步，便为同伴鼓掌" }],
  });
  expect(invalid.applied).toHaveLength(0);
  expect(invalid.rejected[0]?.reason).toMatch(/行动者|拥有者|归属/);

  const valid = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ ownerName: "阿岚", sourceAbilityId: "tradition-native", type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 10, evidence: "阿岚终于能以踏岩步稳稳越过断崖，长老颔首认可" }],
  });
  expect(valid.applied).toHaveLength(1);
});

it("拒绝师父行动而阿岚仅在旁观看，接受前句 owner 后句代词施展的 learned", async () => {
  const fixture = extractionFixture();
  fixture.messages.push(
    { id: "message-11", index: 11, scale: "scene", content: "师父苦修踏岩步越过断崖，阿岚在旁观看。" },
    { id: "message-12", index: 12, scale: "scene", content: "阿岚掌握诀窍。她施展踏岩步越过断崖。" },
  );
  const observer = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ ownerName: "阿岚", sourceAbilityId: "tradition-native", type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 11, evidence: "师父苦修踏岩步越过断崖，阿岚在旁观看" }],
  });
  expect(observer.applied).toHaveLength(0);
  expect(observer.rejected[0]?.reason).toMatch(/行动者|拥有者|旁观/);

  const actor = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ ownerName: "阿岚", sourceAbilityId: "tradition-native", type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 12, evidence: "阿岚掌握诀窍。她施展踏岩步越过断崖" }],
  });
  expect(actor.applied).toHaveLength(1);
});


it("拒绝 owner 命令其他实体施展能力，接受 owner 主语的能力结果构式", async () => {
  const commanded = extractionFixture();
  commanded.messages.push({
    id: "message-13",
    index: 13,
    scale: "scene",
    content: "阿岚命令白石施展踏岩步越过断崖。",
  });
  const rejected = await applyAbilityExtraction(commanded.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: commanded.owners,
    knownEntityNames: ["山民", "羽民", "阿岚", "白石"],
    messages: commanded.messages,
    changes: [{ ownerName: "阿岚", sourceAbilityId: "tradition-native", type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 13, evidence: "阿岚命令白石施展踏岩步越过断崖" }],
  });
  expect(rejected.applied).toHaveLength(0);
  expect(rejected.rejected[0]?.reason).toMatch(/行动者|命令|他人|主体/);

  const demonstrated = extractionFixture();
  demonstrated.messages.push({
    id: "message-14",
    index: 14,
    scale: "years",
    content: "阿岚持踏岩步秘卷反复试炼，今日已能独自越过断崖。",
  });
  const accepted = await applyAbilityExtraction(demonstrated.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: demonstrated.owners,
    knownEntityNames: ["山民", "羽民", "阿岚", "白石"],
    messages: demonstrated.messages,
    changes: [{ ownerName: "阿岚", sourceAbilityId: "tradition-native", type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 14, evidence: "阿岚持踏岩步秘卷反复试炼，今日已能独自越过断崖" }],
  });
  expect(accepted.applied).toHaveLength(1);
});

it.each([
  ["lost", { state: "lost" }, "阿岚的凿阵术并未失去，只是谣言仍在流传"],
  ["sealed", { state: "sealed" }, "阿岚的凿阵术没有被封印，依然可以正常施展"],
  ["awakened", { mastery: "novice" }, "阿岚的凿阵术未能觉醒，这次试炼以失败告终"],
] as const)("否定或失败语境不能证明 %s 事件", async (type, patch, evidence) => {
  const fixture = extractionFixture();
  if (type === "awakened") {
    fixture.abilities.set("trainable-personal", { ...fixture.abilities.get("trainable-personal")!, mastery: "unawakened" });
  }
  fixture.messages.push({ id: `message-negated-${type}`, index: 29, scale: "scene", content: `${evidence}。` });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type, patch, evidenceMessageIndex: 29, evidence }],
  });
  expect(result.applied).toHaveLength(0);
  expect(result.rejected[0]?.reason).toMatch(/否定|失败|事件|结果/);
});

it.each([
  ["lost", { state: "lost" }, "阿岚的凿阵术失去了，但后来恢复，能力仍在"],
  ["sealed", { state: "sealed" }, "阿岚尝试封印凿阵术，最终失败"],
  ["awakened", { mastery: "novice" }, "误会传开称阿岚的凿阵术已经觉醒，后来证实并非如此"],
] as const)("候选事件子句含尝试、纠正或恢复标记时拒绝 %s", async (type, patch, evidence) => {
  const fixture = extractionFixture();
  if (type === "awakened") {
    fixture.abilities.set("trainable-personal", { ...fixture.abilities.get("trainable-personal")!, mastery: "unawakened" });
  }
  fixture.messages.push({ id: `message-corrected-${type}`, index: 33, scale: "scene", content: `${evidence}。` });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type, patch, evidenceMessageIndex: 33, evidence }],
  });
  expect(result.applied).toHaveLength(0);
});

it("owner 作为主语时仍可证明被动类型 lost", async () => {
  const fixture = extractionFixture();
  const evidence = "阿岚在崩塌中失去了凿阵术";
  fixture.messages.push({ id: "message-owner-lost", index: 32, scale: "scene", content: `${evidence}。` });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type: "lost", patch: { state: "lost" }, evidenceMessageIndex: 32, evidence }],
  });
  expect(result.rejected).toHaveLength(0);
  expect(result.applied).toHaveLength(1);
});

it.each([
  ["sealed", { state: "sealed" }, "白石施法封印了阿岚的凿阵术"],
  ["lost", { state: "lost" }, "白石施法废去了阿岚的凿阵术"],
  ["impaired", { state: "impaired" }, "白石施法重击了阿岚的凿阵术"],
  ["deprecated", { state: "deprecated" }, "长老议会正式废弃了阿岚的凿阵术"],
  ["revealed", { visibility: "known" }, "白石查验秘卷后确认阿岚拥有凿阵术"],
] as const)("外部行动或确认可证明 owner 的被动 %s 事件", async (type, patch, evidence) => {
  const fixture = extractionFixture();
  if (type === "revealed") {
    fixture.abilities.set("trainable-personal", { ...fixture.abilities.get("trainable-personal")!, visibility: "rumored" });
  }
  fixture.messages.push({ id: `message-external-${type}`, index: 31, scale: "scene", content: `${evidence}。` });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners,
    knownEntityNames: ["阿岚", "白石", "长老议会"], messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type, patch, evidenceMessageIndex: 31, evidence }],
  });
  expect(result.rejected).toHaveLength(0);
  expect(result.applied).toHaveLength(1);
});

it("外部主动动词后插入其他宾语再提 owner ability 时拒绝", async () => {
  const fixture = extractionFixture();
  const evidence = "白石封印石门后查看阿岚的凿阵术";
  fixture.messages.push({ id: "message-direct-object", index: 35, scale: "scene", content: `${evidence}。` });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type: "sealed", patch: { state: "sealed" }, evidenceMessageIndex: 35, evidence }],
  });
  expect(result.applied).toHaveLength(0);
});

it("早期尝试失败不否定最终独立段明确成功", async () => {
  const fixture = extractionFixture();
  const evidence = "阿岚尝试唤醒凿阵术却失败，最终凿阵术成功觉醒";
  fixture.abilities.set("trainable-personal", { ...fixture.abilities.get("trainable-personal")!, mastery: "unawakened" });
  fixture.messages.push({ id: "message-final-success", index: 36, scale: "scene", content: `${evidence}。` });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type: "awakened", patch: { mastery: "novice" }, evidenceMessageIndex: 36, evidence }],
  });
  expect(result.rejected).toHaveLength(0);
  expect(result.applied).toHaveLength(1);
});

it.each([
  ["sealed", { state: "sealed" }, "白石封印石门，并查看阿岚的凿阵术"],
  ["lost", { state: "lost" }, "白石遗失钥匙，并查看阿岚的凿阵术"],
  ["impaired", { state: "impaired" }, "白石手臂受损，并查看阿岚的凿阵术"],
  ["deprecated", { state: "deprecated" }, "议会废弃旧律，并查看阿岚的凿阵术"],
  ["revealed", { visibility: "known" }, "白石确认石门关闭，并查看阿岚的凿阵术"],
] as const)("独立事件词与 owner ability 未锚定时拒绝 %s", async (type, patch, evidence) => {
  const fixture = extractionFixture();
  if (type === "revealed") {
    fixture.abilities.set("trainable-personal", { ...fixture.abilities.get("trainable-personal")!, visibility: "rumored" });
  }
  fixture.messages.push({ id: `message-unanchored-${type}`, index: 34, scale: "scene", content: `${evidence}。` });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type, patch, evidenceMessageIndex: 34, evidence }],
  });
  expect(result.applied).toHaveLength(0);
});

it.each([
  ["awakened", { mastery: "adept" }, "adept"],
  ["learned", { mastery: "novice" }, "novice"],
  ["improved", { mastery: "adept" }, "adept"],
  ["impaired", { effect: "隔空碎岩" }, "隔空碎岩"],
  ["sealed", { state: "sealed" }, "sealed"],
  ["restored", { state: "normal" }, "normal"],
  ["lost", { state: "lost" }, "lost"],
  ["revealed", { visibility: "known" }, "known"],
  ["deprecated", { state: "deprecated" }, "deprecated"],
] as const)("%s 不能仅靠证据复述 patch 字符串获得事件语义", async (type, patch, value) => {
  const fixture = extractionFixture();
  fixture.messages.push({
    id: `message-patch-${type}`,
    index: 30,
    scale: "scene",
    content: `阿岚的凿阵术档案字段写着${value}，除此之外没有发生任何事情。`,
  });
  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: fixture.owners,
    messages: fixture.messages,
    changes: [{
      abilityId: "trainable-personal",
      ownerName: "阿岚",
      type,
      patch,
      evidenceMessageIndex: 30,
      evidence: `阿岚的凿阵术档案字段写着${value}，除此之外没有发生任何事情`,
    }],
  });
  expect(result.applied).toHaveLength(0);
  expect(result.rejected[0]?.reason).toMatch(/事件|结果|行动/);
});

it("mutated 必须有与变更字段相连的明确变化结果，不能只复述 patch", async () => {
  const unsupported = extractionFixture();
  unsupported.messages.push({
    id: "message-15",
    index: 15,
    scale: "scene",
    content: "阿岚的凿阵术效果为隔空碎岩。",
  });
  const rejected = await applyAbilityExtraction(unsupported.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: unsupported.owners,
    knownEntityNames: ["山民", "羽民", "阿岚"],
    messages: unsupported.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type: "mutated", patch: { effect: "隔空碎岩" }, evidenceMessageIndex: 15, evidence: "阿岚的凿阵术效果为隔空碎岩" }],
  });
  expect(rejected.applied).toHaveLength(0);

  const explicit = extractionFixture();
  explicit.messages.push({
    id: "message-16",
    index: 16,
    scale: "scene",
    content: "阿岚的凿阵术发生蜕变，效果变成隔空碎岩。",
  });
  const accepted = await applyAbilityExtraction(explicit.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: explicit.owners,
    knownEntityNames: ["山民", "羽民", "阿岚"],
    messages: explicit.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type: "mutated", patch: { effect: "隔空碎岩" }, evidenceMessageIndex: 16, evidence: "阿岚的凿阵术发生蜕变，效果变成隔空碎岩" }],
  });
  expect(accepted.applied).toHaveLength(1);
});

it.each([
  new Error("transaction unavailable"),
  Object.assign(new Error("database unreachable"), { code: "P1001" }),
])("基础设施错误 %s 透传而不是进入 rejected", async (failure) => {
  const fixture = extractionFixture();
  const client = { ...fixture.client, $transaction: async () => { throw failure; } } as AbilityExtractionClient;
  await expect(applyAbilityExtraction(client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ abilityId: "trainable-personal", ownerName: "阿岚", type: "improved", patch: { mastery: "adept" }, evidenceMessageIndex: 4, evidence: "阿岚在三年苦修后独自凿成七重石阵，凿阵术由生涩臻于纯熟" }],
  })).rejects.toBe(failure);
});


it("无 ID 时可按 owner 类型创建证据支持的新能力，重复执行幂等", async () => {
  const cases = [
    { ownerName: "阿岚", kind: "personal", name: "裂石掌", type: "learned", patch: { mastery: "novice" }, evidence: "阿岚终于学会裂石掌，一掌击碎挡路巨岩" },
    { ownerName: "山民", kind: "racial_tradition", name: "听山礼", type: "learned", patch: { mastery: "novice" }, evidence: "山民正式传承听山礼，以此辨认地脉回声" },
    { ownerName: "岩母", kind: "divine", name: "镇岳神权", type: "awakened", patch: { mastery: "novice" }, evidence: "岩母终于觉醒镇岳神权，成功平息群山震动" },
  ] as const;
  for (const [offset, candidate] of cases.entries()) {
    const fixture = extractionFixture();
    fixture.messages.push({ id: `message-create-${offset}`, index: 40 + offset, scale: "scene", content: `${candidate.evidence}。` });
    const change = {
      ...candidate,
      effect: "以掌劲或仪式改变岩层",
      trigger: "主动施展",
      cost: "消耗体力",
      limitations: "需要接触岩石",
      lockedFields: [],
      evidenceMessageIndex: 40 + offset,
      evidence: candidate.evidence,
    };
    const first = await applyAbilityExtraction(fixture.client, {
      timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
      changes: [change],
    });
    const second = await applyAbilityExtraction(fixture.client, {
      timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
      changes: [change],
    });
    expect(first.applied).toHaveLength(1);
    expect(second.applied[0]?.applied).toBe(false);
    const created = [...fixture.abilities.values()].filter((ability) => ability.name === candidate.name);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: candidate.kind, mastery: "novice", visibility: "known", lockedFields: [] });
  }
});

it.each([
  [
    "learned",
    "鲁迪创造了名为960mm穿深新式APFSDS的工程战斗技术，并将其标准化为可反复装填施用的穿甲弹",
  ],
  [
    "awakened",
    "鲁迪首次稳定施展自行命名的960mm穿深新式APFSDS，一击贯穿了试验场的复合装甲靶",
  ],
] as const)("接受明确研发或首次稳定施展的新式工程战斗技术作为 %s personal ability", async (type, evidence) => {
  const fixture = extractionFixture();
  fixture.owners.push({
    id: "character-rudy",
    type: "character",
    name: "鲁迪",
    aliases: [],
    raceId: "race-native",
  });
  fixture.messages.push({
    id: `message-rudy-${type}`,
    index: 44,
    scale: "scene",
    content: `${evidence}。`,
  });

  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: fixture.owners,
    messages: fixture.messages,
    changes: [{
      ownerName: "鲁迪",
      name: "960mm穿深新式APFSDS",
      kind: "personal",
      type,
      effect: "以标准化超高速弹芯贯穿复合装甲",
      trigger: "完成装填、校准弹道并主动发射",
      cost: "消耗专用弹体与火炮寿命",
      limitations: "必须使用匹配口径的重型火炮",
      lockedFields: [],
      patch: { mastery: "novice" },
      evidenceMessageIndex: 44,
      evidence,
    }],
  });

  expect(result.rejected).toEqual([]);
  expect(result.applied).toHaveLength(1);
  expect([...fixture.abilities.values()]).toContainEqual(expect.objectContaining({
    entityId: "character-rudy",
    name: "960mm穿深新式APFSDS",
    kind: "personal",
    mastery: "novice",
  }));
});

it("把携带不存在 abilityId 的完整 learned 候选按新能力处理", async () => {
  const fixture = extractionFixture();
  fixture.owners.push({
    id: "character-rudy",
    type: "character",
    name: "鲁迪",
    aliases: [],
    raceId: "race-native",
  });
  const evidence = "鲁迪成功研发出960mm穿深新式APFSDS，并将这项工程战斗技术定型为可反复装填施用的穿甲弹";
  fixture.messages.push({
    id: "message-rudy-dangling-id",
    index: 47,
    scale: "scene",
    content: `${evidence}。`,
  });

  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: fixture.owners,
    messages: fixture.messages,
    changes: [{
      abilityId: "ability-rudy-960-not-in-context",
      ownerName: "鲁迪",
      name: "960mm穿深新式APFSDS",
      kind: "personal",
      type: "learned",
      effect: "以标准化超高速弹芯贯穿复合装甲",
      trigger: "完成装填、校准弹道并主动发射",
      cost: "消耗专用弹体与火炮寿命",
      limitations: "必须使用匹配口径的重型火炮",
      lockedFields: [],
      patch: { mastery: "novice" },
      evidenceMessageIndex: 47,
      evidence,
    }],
  });

  expect(result.rejected).toEqual([]);
  expect(result.applied).toHaveLength(1);
  expect([...fixture.abilities.values()]).toContainEqual(expect.objectContaining({
    entityId: "character-rudy",
    name: "960mm穿深新式APFSDS",
    kind: "personal",
  }));
});

it("新能力 evidence 为概括时从指定消息恢复连续正文并保存原文", async () => {
  const fixture = extractionFixture();
  fixture.owners.push({
    id: "character-rudy",
    type: "character",
    name: "鲁迪",
    aliases: [],
    raceId: "race-native",
  });
  const verbatimEvidence = "鲁迪首次稳定施展自行命名的960mm穿深新式APFSDS，一击贯穿了试验场的复合装甲靶";
  fixture.messages.push({
    id: "message-rudy-paraphrased-evidence",
    index: 48,
    scale: "scene",
    content: `炮组完成最后一次膛压检查。${verbatimEvidence}。观测员随即记录了完整弹道数据。`,
  });

  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: fixture.owners,
    messages: fixture.messages,
    changes: [{
      abilityId: "hallucinated-rudy-ability-id",
      ownerName: "鲁迪",
      name: "960mm穿深新式APFSDS",
      kind: "personal",
      type: "awakened",
      effect: "以标准化超高速弹芯贯穿复合装甲",
      trigger: "完成装填、校准弹道并主动发射",
      cost: "消耗专用弹体与火炮寿命",
      limitations: "必须使用匹配口径的重型火炮",
      lockedFields: [],
      patch: { mastery: "novice" },
      evidenceMessageIndex: 48,
      evidence: "鲁迪成功完成了960mm新式穿甲弹的首次稳定试射",
    }],
  });

  expect(result.rejected).toEqual([]);
  expect(result.applied).toHaveLength(1);
  const createdAbility = [...fixture.abilities.values()].find(
    (ability) => ability.name === "960mm穿深新式APFSDS",
  );
  expect([...fixture.events.values()]).toContainEqual(expect.objectContaining({
    abilityId: createdAbility?.id,
    messageId: "message-rudy-paraphrased-evidence",
    evidence: verbatimEvidence,
  }));
});

it("无法恢复正文证据或 owner-kind 越权时仍拒绝带错误 abilityId 的新能力", async () => {
  const unsupported = extractionFixture();
  unsupported.owners.push({
    id: "character-rudy",
    type: "character",
    name: "鲁迪",
    aliases: [],
    raceId: "race-native",
  });
  unsupported.messages.push({
    id: "message-rudy-failed-research",
    index: 49,
    scale: "scene",
    content: "鲁迪尝试研发960mm穿深新式APFSDS，但炮弹在出膛前解体，试验最终失败。",
  });
  const base = {
    abilityId: "missing-rudy-ability",
    ownerName: "鲁迪",
    name: "960mm穿深新式APFSDS",
    type: "learned" as const,
    effect: "以标准化超高速弹芯贯穿复合装甲",
    trigger: "完成装填、校准弹道并主动发射",
    cost: "消耗专用弹体与火炮寿命",
    limitations: "必须使用匹配口径的重型火炮",
    lockedFields: [],
    patch: { mastery: "novice" as const },
    evidenceMessageIndex: 49,
    evidence: "鲁迪已经成功研制并掌握了新式穿甲弹技术",
  };
  const unsupportedResult = await applyAbilityExtraction(unsupported.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: unsupported.owners,
    messages: unsupported.messages,
    changes: [{ ...base, kind: "personal" as const }],
  });
  expect(unsupportedResult.applied).toEqual([]);
  expect(unsupportedResult.rejected[0]?.reason).toMatch(/连续正文摘录/);
  expect([...unsupported.abilities.values()].some((ability) => ability.name === base.name)).toBe(false);

  const wrongKind = extractionFixture();
  wrongKind.owners.push(...unsupported.owners.filter((owner) => owner.name === "鲁迪"));
  wrongKind.messages.push({
    id: "message-rudy-wrong-kind",
    index: 49,
    scale: "scene",
    content: "鲁迪成功研发出960mm穿深新式APFSDS，并将这项工程战斗技术正式定型。",
  });
  const wrongKindResult = await applyAbilityExtraction(wrongKind.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: wrongKind.owners,
    messages: wrongKind.messages,
    changes: [{
      ...base,
      kind: "divine",
      evidence: "鲁迪成功研发出960mm穿深新式APFSDS，并将这项工程战斗技术正式定型",
    }],
  });
  expect(wrongKindResult.applied).toEqual([]);
  expect(wrongKindResult.rejected[0]?.reason).toMatch(/character|kind|personal/);
});

it("单次环境偶发效果不能被登记为鲁迪的新能力", async () => {
  const fixture = extractionFixture();
  fixture.owners.push({
    id: "character-rudy",
    type: "character",
    name: "鲁迪",
    aliases: [],
    raceId: "race-native",
  });
  const evidence = "鲁迪发射普通炮弹时恰逢地脉爆炸，冲击波偶然贯穿了试验场的复合装甲靶";
  fixture.messages.push({
    id: "message-rudy-accident",
    index: 46,
    scale: "scene",
    content: `${evidence}。`,
  });

  const result = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1",
    chapterId: "chapter-1",
    owners: fixture.owners,
    messages: fixture.messages,
    changes: [{
      ownerName: "鲁迪",
      name: "地脉穿甲",
      kind: "personal",
      type: "learned",
      effect: "借助地脉爆炸贯穿装甲",
      trigger: "发射炮弹",
      cost: "消耗炮弹",
      limitations: "需要地脉恰好爆炸",
      lockedFields: [],
      patch: { mastery: "novice" },
      evidenceMessageIndex: 46,
      evidence,
    }],
  });

  expect(result.applied).toEqual([]);
  expect(result.rejected[0]?.reason).toMatch(/能力事件|行动主体|正文证据/);
});

it("拒绝无 ID 新能力的 owner-kind 越权、重复名和缺失证据字段", async () => {
  const fixture = extractionFixture();
  fixture.messages.push({ id: "message-create-invalid", index: 45, scale: "scene", content: "阿岚终于学会裂石掌，一掌击碎挡路巨岩。" });
  const base = {
    ownerName: "阿岚", name: "裂石掌", type: "learned", patch: { mastery: "novice" },
    effect: "击碎巨岩", trigger: "挥掌", cost: "体力", limitations: "近距离", lockedFields: [],
    evidenceMessageIndex: 45, evidence: "阿岚终于学会裂石掌，一掌击碎挡路巨岩",
  };
  const invalidKind = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ ...base, kind: "divine" }],
  });
  expect(invalidKind.rejected[0]?.reason).toMatch(/kind|人物|personal/);

  const missing = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ ownerName: "阿岚", name: "裂石掌", kind: "personal", type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 45, evidence: base.evidence }],
  });
  expect(missing.rejected[0]?.reason).toMatch(/格式|字段|校验/);

  fixture.abilities.set("duplicate-personal", storedAbility({ id: "duplicate-personal", entityId: "character-1", name: "裂石掌", kind: "personal" }));
  const duplicate = await applyAbilityExtraction(fixture.client, {
    timelineId: "timeline-1", chapterId: "chapter-1", owners: fixture.owners, messages: fixture.messages,
    changes: [{ ...base, kind: "personal" }],
  });
  expect(duplicate.rejected[0]?.reason).toMatch(/重复|已存在/);
});
