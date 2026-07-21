import { describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
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
});
