import { describe, expect, it } from "vitest";
import type { AbilityEventRecord, AbilityMutationTx, AbilityStoredRecord } from "./mutations";
import { applyAbilityChange, revealAbility } from "./mutations";

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
    sourceAbilityId: null,
    lockedFields: [],
    version: 1,
    ...overrides,
  };
}

function transaction(initialAbility = ability()) {
  let currentAbility = initialAbility;
  const events = new Map<string, AbilityEventRecord>();
  const calls = { abilityFind: 0, update: 0, eventFind: 0, create: 0 };

  const tx: AbilityMutationTx = {
    entity: {
      findUnique: async () => ({
        id: "character-1",
        timelineId: "timeline-1",
        type: "character",
        raceId: "race-1",
      }),
    },
    god: { findUnique: async () => null },
    ability: {
      findUnique: async () => {
        calls.abilityFind += 1;
        return currentAbility;
      },
      update: async ({ where, data }) => {
        calls.update += 1;
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
    abilityEvent: {
      findUnique: async ({ where }) => {
        calls.eventFind += 1;
        return events.get(where.dedupeKey) ?? null;
      },
      create: async ({ data }) => {
        calls.create += 1;
        const event = { id: `event-${calls.create}`, ...data };
        events.set(data.dedupeKey, event);
        return event;
      },
    },
  };

  return { tx, calls };
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
    const { tx, calls } = transaction();

    const first = await applyAbilityChange(tx, change);
    expect(first.applied).toBe(true);
    expect(calls).toMatchObject({ abilityFind: 1, update: 1, create: 1 });

    const second = await applyAbilityChange(tx, change);
    expect(second.applied).toBe(false);
    expect(calls).toMatchObject({ abilityFind: 1, update: 1, create: 1, eventFind: 2 });
  });
});

describe("revealAbility", () => {
  it("hidden -> rumored 必须提供 rumorText", async () => {
    await expect(
      revealAbility(transaction().tx, {
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
      revealAbility(transaction().tx, {
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
      const { tx } = transaction(ability({ visibility, rumorText: "旧日传闻" }));

      const result = await revealAbility(tx, {
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
