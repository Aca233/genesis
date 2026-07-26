import { describe, expect, it } from "vitest";
import { completeCreatorDeck } from "@/lib/abilities/embark.test-fixtures";
import { DECK_CARD_KEYS } from "@/lib/cards/schemas";
import {
  CARD_KEY_LABELS,
  abilityRefsInDeck,
  availableRacialInnateAbilityRefs,
  canAddAbility,
  canEditAbilityVisibility,
  canRemoveAbility,
  changeCharacterRace,
  firstRacialInnateAbilityRef,
  nextAvailableAbilityRef,
  selectableRacialOverrideSourceRefs,
  traditionAbilityRefsForRace,
  visibleAbilityIndexes,
  deckCardOrder,
  addCreatorGodRelation,
  creatorRelationTargetRefs,
  removeCreatorGodRelation,
  removeCreatorMajorGod,
  updateCreatorGodRelation,
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

  it("为合法跨种族覆写保留当前来源选项，而不放宽新建来源范围", () => {
    expect(
      selectableRacialOverrideSourceRefs(
        deck,
        "race-human",
        [],
        { sourceAbilityRef: "dragon-breath", bloodlineJustification: "龙裔血脉" },
      ),
    ).toEqual(["human-inborn", "dragon-breath"]);

    expect(
      selectableRacialOverrideSourceRefs(
        deck,
        "race-human",
        [],
        { sourceAbilityRef: "dragon-breath", bloodlineJustification: null },
      ),
    ).toEqual(["human-inborn"]);
  });
});


describe("Creator 卡墙顺序", () => {
  it("从宇宙论与主神开始且不包含玩家神", () => {
    const deck = completeCreatorDeck();
    expect(deckCardOrder(deck).slice(0, 2)).toEqual(["cosmology", "majorGods"]);
    expect(deckCardOrder(deck)).not.toContain("playerGod");
  });
});

describe("卡片键中文标签", () => {
  it("CARD_KEY_LABELS 覆盖全部 DECK_CARD_KEYS（含时间锚点与锚点关系）", () => {
    expect(Object.keys(CARD_KEY_LABELS).sort()).toEqual([...DECK_CARD_KEYS].sort());
    expect(CARD_KEY_LABELS.temporalAnchor).toBe("时间锚点");
    expect(CARD_KEY_LABELS.relationsAtAnchor).toBe("锚点关系");
  });
});

describe("Creator 主神关系编辑工具", () => {
  it("关系目标排除自身与其他行已用目标，但保留当前行目标", () => {
    const deck = completeCreatorDeck();
    const currentTarget = deck.majorGods[0]!.relations[0]!.targetGodRef;
    deck.majorGods[0]!.relations.push({
      targetGodRef: deck.majorGods[2]!.ref,
      label: "ally",
      note: "第二条关系",
    });

    expect(creatorRelationTargetRefs(deck, 0, 0)).toEqual([
      currentTarget,
      deck.majorGods[3]!.ref,
    ]);

    deck.majorGods[0]!.relations[1]!.targetGodRef = currentTarget;
    expect(creatorRelationTargetRefs(deck, 0, 0)).toContain(currentTarget);
  });

  it("添加关系时选择第一个尚未使用的世界内主神", () => {
    const deck = completeCreatorDeck();
    const added = addCreatorGodRelation(deck, 0);

    expect(added).not.toBe(deck);
    expect(added.majorGods[0]!.relations).toHaveLength(2);
    expect(added.majorGods[0]!.relations[1]).toEqual({
      targetGodRef: deck.majorGods[2]!.ref,
      label: "unknown",
      note: "",
    });
  });

  it("修改与删除关系均返回新卡组且不改动原值", () => {
    const deck = completeCreatorDeck();
    const changed = updateCreatorGodRelation(deck, 0, 0, {
      label: "ally",
      note: "结盟",
    });
    const removed = removeCreatorGodRelation(changed, 0, 0);

    expect(changed.majorGods[0]!.relations[0]).toMatchObject({ label: "ally", note: "结盟" });
    expect(deck.majorGods[0]!.relations[0]!.label).toBe("rival");
    expect(removed.majorGods[0]!.relations).toEqual([]);
  });

  it("删除主神同步清理所有指向它的入向关系，不留下悬挂引用", () => {
    const deck = completeCreatorDeck();
    const removedRef = deck.majorGods[1]!.ref;
    expect(deck.majorGods.some((god) =>
      god.relations.some((relation) => relation.targetGodRef === removedRef),
    )).toBe(true);

    const next = removeCreatorMajorGod(deck, 1);
    const remainingRefs = new Set(next.majorGods.map((god) => god.ref));

    expect(next.majorGods).toHaveLength(deck.majorGods.length - 1);
    expect(next.majorGods.some((god) => god.ref === removedRef)).toBe(false);
    expect(next.majorGods.flatMap((god) => god.relations).every((relation) =>
      remainingRefs.has(relation.targetGodRef),
    )).toBe(true);
  });
});
