import { describe, expect, it } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import {
  ObserverStateSchema,
  RealityStateSchema,
  initialBranchSummary,
  initialObserverState,
  initialRealityState,
} from "./schemas";

describe("initial reality and observer state", () => {
  it.each([completeDeck, completeCreatorDeck])(
    "freezes the genesis cards and current era as JSON-safe root state",
    (makeDeck) => {
      const deck = makeDeck();
      const reality = initialRealityState(deck);
      const observer = initialObserverState(deck);

      expect(RealityStateSchema.parse(reality)).toEqual({
        theme: deck.theme,
        style: deck.style,
        cosmology: deck.cosmology,
        fusionAxiom: deck.fusionAxiom,
        currentEra: deck.epochConflict.yearLabel,
        establishedFacts: [],
      });
      expect(ObserverStateSchema.parse(observer)).toEqual({
        focusType: "world",
        focusId: null,
        timeLabel: deck.epochConflict.yearLabel,
        viewpoint: "omniscient",
        activeAvatarId: null,
      });
      expect(JSON.parse(JSON.stringify({ reality, observer }))).toEqual({ reality, observer });
    },
  );

  it("builds a deterministic root branch summary from every public epoch conflict", () => {
    const deck = completeCreatorDeck();
    deck.epochConflict.overtConflicts = ["诸神争夺信仰", "星门正在崩塌"];
    expect(initialBranchSummary(deck)).toBe(
      "裂光纪 · 裂光元年：诸神争夺信仰；星门正在崩塌",
    );
  });

  it("validates established facts and non-root observer variants", () => {
    expect(RealityStateSchema.safeParse({
      ...initialRealityState(completeCreatorDeck()),
      establishedFacts: [{ ref: "fact-1", text: "星海已经点燃", establishedByRewriteId: null }],
    }).success).toBe(true);
    expect(RealityStateSchema.safeParse({
      ...initialRealityState(completeCreatorDeck()),
      establishedFacts: [{ ref: "fact-1", text: "", establishedByRewriteId: null }],
    }).success).toBe(false);
    expect(ObserverStateSchema.safeParse({
      focusType: "avatar",
      focusId: "entity-1",
      timeLabel: "裂光元年",
      viewpoint: "limited",
      activeAvatarId: "entity-1",
    }).success).toBe(true);
    expect(ObserverStateSchema.safeParse({
      focusType: "timeline",
      focusId: null,
      timeLabel: "裂光元年",
      viewpoint: "omniscient",
      activeAvatarId: null,
    }).success).toBe(false);
  });
});
