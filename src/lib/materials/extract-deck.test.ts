import { describe, expect, it } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { extractDeckMaterials } from "./extract-deck";

describe("extractDeckMaterials", () => {
  it("splits every card and ability and preserves dependencies", () => {
    const deck = completeDeck();
    const materials = extractDeckMaterials(deck);
    const abilityCount = deck.playerGod.abilities.length
      + deck.majorGods.flatMap((god) => god.abilities).length
      + deck.races.flatMap((race) => race.abilities).length
      + deck.majorCharacters.flatMap((character) => [...character.abilities, ...character.racialOverrides]).length;
    expect(materials.filter((item) => item.kind === "major_god")).toHaveLength(deck.majorGods.length);
    expect(materials.filter((item) => item.kind === "ability")).toHaveLength(abilityCount);
    expect(materials.find((item) => item.sourceRef === deck.majorCharacters[0]!.ref)?.dependencies)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ relation: "race", targetRef: deck.majorCharacters[0]!.raceRef }),
        expect.objectContaining({ relation: "faction", targetRef: deck.majorCharacters[0]!.factionMemberships[0]!.factionRef }),
      ]));
    expect(materials.some((item) => item.kind === "fusion_axiom")).toBe(false);
  });

  it("Creator 不提取玩家神但提取全部主神及其能力", () => {
    const deck = completeCreatorDeck();
    const materials = extractDeckMaterials(deck);
    expect(materials.some((item) => item.kind === "player_god")).toBe(false);
    expect(materials.filter((item) => item.kind === "major_god")).toHaveLength(deck.majorGods.length);
    for (const god of deck.majorGods) {
      expect(materials.some((item) => item.kind === "major_god" && item.sourceRef === god.ref)).toBe(true);
      for (const ability of god.abilities) {
        expect(materials.some((item) => item.kind === "ability" && item.sourceRef === ability.ref)).toBe(true);
      }
    }
  });
});
