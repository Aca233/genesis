import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { AbilityEventRecord, AbilityMutationTx, AbilityStoredRecord } from "./mutations";
import { applyAbilityChange, revealAbility } from "./mutations";

type ReviewMutationTx = AbilityMutationTx & {
  ability: AbilityMutationTx["ability"] & {
    findFirst: (args: { where: unknown }) => Promise<AbilityStoredRecord | null>;
  };
  chapter: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string; timelineId: string } | null>;
  };
  message: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string; chapterId: string; scale: string } | null>;
  };
};

interface TransactionOptions {
  sourceAbility?: AbilityStoredRecord | null;
  characterRaceId?: string;
  duplicateSource?: AbilityStoredRecord | null;
  chapter?: { id: string; timelineId: string } | null;
  message?: { id: string; chapterId: string; scale: string } | null;
  updateError?: Error & { code?: string; meta?: { target?: string[] } };
  createError?: Error;
}

function ability(overrides: Partial<AbilityStoredRecord> = {}): AbilityStoredRecord {
  return {
    id: "ability-1",
    timelineId: "timeline-1",
    entityId: "character-1",
    godId: null,
    name: "夜视",
    kind: "personal",
    effect: "看见黑暗",
    trigger: "夜晚",
    cost: "无",
    limitations: "无",
    mastery: "adept",
    state: "normal",
    visibility: "hidden",
    rumorText: null,
    bloodlineJustification: null,
    sourceAbilityId: null,
    lockedFields: [],
    version: 1,
    ...overrides,
  };
}

function transaction(initialAbility = ability(), options: TransactionOptions = {}) {
  let currentAbility = initialAbility;
  const sourceAbility = options.sourceAbility ?? null;
  const characterRaceId = options.characterRaceId ?? "race-1";
  const events = new Map<string, AbilityEventRecord>();
  const calls = { abilityFind: 0, update: 0, eventFind: 0, create: 0 };

  const tx: ReviewMutationTx = {
    entity: {
      findUnique: async ({ where }) =>
        where.id === characterRaceId || where.id === sourceAbility?.entityId
          ? { id: where.id, timelineId: "timeline-1", type: "race", raceId: null }
          : { id: "character-1", timelineId: "timeline-1", type: "character", raceId: characterRaceId },
    },
    god: { findUnique: async () => null },
    ability: {
      findUnique: async ({ where }) => {
        calls.abilityFind += 1;
        return where.id === sourceAbility?.id ? sourceAbility : currentAbility;
      },
      findFirst: async () => options.duplicateSource ?? null,
      update: async ({ where, data }) => {
        calls.update += 1;
        if (options.updateError !== undefined) {
          throw options.updateError;
        }
        if (
          where.id_version.id !== currentAbility.id ||
          where.id_version.version !== currentAbility.version
        ) {
          throw new Error("optimistic conflict");
        }
        currentAbility = {
          ...currentAbility,
          ...data,
          version: currentAbility.version + data.version.increment,
        };
        return currentAbility;
      },
    },
    chapter: {
      findUnique: async () => options.chapter ?? { id: "chapter-1", timelineId: "timeline-1" },
    },
    message: {
      findUnique: async () => options.message ?? { id: "message-1", chapterId: "chapter-1", scale: "scene" },
    },
    abilityEvent: {
      findUnique: async ({ where }) => {
        calls.eventFind += 1;
        return events.get(where.dedupeKey) ?? null;
      },
      create: async ({ data }) => {
        calls.create += 1;
        if (options.createError !== undefined) {
          throw options.createError;
        }
        const event = { id: `event-${calls.create}`, ...data };
        events.set(data.dedupeKey, event);
        return event;
      },
    },
  };

  const client = {
    $transaction: async <T>(operation: (transaction: ReviewMutationTx) => Promise<T>) => {
      const abilityBefore = currentAbility;
      const eventsBefore = new Map(events);
      try {
        return await operation(tx);
      } catch (error) {
        currentAbility = abilityBefore;
        events.clear();
        eventsBefore.forEach((event, key) => events.set(key, event));
        throw error;
      }
    },
  };

  return { tx, client, calls, currentAbility: () => currentAbility };
}

const change = {
  abilityId: "ability-1",
  version: 1,
  patch: { mastery: "expert" as const },
  event: {
    type: "improved" as const,
    chapterId: "chapter-1",
    messageId: "message-1",
    evidence: "第 1 章的实战记录",
    scale: "scene",
    dedupeKey: "chapter-1:ability-1:improved",
  },
};

describe("applyAbilityChange", () => {
  it("同一 dedupeKey 第二次调用只读取既有事件，不重复更新或创建", async () => {
    const { client, calls } = transaction();

    const first = await applyAbilityChange(client, change);
    expect(first.applied).toBe(true);
    expect(calls).toMatchObject({ abilityFind: 1, update: 1, create: 1 });

    const second = await applyAbilityChange(client, change);
    expect(second.applied).toBe(false);
    expect(calls).toMatchObject({ abilityFind: 1, update: 1, create: 1, eventFind: 2 });
  });
});

describe("revealAbility", () => {
  it("hidden -> rumored 必须提供 rumorText", async () => {
    await expect(
      revealAbility(transaction().client, {
        abilityId: "ability-1",
        version: 1,
        visibility: "rumored",
        event: {
          chapterId: "chapter-1",
          evidence: "目击者传言",
          scale: "scene",
          dedupeKey: "reveal-rumor",
        },
      }),
    ).rejects.toThrow(/rumorText/);
  });

  it("hidden -> rumored 不能以 null 充当 rumorText", async () => {
    await expect(
      revealAbility(transaction().client, {
        abilityId: "ability-1",
        version: 1,
        visibility: "rumored",
        rumorText: null,
        event: {
          chapterId: "chapter-1",
          evidence: "目击者传言",
          scale: "scene",
          dedupeKey: "reveal-rumor-null",
        },
      }),
    ).rejects.toThrow(/rumorText/);
  });

  it.each(["hidden", "rumored"] as const)(
    "%s -> known 写入 revealed 事件",
    async (visibility) => {
      const { client } = transaction(ability({ visibility, rumorText: "旧日传闻" }));

      const result = await revealAbility(client, {
        abilityId: "ability-1",
        version: 1,
        visibility: "known",
        event: {
          chapterId: "chapter-1",
          evidence: "真相被见证",
          scale: "scene",
          dedupeKey: `reveal-known-${visibility}`,
        },
      });

      expect(result.applied).toBe(true);
      expect(result.event).toMatchObject({ type: "revealed" });
      expect(result.ability).toMatchObject({ visibility: "known" });
    },
  );
});

describe("applyAbilityChange integrity guards", () => {
  it("拒绝移除既有 lockedFields", async () => {
    await expect(
      applyAbilityChange(
        transaction(ability({ lockedFields: ["effect"] })).client,
        {
          ...change,
          patch: { lockedFields: [] },
          event: { ...change.event, type: "mutated", dedupeKey: "lock-removal" },
        },
      ),
    ).rejects.toThrow(/lockedFields|锁定/);
  });

  it("拒绝同一人物同一来源的第二条活跃种族能力", async () => {
    const source = ability({
      id: "template-1",
      entityId: "race-1",
      kind: "racial_tradition",
      sourceAbilityId: null,
    });
    const derived = ability({
      id: "derived-1",
      kind: "racial_tradition",
      sourceAbilityId: "template-1",
    });
    const duplicate = ability({
      id: "derived-2",
      kind: "racial_tradition",
      sourceAbilityId: "template-1",
    });

    await expect(
      applyAbilityChange(transaction(derived, { sourceAbility: source, duplicateSource: duplicate }).client, {
        abilityId: "derived-1",
        version: 1,
        patch: { name: "新版影行" },
        event: { ...change.event, type: "mutated", dedupeKey: "duplicate-source" },
      }),
    ).rejects.toThrow(/重复.*来源/);
  });

  it("跨种族血脉理由必须来自持久化字段而非临时 mutation 参数", async () => {
    const source = ability({
      id: "celestial-template",
      entityId: "race-2",
      kind: "racial_innate",
      sourceAbilityId: null,
    });
    const derived = ability({
      id: "celestial-derived",
      kind: "racial_innate",
      sourceAbilityId: "celestial-template",
      bloodlineJustification: null,
    });
    const request = {
      abilityId: "celestial-derived",
      version: 1,
      patch: { name: "星裔夜视" },
      event: { ...change.event, type: "mutated", dedupeKey: "bloodline-required" },
    };

    await expect(
      applyAbilityChange(
        transaction(derived, { sourceAbility: source, characterRaceId: "race-1" }).client,
        { ...request, bloodlineJustification: "临时绕过不得生效" },
      ),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      applyAbilityChange(
        transaction(derived, { sourceAbility: source, characterRaceId: "race-1" }).client,
        request,
      ),
    ).rejects.toThrow(/bloodlineJustification/);

    const persisted = await applyAbilityChange(
      transaction(derived, { sourceAbility: source, characterRaceId: "race-1" }).client,
      { ...request, patch: { bloodlineJustification: "母系星裔血脉已记录" }, event: { ...request.event, dedupeKey: "bloodline-persisted" } },
    );
    expect(persisted.event.after).toMatchObject({
      bloodlineJustification: "母系星裔血脉已记录",
    });
  });

  it("将数据库来源唯一约束冲突转换为可读的重复来源错误", async () => {
    const source = ability({
      id: "template-1",
      entityId: "race-1",
      kind: "racial_tradition",
      sourceAbilityId: null,
    });
    const derived = ability({
      id: "derived-1",
      kind: "racial_tradition",
      sourceAbilityId: "template-1",
    });
    const uniqueError = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["entity_id", "source_ability_id"] },
    });

    await expect(
      applyAbilityChange(transaction(derived, { sourceAbility: source, updateError: uniqueError }).client, {
        abilityId: "derived-1",
        version: 1,
        patch: { name: "新版影行" },
        event: { ...change.event, type: "mutated", dedupeKey: "db-duplicate-source" },
      }),
    ).rejects.toThrow(/重复.*来源/);
  });

  it("拒绝跨时间线章节、错误消息归属和消息尺度不一致的证据", async () => {
    const cases = [
      transaction(ability(), { chapter: { id: "chapter-1", timelineId: "timeline-other" } }),
      transaction(ability(), { message: { id: "message-1", chapterId: "chapter-other", scale: "scene" } }),
      transaction(ability(), { message: { id: "message-1", chapterId: "chapter-1", scale: "era" } }),
    ];

    for (const { client } of cases) {
      await expect(applyAbilityChange(client, change)).rejects.toThrow(/章节|消息|尺度/);
    }
  });

  it("拒绝空白 evidence", async () => {
    await expect(
      applyAbilityChange(transaction().client, {
        ...change,
        event: { ...change.event, evidence: "  ", dedupeKey: "empty-evidence" },
      }),
    ).rejects.toThrow(/evidence/);
  });

  it("improved 只能将 mastery 提升一阶且不能改变 state", async () => {
    await expect(
      applyAbilityChange(transaction().client, {
        ...change,
        patch: { mastery: "master", state: "enhanced" },
        event: { ...change.event, dedupeKey: "jump-to-master" },
      }),
    ).rejects.toThrow(/improved/);
  });

  it("lost、sealed 与 restored 必须匹配目标状态", async () => {
    await expect(
      applyAbilityChange(transaction().client, {
        ...change,
        patch: { state: "normal" },
        event: { ...change.event, type: "lost", dedupeKey: "lost-not-lost" },
      }),
    ).rejects.toThrow(/lost/);
    await expect(
      applyAbilityChange(transaction(ability({ state: "lost" })).client, {
        ...change,
        patch: { state: "enhanced" },
        event: { ...change.event, type: "restored", dedupeKey: "restored-not-normal" },
      }),
    ).rejects.toThrow(/restored/);
    await expect(
      applyAbilityChange(transaction().client, {
        ...change,
        patch: { state: "normal" },
        event: { ...change.event, type: "sealed", dedupeKey: "sealed-not-sealed" },
      }),
    ).rejects.toThrow(/sealed/);
  });
});


describe("applyAbilityChange public boundary", () => {
  it.each([
    ["event type", { ...change, event: { ...change.event, type: "invalid" } }],
    ["scale", { ...change, event: { ...change.event, scale: "invalid" } }],
    ["state", { ...change, patch: { state: "invalid" } }],
    ["mastery", { ...change, patch: { mastery: "invalid" } }],
    ["visibility", { ...change, patch: { visibility: "invalid" } }],
  ])("在事务前拒绝非法 %s 枚举", async (_label, invalidInput) => {
    await expect(
      applyAbilityChange(transaction().client, invalidInput),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("在事件写入失败时回滚能力更新", async () => {
    const fixture = transaction(ability(), { createError: new Error("event write failed") });

    await expect(applyAbilityChange(fixture.client, change)).rejects.toThrow("event write failed");
    expect(fixture.currentAbility()).toMatchObject({ version: 1, mastery: "adept" });
  });
});
