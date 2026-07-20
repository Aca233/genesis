import { describe, expect, it } from "vitest";
import type { AbilityOwnershipInput, AbilityValidationTx } from "./validator";
import {
  AbilityValidationError,
  assertUnlockedFields,
  assertValidTransition,
  validateAbilityOwnership,
  validateDeckReferences,
} from "./validator";

const baseInput: AbilityOwnershipInput = {
  id: "character-shadow-step",
  timelineId: "timeline-1",
  entityId: "character-1",
  godId: null,
  sourceAbilityId: "elf-shadow-step",
  kind: "racial_tradition",
};

function transaction({
  entity = { id: "character-1", timelineId: "timeline-1", type: "character", raceId: "race-1" },
  god = null,
  source = { id: "elf-shadow-step", timelineId: "timeline-1", entityId: "race-1", godId: null, kind: "racial_tradition", sourceAbilityId: null },
}: {
  entity?: { id: string; timelineId: string; type: string; raceId: string | null } | null;
  god?: { id: string; timelineId: string } | null;
  source?: {
    id: string;
    timelineId: string;
    entityId: string | null;
    godId: string | null;
    kind: string;
    sourceAbilityId: string | null;
  } | null;
} = {}): AbilityValidationTx {
  return {
    entity: { findUnique: async () => entity },
    god: { findUnique: async () => god },
    ability: { findUnique: async () => source },
  };
}

describe("validateAbilityOwnership", () => {
  it("拒绝来源不属于人物主种族的族群技艺", async () => {
    await expect(
      validateAbilityOwnership(
        transaction({
          source: {
            id: "dwarf-forge-song",
            timelineId: "timeline-1",
            entityId: "race-2",
            godId: null,
            kind: "racial_tradition",
            sourceAbilityId: null,
          },
        }),
        baseInput,
      ),
    ).rejects.toThrow("族群技艺来源必须属于人物主种族");
  });

  it("拒绝改写被锁定的 effect", () => {
    expect(() =>
      assertUnlockedFields(
        { ...ability(), lockedFields: ["effect"] },
        { id: "ability-1", version: 1, effect: "改写后的效果" },
      ),
    ).toThrow(AbilityValidationError);
  });

  it("拒绝 personal 能力携带 sourceAbilityId", async () => {
    await expect(
      validateAbilityOwnership(
        transaction(),
        { ...baseInput, kind: "personal", sourceAbilityId: "elf-shadow-step" },
      ),
    ).rejects.toThrow(/personal.*sourceAbilityId/);
  });

  it("拒绝引用并非种族模板的派生来源", async () => {
    const tx: AbilityValidationTx = {
      entity: {
        findUnique: async ({ where }) =>
          where.id === "character-1"
            ? { id: "character-1", timelineId: "timeline-1", type: "character", raceId: "race-1" }
            : { id: "race-1", timelineId: "timeline-1", type: "character", raceId: null },
      },
      god: { findUnique: async () => null },
      ability: {
        findUnique: async () => ({
          id: "spoofed-source",
          timelineId: "timeline-1",
          entityId: "race-1",
          godId: null,
          kind: "racial_tradition",
          sourceAbilityId: null,
        }),
      },
    };

    await expect(validateAbilityOwnership(tx, baseInput)).rejects.toThrow(
      /来源必须是种族模板能力/,
    );
  });
});

describe("assertValidTransition", () => {
  it("拒绝直接将 lost 能力恢复为 normal", () => {
    expect(() =>
      assertValidTransition(
        { ...ability(), state: "lost" },
        { ...ability(), state: "normal" },
      ),
    ).toThrow(/restored/);
  });

  it("deprecated 状态即使带 restored 事件也不可恢复", () => {
    expect(() =>
      assertValidTransition(
        { ...ability(), state: "deprecated" },
        { ...ability(), state: "normal" },
        "restored",
      ),
    ).toThrow(/deprecated/);
  });
});

describe("validateDeckReferences nested WorldDeck reference graph", () => {
  const deck = {
    races: [
      {
        ref: "race-1",
        abilities: [
          { ref: "race-1-innate", kind: "racial_innate" },
          { ref: "race-1-tradition", kind: "racial_tradition" },
        ],
      },
      {
        ref: "race-2",
        abilities: [{ ref: "race-2-tradition", kind: "racial_tradition" }],
      },
    ],
    factions: [{ ref: "faction-1", keyCharacterRefs: [{ ref: "character-1" }] }],
    majorCharacters: [
      {
        ref: "character-1",
        raceRef: "race-1",
        factionMemberships: [{ factionRef: "faction-1" }],
        learnedTraditionRefs: [{ sourceAbilityRef: "race-1-tradition" }],
        racialOverrides: [{ sourceAbilityRef: "race-1-innate" }],
      },
    ],
  };

  it("接受最终嵌套的 WorldDeck 引用图谱", () => {
    expect(() => validateDeckReferences(deck)).not.toThrow();
  });

  it("拒绝同类重复 ref", () => {
    expect(() =>
      validateDeckReferences({
        ...deck,
        races: [...deck.races, { ref: "race-1", abilities: [] }],
      }),
    ).toThrow(/重复.*race-1/);
  });

  it.each([
    ["种族", { ...deck, majorCharacters: [{ ...deck.majorCharacters[0], raceRef: "missing-race" }] }],
    ["势力", { ...deck, majorCharacters: [{ ...deck.majorCharacters[0], factionMemberships: [{ factionRef: "missing-faction" }] }] }],
    ["人物", { ...deck, factions: [{ ref: "faction-1", keyCharacterRefs: [{ ref: "missing-character" }] }] }],
    ["能力", { ...deck, majorCharacters: [{ ...deck.majorCharacters[0], learnedTraditionRefs: [{ sourceAbilityRef: "missing-ability" }] }] }],
  ])("拒绝不存在的%s引用", (_label, invalidDeck) => {
    expect(() => validateDeckReferences(invalidDeck)).toThrow(/不存在/);
  });

  it("拒绝跨种族族群技艺来源和错误的覆写类型", () => {
    expect(() =>
      validateDeckReferences({
        ...deck,
        majorCharacters: [{ ...deck.majorCharacters[0], learnedTraditionRefs: [{ sourceAbilityRef: "race-2-tradition" }] }],
      }),
    ).toThrow(/主种族/);
    expect(() =>
      validateDeckReferences({
        ...deck,
        majorCharacters: [{ ...deck.majorCharacters[0], racialOverrides: [{ sourceAbilityRef: "race-1-tradition" }] }],
      }),
    ).toThrow(/racial_innate/);
  });

  it("跨种族 racial_innate 覆写必须持久化血脉理由", () => {
    const crossRaceDeck = {
      ...deck,
      races: [
        ...deck.races,
        { ref: "race-3", abilities: [{ ref: "race-3-innate", kind: "racial_innate" }] },
      ],
      majorCharacters: [{
        ...deck.majorCharacters[0],
        racialOverrides: [{ sourceAbilityRef: "race-3-innate" }],
      }],
    };
    expect(() => validateDeckReferences(crossRaceDeck)).toThrow(/bloodlineJustification/);
    expect(() =>
      validateDeckReferences({
        ...crossRaceDeck,
        majorCharacters: [{
          ...crossRaceDeck.majorCharacters[0],
          racialOverrides: [{
            sourceAbilityRef: "race-3-innate",
            bloodlineJustification: "已记录的星裔血脉",
          }],
        }],
      }),
    ).not.toThrow();
  });
});

function ability() {
  return {
    id: "ability-1",
    name: "夜视",
    kind: "personal" as const,
    effect: "看见黑暗",
    trigger: "夜晚",
    cost: "无",
    limitations: "无",
    mastery: "adept" as const,
    state: "normal" as const,
    visibility: "known" as const,
    rumorText: null,
    sourceAbilityId: null,
    lockedFields: [],
    version: 1,
  };
}

describe("能力所有者类型", () => {
  it("拒绝 faction 等非人物实体拥有 personal 能力", async () => {
    await expect(
      validateAbilityOwnership(
        transaction({
          entity: { id: "faction-1", timelineId: "timeline-1", type: "faction", raceId: null },
        }),
        {
          ...baseInput,
          entityId: "faction-1",
          kind: "personal",
          sourceAbilityId: null,
        },
      ),
    ).rejects.toThrow(/character.*personal/);
  });

  it("仅允许带有明确血脉理由的跨主种族先天能力", async () => {
    const tx: AbilityValidationTx = {
      entity: {
        findUnique: async ({ where }) => {
          if (where.id === "character-1") {
            return { id: "character-1", timelineId: "timeline-1", type: "character", raceId: "race-1" };
          }
          return { id: "race-2", timelineId: "timeline-1", type: "race", raceId: null };
        },
      },
      god: { findUnique: async () => null },
      ability: {
        findUnique: async () => ({
          id: "celestial-spark",
          timelineId: "timeline-1",
          entityId: "race-2",
          godId: null,
          kind: "racial_innate",
          sourceAbilityId: null,
        }),
      },
    };

    await expect(
      validateAbilityOwnership(
        tx,
        {
          ...baseInput,
          kind: "racial_innate",
          sourceAbilityId: "celestial-spark",
          bloodlineJustification: "母系星裔血脉已由第 3 章见证",
        } as AbilityOwnershipInput,
      ),
    ).resolves.toBeUndefined();
  });

  it("跨主种族族群技艺即使附带血脉理由也必须拒绝", async () => {
    await expect(
      validateAbilityOwnership(
        transaction({
          source: {
            id: "dwarf-forge-song",
            timelineId: "timeline-1",
            entityId: "race-2",
            godId: null,
            kind: "racial_tradition",
            sourceAbilityId: null,
          },
        }),
        {
          ...baseInput,
          bloodlineJustification: "无关；族群技艺不得越族",
        } as AbilityOwnershipInput,
      ),
    ).rejects.toThrow("族群技艺来源必须属于人物主种族");
  });
});
