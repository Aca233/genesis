import { describe, expect, it } from "vitest";
import {
  projectAbilitiesForPlayer,
  projectAbilityForPlayer,
} from "./visibility";

const ability = {
  id: "night-sight",
  name: "夜视",
  kind: "racial_innate" as const,
  effect: "在黑暗中辨识轮廓",
  trigger: "进入低光环境",
  cost: "轻微精神负担",
  limitations: "浓雾中效果减弱",
  mastery: "adept" as const,
  state: "impaired" as const,
  visibility: "known" as const,
  rumorText: null,
  sourceAbilityId: null,
  lockedFields: ["effect"],
  version: 3,
};

describe("projectAbilityForPlayer", () => {
  it("known 能力完整公开", () => {
    expect(projectAbilityForPlayer(ability)).toEqual(ability);
  });

  it("rumored 能力只返回允许的传闻字段", () => {
    const rumored = {
      ...ability,
      visibility: "rumored" as const,
      rumorText: "据说她能看穿永夜。",
    };

    expect(projectAbilityForPlayer(rumored)).toEqual({
      id: "night-sight",
      name: "夜视",
      kind: "racial_innate",
      visibility: "rumored",
      rumorText: "据说她能看穿永夜。",
      state: "impaired",
    });
  });

  it("hidden 能力不会投影给玩家", () => {
    expect(
      projectAbilityForPlayer({ ...ability, visibility: "hidden" }),
    ).toBeNull();
  });
});

describe("projectAbilitiesForPlayer", () => {
  it("过滤隐藏能力并投影其余能力", () => {
    const result = projectAbilitiesForPlayer([
      ability,
      {
        ...ability,
        id: "hidden-skill",
        visibility: "hidden" as const,
      },
    ]);

    expect(result).toEqual([ability]);
  });
});
