import { describe, expect, it } from "vitest";
import { resolveEffectiveAbilities } from "./resolver";

describe("resolveEffectiveAbilities", () => {
  it("默认继承种族先天能力，但不自动继承族群技艺", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        {
          id: "night-sight",
          kind: "racial_innate",
          name: "夜视",
          state: "normal",
          mastery: "adept",
        },
        {
          id: "shadow-step",
          kind: "racial_tradition",
          name: "影行",
          state: "normal",
          mastery: "adept",
        },
      ],
      characterAbilities: [],
    });

    expect(result.map((ability) => ability.name)).toEqual(["夜视"]);
  });

  it("人物覆写会替代种族先天模板，习得的族群技艺才会生效", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        {
          id: "night-sight",
          kind: "racial_innate",
          name: "夜视",
          state: "normal",
          mastery: "adept",
        },
        {
          id: "shadow-step",
          kind: "racial_tradition",
          name: "影行",
          state: "normal",
          mastery: "adept",
        },
      ],
      characterAbilities: [
        {
          id: "lost-night-sight",
          sourceAbilityId: "night-sight",
          kind: "racial_innate",
          name: "夜视",
          state: "lost",
          mastery: "adept",
        },
        {
          id: "learned-shadow-step",
          sourceAbilityId: "shadow-step",
          kind: "racial_tradition",
          name: "影行",
          state: "normal",
          mastery: "novice",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "learned-shadow-step",
      sourceAbilityId: "shadow-step",
      inherited: false,
    });
  });

  it("过滤未觉醒或不可用能力，但保留受损能力", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        {
          id: "unawakened-innate",
          kind: "racial_innate",
          name: "未觉醒天赋",
          state: "normal",
          mastery: "unawakened",
        },
        {
          id: "impaired-innate",
          kind: "racial_innate",
          name: "受损天赋",
          state: "impaired",
          mastery: "adept",
        },
      ],
      characterAbilities: [
        {
          id: "sealed-personal",
          kind: "personal",
          name: "封印技艺",
          state: "sealed",
          mastery: "expert",
        },
        {
          id: "lost-personal",
          kind: "personal",
          name: "失落技艺",
          state: "lost",
          mastery: "expert",
        },
        {
          id: "deprecated-personal",
          kind: "personal",
          name: "废弃技艺",
          state: "deprecated",
          mastery: "expert",
        },
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
