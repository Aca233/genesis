import { describe, expect, it } from "vitest";
import {
  abilityRefsInDeck,
  availableRacialInnateAbilityRefs,
  canAddAbility,
  canEditAbilityVisibility,
  canRemoveAbility,
  changeCharacterRace,
  firstRacialInnateAbilityRef,
  nextAvailableAbilityRef,
  traditionAbilityRefsForRace,
  visibleAbilityIndexes,
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
      removedOverrideRefs: [],
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
    expect(firstRacialInnateAbilityRef(deck, "race-human")).toBe("human-inborn");
    expect(firstRacialInnateAbilityRef({ races: [{ ref: "race-empty", abilities: [] }] }, "race-empty")).toBeUndefined();
  });

  it("不以其他种族的先天模板作为新覆写来源", () => {
    const deckWithOtherRaceOnly = {
      races: [
        { ref: "race-current", abilities: [] },
        { ref: "race-other", abilities: [{ ref: "other-inborn", kind: "racial_innate" }] },
      ],
    };

    expect(firstRacialInnateAbilityRef(deckWithOtherRaceOnly, "race-current")).toBeUndefined();
    expect(firstRacialInnateAbilityRef(deckWithOtherRaceOnly, "race-other")).toBe("other-inborn");
  });

  it("切换种族时移除无血脉依据的旧种族先天覆写", () => {
    const character = {
      raceRef: "race-human",
      learnedTraditionRefs: [],
      racialOverrides: [
        { ref: "override-human", sourceAbilityRef: "human-inborn", bloodlineJustification: null },
        { ref: "override-dragon", sourceAbilityRef: "dragon-breath", bloodlineJustification: "龙裔血脉" },
        { ref: "override-current", sourceAbilityRef: "dragon-breath", bloodlineJustification: null },
      ],
    };

    expect(changeCharacterRace(character, "race-dragon", deck)).toMatchObject({
      character: {
        raceRef: "race-dragon",
        racialOverrides: [
          { ref: "override-dragon", sourceAbilityRef: "dragon-breath" },
          { ref: "override-current", sourceAbilityRef: "dragon-breath" },
        ],
      },
      removedOverrideRefs: ["override-human"],
    });
  });

  it("覆写来源只提供当前种族尚未使用的先天模板", () => {
    expect(availableRacialInnateAbilityRefs(deck, "race-human", ["human-inborn"])).toEqual([]);
    expect(availableRacialInnateAbilityRefs(deck, "race-dragon", [])).toEqual(["dragon-breath"]);
  });

  it("主神天机未破封时完全过滤隐藏神权", () => {
    const abilities = [
      { kind: "divine", visibility: "known" },
      { kind: "divine", visibility: "hidden" },
      { kind: "personal", visibility: "hidden" },
    ];

    expect(visibleAbilityIndexes(abilities, ["divine"], true, false)).toEqual([0]);
    expect(visibleAbilityIndexes(abilities, ["divine"], true, true)).toEqual([0, 1]);
  });

  it("新增能力 ref 避开全卡组已用的能力与覆写 ref", () => {
    const usedRefs = abilityRefsInDeck({
      playerGod: { abilities: [{ ref: "player-ability" }] },
      majorGods: [{ abilities: [{ ref: "major-ability" }] }],
      races: [{ abilities: [{ ref: "races-0-abilities-ability-1" }] }],
      majorCharacters: [{ abilities: [{ ref: "character-ability" }], racialOverrides: [{ ref: "races-0-abilities-ability-2" }] }],
    });

    expect(nextAvailableAbilityRef("races.0.abilities", usedRefs)).toBe("races-0-abilities-ability-3");
  });
});
