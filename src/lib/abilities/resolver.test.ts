import { describe, expect, it } from "vitest";
import { normalizePersistedAbility } from "./types";
import { resolveEffectiveAbilities } from "./resolver";

function ability({
  id,
  name,
  kind,
  mastery = "adept",
  state = "normal",
  sourceAbilityId = null,
}: {
  id: string;
  name: string;
  kind: string;
  mastery?: string;
  state?: string;
  sourceAbilityId?: string | null;
}) {
  return normalizePersistedAbility({
    id,
    name,
    kind,
    effect: "",
    trigger: "",
    cost: "",
    limitations: "",
    mastery,
    state,
    visibility: "known",
    rumorText: null,
    sourceAbilityId,
    lockedFields: [],
    version: 1,
  });
}

describe("resolveEffectiveAbilities", () => {
  it("默认继承种族先天能力，但不自动继承族群技艺", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        ability({ id: "night-sight", kind: "racial_innate", name: "夜视" }),
        ability({ id: "shadow-step", kind: "racial_tradition", name: "影行" }),
      ],
      characterAbilities: [],
    });

    expect(result.map((resolved) => resolved.name)).toEqual(["夜视"]);
  });

  it("人物覆写会替代种族先天模板，习得的族群技艺才会生效", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        ability({ id: "night-sight", kind: "racial_innate", name: "夜视" }),
        ability({ id: "shadow-step", kind: "racial_tradition", name: "影行" }),
      ],
      characterAbilities: [
        ability({
          id: "lost-night-sight",
          sourceAbilityId: "night-sight",
          kind: "racial_innate",
          name: "夜视",
          state: "lost",
        }),
        ability({
          id: "learned-shadow-step",
          sourceAbilityId: "shadow-step",
          kind: "racial_tradition",
          name: "影行",
          mastery: "novice",
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "learned-shadow-step",
      sourceAbilityId: "shadow-step",
      inherited: false,
    });
  });

  it("保留不覆写主种族模板的特殊血脉先天能力", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        ability({ id: "night-sight", kind: "racial_innate", name: "夜视" }),
      ],
      characterAbilities: [
        ability({
          id: "celestial-bloodline",
          sourceAbilityId: "celestial-spark",
          kind: "racial_innate",
          name: "星火血脉",
          mastery: "novice",
        }),
      ],
    });

    expect(result.map((resolved) => resolved.id)).toEqual([
      "night-sight",
      "celestial-bloodline",
    ]);
    expect(result[1]).toMatchObject({
      inherited: false,
      sourceAbilityId: "celestial-spark",
    });
  });

  it("拒绝同一主种族先天能力的重复人物覆写", () => {
    expect(() =>
      resolveEffectiveAbilities({
        raceAbilities: [
          ability({ id: "night-sight", kind: "racial_innate", name: "夜视" }),
        ],
        characterAbilities: [
          ability({
            id: "lost-night-sight",
            sourceAbilityId: "night-sight",
            kind: "racial_innate",
            name: "失去夜视",
            state: "lost",
          }),
          ability({
            id: "sealed-night-sight",
            sourceAbilityId: "night-sight",
            kind: "racial_innate",
            name: "封印夜视",
            state: "sealed",
          }),
        ],
      }),
    ).toThrow(/重复.*night-sight/);
  });

  it("拒绝两条族群技艺引用同一能力来源", () => {
    expect(() =>
      resolveEffectiveAbilities({
        characterAbilities: [
          ability({
            id: "shadow-step-novice",
            sourceAbilityId: "shadow-step",
            kind: "racial_tradition",
            name: "影行",
            mastery: "novice",
          }),
          ability({
            id: "shadow-step-adept",
            sourceAbilityId: "shadow-step",
            kind: "racial_tradition",
            name: "影行",
          }),
        ],
      }),
    ).toThrow(/重复能力来源.*shadow-step/);
  });

  it("拒绝两条特殊血脉能力引用同一非主种族来源", () => {
    expect(() =>
      resolveEffectiveAbilities({
        raceAbilities: [
          ability({ id: "night-sight", kind: "racial_innate", name: "夜视" }),
        ],
        characterAbilities: [
          ability({
            id: "celestial-bloodline-a",
            sourceAbilityId: "celestial-spark",
            kind: "racial_innate",
            name: "星火血脉",
          }),
          ability({
            id: "celestial-bloodline-b",
            sourceAbilityId: "celestial-spark",
            kind: "racial_innate",
            name: "星火余烬",
          }),
        ],
      }),
    ).toThrow(/重复能力来源.*celestial-spark/);
  });

  it("过滤未觉醒或不可用能力，但保留受损能力", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        ability({
          id: "unawakened-innate",
          kind: "racial_innate",
          name: "未觉醒天赋",
          mastery: "unawakened",
        }),
        ability({
          id: "impaired-innate",
          kind: "racial_innate",
          name: "受损天赋",
          state: "impaired",
        }),
      ],
      characterAbilities: [
        ability({
          id: "sealed-personal",
          kind: "personal",
          name: "封印技艺",
          state: "sealed",
          mastery: "expert",
        }),
        ability({
          id: "lost-personal",
          kind: "personal",
          name: "失落技艺",
          state: "lost",
          mastery: "expert",
        }),
        ability({
          id: "deprecated-personal",
          kind: "personal",
          name: "废弃技艺",
          state: "deprecated",
          mastery: "expert",
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "impaired-innate",
      state: "impaired",
      inherited: true,
    });
  });
});
