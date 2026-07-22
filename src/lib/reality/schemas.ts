import { z } from "zod";
import type { WorldDeck } from "@/lib/cards/schemas";
import {
  CosmologyCardSchema,
  FusionAxiomCardSchema,
  StableRefSchema,
  StyleCardSchema,
  ThemeCardSchema,
} from "@/lib/cards/schemas";

export const EstablishedFactSchema = z.object({
  ref: StableRefSchema,
  text: z.string().min(1),
  establishedByRewriteId: z.string().nullable(),
}).strict();

export const RealityStateSchema = z.object({
  theme: ThemeCardSchema,
  style: StyleCardSchema,
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable(),
  currentEra: z.string(),
  establishedFacts: z.array(EstablishedFactSchema),
}).strict();

export const ObserverStateSchema = z.object({
  focusType: z.enum(["world", "place", "entity", "god", "avatar"]),
  focusId: z.string().nullable(),
  timeLabel: z.string(),
  viewpoint: z.enum(["omniscient", "limited"]),
  activeAvatarId: z.string().nullable(),
}).strict();

export type RealityState = z.infer<typeof RealityStateSchema>;
export type ObserverState = z.infer<typeof ObserverStateSchema>;

export function initialRealityState(deck: WorldDeck): RealityState {
  return RealityStateSchema.parse({
    theme: deck.theme,
    style: deck.style,
    cosmology: deck.cosmology,
    fusionAxiom: deck.fusionAxiom,
    currentEra: deck.epochConflict.yearLabel,
    establishedFacts: [],
  });
}

export function initialObserverState(deck: WorldDeck): ObserverState {
  return ObserverStateSchema.parse({
    focusType: "world",
    focusId: null,
    timeLabel: deck.epochConflict.yearLabel,
    viewpoint: "omniscient",
    activeAvatarId: null,
  });
}

/** Stable summary shown for the root node in the reality tree. */
export function initialBranchSummary(deck: WorldDeck): string {
  const { epochName, yearLabel, overtConflicts } = deck.epochConflict;
  const conflicts = overtConflicts.join("；");
  return `${epochName} · ${yearLabel}${conflicts ? `：${conflicts}` : ""}`;
}
