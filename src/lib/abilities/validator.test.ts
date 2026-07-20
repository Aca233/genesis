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
});

describe("validateDeckReferences", () => {
  it("拒绝带有首尾空白的引用 ID", () => {
    expect(() => validateDeckReferences({ abilityIds: [" ability-1"] })).toThrow(
      /空白/,
    );
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
