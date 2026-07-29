import { describe, expect, it } from "vitest";
import {
  completeCreatorDeck,
  completeDeck,
} from "@/lib/abilities/embark.test-fixtures";
import type { WorldDeck } from "@/lib/cards/schemas";
import {
  assembleGenesisV2WorldDeck,
  getGenesisV2StageOutputSchema,
  sanitizeGenesisV2CharactersTemporalOutput,
  type GenesisV2StageOutputs,
} from "./stage-output";

function splitDeck(deck: WorldDeck): GenesisV2StageOutputs {
  const blueprint = {
    mode: deck.mode,
    worldName: deck.worldName,
    cosmology: deck.cosmology,
    fusionAxiom: deck.fusionAxiom,
    style: deck.style,
    theme: deck.theme,
    ...(deck.temporalAnchor ? { temporalAnchor: deck.temporalAnchor } : {}),
    canonBrief: "保持测试世界的核心设定与时间锚点一致。",
    slotBriefs: {},
  };
  const pantheonDomain = {
    mode: deck.mode,
    majorGods: deck.majorGods,
    minorGods: deck.minorGods,
    ...(deck.mode === "pantheon" ? { playerGod: deck.playerGod } : {}),
  };
  const civilizations = {
    mode: deck.mode,
    races: deck.races,
    factions: deck.factions,
    places: deck.places,
  };
  const eras = {
    mode: deck.mode,
    epochConflict: deck.epochConflict,
    ...(deck.openingChapterBrief ? { openingChapterBrief: deck.openingChapterBrief } : {}),
    ...(deck.canonEvents ? { canonEvents: deck.canonEvents } : {}),
  };
  const characters = {
    mode: deck.mode,
    majorCharacters: deck.majorCharacters,
    ...(deck.relationsAtAnchor ? { relationsAtAnchor: deck.relationsAtAnchor } : {}),
  };

  return {
    blueprint: getGenesisV2StageOutputSchema("blueprint", deck.mode).parse(blueprint),
    pantheon_domain: getGenesisV2StageOutputSchema("pantheon_domain", deck.mode).parse(pantheonDomain),
    civilizations: getGenesisV2StageOutputSchema("civilizations", deck.mode).parse(civilizations),
    eras: getGenesisV2StageOutputSchema("eras", deck.mode).parse(eras),
    characters: getGenesisV2StageOutputSchema("characters", deck.mode).parse(characters),
  } as GenesisV2StageOutputs;
}

describe("Genesis V2 stage output contracts", () => {
  it.each([
    ["pantheon", completeDeck()],
    ["creator", completeCreatorDeck()],
  ] as const)("deterministically assembles a strict %s WorldDeck", (_mode, deck) => {
    const outputs = splitDeck(deck);

    expect(assembleGenesisV2WorldDeck(outputs, deck.mode)).toEqual(deck);
  });

  it("rejects fields owned by another stage", () => {
    const deck = completeDeck();
    const output = splitDeck(deck).civilizations;

    expect(() => getGenesisV2StageOutputSchema("civilizations", "pantheon").parse({
      ...output,
      majorCharacters: deck.majorCharacters,
    })).toThrow();
  });

  it("rejects a creator pantheon artifact that smuggles in a player god", () => {
    const creator = completeCreatorDeck();

    expect(() => getGenesisV2StageOutputSchema("pantheon_domain", "creator").parse({
      ...splitDeck(creator).pantheon_domain,
      playerGod: completeDeck().playerGod,
    })).toThrow();
  });

  it("rejects assembly when an artifact mode differs from the task mode", () => {
    const outputs = splitDeck(completeDeck());

    expect(() => assembleGenesisV2WorldDeck(outputs, "creator")).toThrow(/模式不匹配/);
  });

  it("removes future abilities from active characters only while preserving the schema minimum", () => {
    const characters = splitDeck(completeDeck()).characters;
    const character = characters.majorCharacters[0]!;
    const extraFutureAbility = {
      ...character.abilities[0]!,
      ref: "character-future-ability",
      name: "未来能力",
      timing: "future" as const,
    };
    const output = {
      ...characters,
      majorCharacters: [
        {
          ...character,
          abilities: [
            ...character.abilities.slice(0, 2),
            extraFutureAbility,
          ],
          racialOverrides: character.racialOverrides.map((ability) => ({
            ...ability,
            timing: "future" as const,
          })),
        },
        ...characters.majorCharacters.slice(1),
      ],
    };

    const sanitized = sanitizeGenesisV2CharactersTemporalOutput(output);

    expect(sanitized.majorCharacters[0]!.abilities).toHaveLength(2);
    expect(sanitized.majorCharacters[0]!.abilities).not.toContainEqual(extraFutureAbility);
    expect(sanitized.majorCharacters[0]!.racialOverrides).toEqual([]);
  });

  it("keeps a future ability when removing it would violate the character ability minimum", () => {
    const characters = splitDeck(completeDeck()).characters;
    const character = characters.majorCharacters[0]!;
    const output = {
      ...characters,
      majorCharacters: [
        {
          ...character,
          abilities: character.abilities.slice(0, 2).map((ability, index) => ({
            ...ability,
            timing: index === 0 ? "future" as const : ability.timing,
          })),
        },
        ...characters.majorCharacters.slice(1),
      ],
    };

    const sanitized = sanitizeGenesisV2CharactersTemporalOutput(output);

    expect(sanitized.majorCharacters[0]!.abilities).toHaveLength(2);
    expect(sanitized.majorCharacters[0]!.abilities[0]!.timing).toBe("future");
  });
});
