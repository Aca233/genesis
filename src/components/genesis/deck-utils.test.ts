import { describe, expect, it } from "vitest";
import {
  canAddAbility,
  canEditAbilityVisibility,
  canRemoveAbility,
  changeCharacterRace,
  firstRacialInnateAbilityRef,
  traditionAbilityRefsForRace,
} from "./deck-utils";

describe("创世人物引用工具", () => {
  const deck = {
    races: [
      {
        ref: "race-human",
        abilities: [
          { ref: "human-inborn", kind: "racial_innate" },
          { ref: "human-ritual", kind: "racial_tradition" },
        ],
      },
      {
        ref: "race-dragon",
        abilities: [
          { ref: "dragon-breath", kind: "racial_innate" },
          { ref: "dragon-song", kind: "racial_tradition" },
        ],
      },
    ],
  };

  it("只列出当前种族的族群技艺引用", () => {
    expect(traditionAbilityRefsForRace(deck, "race-human")).toEqual([
      "human-ritual",
    ]);
    expect(traditionAbilityRefsForRace(deck, "unknown-race")).toEqual([]);
  });

  it("切换人物种族时移除不属于新种族的技艺引用", () => {
    const character = {
      raceRef: "race-human",
      learnedTraditionRefs: [
        { sourceAbilityRef: "human-ritual" },
        { sourceAbilityRef: "dragon-song" },
      ],
    };

    expect(changeCharacterRace(character, "race-dragon", deck)).toEqual({
      character: {
        raceRef: "race-dragon",
        learnedTraditionRefs: [{ sourceAbilityRef: "dragon-song" }],
      },
      removedTraditionRefs: ["human-ritual"],
    });
  });

  it("封印中的隐藏能力不可编辑可见性，破封后才可编辑", () => {
    expect(canEditAbilityVisibility("hidden", false)).toBe(false);
    expect(canEditAbilityVisibility("hidden", true)).toBe(true);
    expect(canEditAbilityVisibility("known", false)).toBe(true);
  });

  it("在能力数量达到严格上下限时禁止删除或新增", () => {
    expect(canRemoveAbility(2, 2)).toBe(false);
    expect(canRemoveAbility(3, 2)).toBe(true);
    expect(canAddAbility(5, 5)).toBe(false);
    expect(canAddAbility(4, 5)).toBe(true);
    expect(canAddAbility(0, 5, false)).toBe(false);
  });

  it("仅在存在种族先天模板时提供先天覆写来源", () => {
    expect(firstRacialInnateAbilityRef(deck)).toBe("human-inborn");
    expect(firstRacialInnateAbilityRef({ races: [{ ref: "race-empty", abilities: [] }] })).toBeUndefined();
  });
});
