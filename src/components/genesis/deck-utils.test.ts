import { describe, expect, it } from "vitest";
import {
  changeCharacterRace,
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
});
