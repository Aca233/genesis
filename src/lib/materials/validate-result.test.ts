import { describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { extractDeckMaterials } from "./extract-deck";
import { validateMaterializedDeck } from "./validate-result";
import type { GenesisMaterialSnapshot, GenesisMaterialSnapshotItem } from "./types";

function itemFor(kind: string, mode: "remix" | "inherit" | "locked" = "locked") {
  const material = extractDeckMaterials(completeDeck()).find((candidate) => candidate.kind === kind)!;
  return {
    selection: {
      materialCardId: `card-${kind}`, materialVersionId: `version-${kind}`, mode,
      fullLock: mode === "locked", dependencyDecisions: {}, abilityOwner: null,
      priority: 0, compressed: false,
    },
    card: {
      id: `card-${kind}`, kind: material.kind, name: material.name, summary: material.summary,
      sourceWorldName: "旧世界", sourceKind: material.sourceKind, sourceRef: material.sourceRef,
    },
    version: {
      id: `version-${kind}`, version: 1, name: "初始版", content: material.content,
      dependencies: material.dependencies, schemaVersion: 1,
    },
  } satisfies GenesisMaterialSnapshotItem;
}
function snapshot(...items: GenesisMaterialSnapshotItem[]): GenesisMaterialSnapshot {
  return { schemaVersion: 1, estimatedChars: 1, items };
}

describe("validateMaterializedDeck", () => {
  it("reports the exact changed path for a fully locked card", () => {
    const deck = completeDeck();
    const selected = itemFor("major_god");
    deck.majorGods[0]!.persona += "改变";
    expect(validateMaterializedDeck(deck, snapshot(selected))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "locked_mismatch", path: "card.persona", materialVersionId: selected.version.id }),
    ]));
  });

  it("locks identity and core mechanics for inherit but permits adaptive relations", () => {
    const deck = completeDeck();
    const selected = itemFor("character", "inherit");
    deck.majorCharacters[0]!.factionMemberships = [];
    expect(validateMaterializedDeck(deck, snapshot(selected))).toEqual([]);
    deck.majorCharacters[0]!.identity += "被篡改";
    expect(validateMaterializedDeck(deck, snapshot(selected))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "inherit_mismatch", path: "card.identity" }),
    ]));
  });

  it("does not require remix equality but requires a fusion axiom for conflicting cosmologies", () => {
    const deck = completeDeck();
    const first = itemFor("cosmology", "remix");
    const second = structuredClone(first);
    second.card.id = "cosmology-2";
    second.selection.materialCardId = "cosmology-2";
    second.selection.materialVersionId = "cosmology-version-2";
    second.version.id = "cosmology-version-2";
    (second.version.content as { card: { laws: string } }).card.laws = "另一套法则";
    deck.cosmology.laws = "自由改编";
    expect(validateMaterializedDeck(deck, snapshot(first))).toEqual([]);
    expect(validateMaterializedDeck(deck, snapshot(first, second))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "fusion_axiom_required", path: "fusionAxiom" }),
    ]));
  });

  it("validates independent ability owner, hidden visibility and rebuilt refs", () => {
    const deck = completeDeck();
    const ability = itemFor("ability", "inherit");
    const source = ability.version.content as { card: { ref: string; kind: string; visibility: string }; owner: unknown };
    source.card.visibility = "hidden";
    const resultAbility = deck.playerGod.abilities.find((candidate) => candidate.ref === source.card.ref)!;
    resultAbility.visibility = "known";
    (ability.selection as GenesisMaterialSnapshotItem["selection"]).abilityOwner = { mode: "selected", materialVersionId: "character-owner" };

    const character = itemFor("character", "remix");
    character.version.id = "character-owner";
    character.selection.materialVersionId = "character-owner";
    const characterContent = character.version.content as { card: { raceRef: string } };
    const raceDependency = character.version.dependencies.find((dependency) => dependency.relation === "race")!;
    (character.selection as GenesisMaterialSnapshotItem["selection"]).dependencyDecisions[raceDependency.key] = "rebuild";

    const issues = validateMaterializedDeck(deck, snapshot(ability, character));
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ability_owner_kind", materialVersionId: ability.version.id }),
      expect.objectContaining({ code: "hidden_visibility", path: "card.visibility" }),
      expect.objectContaining({ code: "dependency_not_rebuilt", path: "card.raceRef" }),
    ]));
    expect(characterContent.card.raceRef).toBe(deck.majorCharacters[0]!.raceRef);
  });
});
