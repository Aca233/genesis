import type { DeckAbilitySchema, WorldDeck } from "@/lib/cards/schemas";
import type { z } from "zod";
import type { MaterialVersionContent } from "./schemas";
import type { MaterialDependency, MaterialKind } from "./types";

export type ExtractedMaterial = {
  kind: MaterialKind;
  sourceKind: string;
  sourceRef: string;
  name: string;
  summary: string;
  content: MaterialVersionContent;
  dependencies: MaterialDependency[];
};

const dependency = (
  relation: MaterialDependency["relation"], targetKind: MaterialKind,
  targetRef: string, label: string, required = true,
): MaterialDependency => ({ key: `${relation}:${targetRef}`, relation, targetKind, targetRef, label, required });

export function extractDeckMaterials(deck: WorldDeck): ExtractedMaterial[] {
  const result: ExtractedMaterial[] = [];
  const add = (item: ExtractedMaterial) => result.push(item);
  const addAbility = (
    card: z.infer<typeof DeckAbilitySchema>,
    owner: { kind: "god" | "character" | "race"; sourceRef: string; name: string },
    extra: MaterialDependency[] = [],
  ) => add({
    kind: "ability", sourceKind: "ability", sourceRef: card.ref, name: card.name,
    summary: card.effect.slice(0, 160),
    content: { schemaVersion: 1, origin: "deck", kind: "ability", card, owner: { kind: owner.kind, sourceRef: owner.sourceRef } },
    dependencies: [dependency("owner", owner.kind === "god" ? "major_god" : owner.kind, owner.sourceRef, owner.name), ...extra],
  });

  add({ kind: "cosmology", sourceKind: "world_card", sourceRef: "world:cosmology", name: `${deck.worldName}·宇宙论`, summary: deck.cosmology.origin.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "cosmology", card: deck.cosmology }, dependencies: [] });
  if (deck.fusionAxiom) add({ kind: "fusion_axiom", sourceKind: "world_card", sourceRef: "world:fusion_axiom", name: `${deck.worldName}·融合公理`, summary: deck.fusionAxiom.conflictRule.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "fusion_axiom", card: deck.fusionAxiom }, dependencies: [] });
  add({ kind: "epoch_conflict", sourceKind: "world_card", sourceRef: "world:epoch_conflict", name: deck.epochConflict.epochName, summary: deck.epochConflict.overtConflicts.join("；").slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "epoch_conflict", card: deck.epochConflict }, dependencies: [] });
  add({ kind: "style", sourceKind: "world_card", sourceRef: "world:style", name: deck.style.presetName, summary: deck.style.toneNotes.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "style", card: deck.style }, dependencies: [] });
  add({ kind: "theme", sourceKind: "world_card", sourceRef: "world:theme", name: `${deck.worldName}·主题`, summary: deck.theme.addressStyle.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "theme", card: deck.theme }, dependencies: [] });

  if (deck.mode === "pantheon") {
    add({ kind: "player_god", sourceKind: "god", sourceRef: deck.playerGod.ref, name: deck.playerGod.name, summary: deck.playerGod.situation.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "player_god", card: deck.playerGod }, dependencies: [] });
    deck.playerGod.abilities.forEach((ability) => addAbility(ability, { kind: "god", sourceRef: deck.playerGod.ref, name: deck.playerGod.name }));
  }
  deck.majorGods.forEach((god) => {
    add({ kind: "major_god", sourceKind: "god", sourceRef: god.ref, name: god.name, summary: god.persona.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "major_god", card: god }, dependencies: [] });
    god.abilities.forEach((ability) => addAbility(ability, { kind: "god", sourceRef: god.ref, name: god.name }));
  });
  deck.races.forEach((race) => {
    add({ kind: "race", sourceKind: "entity", sourceRef: race.ref, name: race.name, summary: race.traits.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "race", card: race }, dependencies: [] });
    race.abilities.forEach((ability) => addAbility(ability, { kind: "race", sourceRef: race.ref, name: race.name }));
  });
  deck.factions.forEach((faction) => add({ kind: "faction", sourceKind: "entity", sourceRef: faction.ref, name: faction.name, summary: faction.overview.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "faction", card: faction }, dependencies: faction.keyCharacterRefs.map(({ ref }) => dependency("card_ref", "character", ref, "关键人物", false)) }));
  deck.places.forEach((place) => add({ kind: "place", sourceKind: "entity", sourceRef: place.ref, name: place.name, summary: place.overview.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "place", card: place }, dependencies: [] }));
  deck.majorCharacters.forEach((character) => {
    const deps = [
      dependency("race", "race", character.raceRef, "主种族"),
      ...character.factionMemberships.map(({ factionRef }) => dependency("faction", "faction", factionRef, "所属势力")),
      ...character.learnedTraditionRefs.map(({ sourceAbilityRef }) => dependency("ability_source", "ability", sourceAbilityRef, "已学族群技艺")),
    ];
    add({ kind: "character", sourceKind: "entity", sourceRef: character.ref, name: character.name, summary: character.situation.slice(0, 160), content: { schemaVersion: 1, origin: "deck", kind: "character", card: character }, dependencies: deps });
    character.abilities.forEach((ability) => addAbility(ability, { kind: "character", sourceRef: character.ref, name: character.name }));
    character.racialOverrides.forEach((ability) => addAbility(ability, { kind: "character", sourceRef: character.ref, name: character.name }, [dependency("ability_source", "ability", ability.sourceAbilityRef, "血脉来源")]));
  });
  return result;
}
