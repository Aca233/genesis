import type { Scale } from "@/lib/cards/schemas";
import type { SettlementReason } from "./continuous-meta";

export type DeterministicSettlementReason =
  | SettlementReason
  | "six_reply_checkpoint"
  | "time_advance";

const WIDE_SCALES = new Set<Scale>(["years", "era", "epoch"]);
const HARD_REASONS = new Set<SettlementReason>([
  "ability_change",
  "important_death",
  "faction_change",
  "rank_change",
  "identity_change",
  "relation_restructure",
  "era_change",
  "multi_entity_change",
]);

export function decideSettlement(input: {
  scale: Scale;
  narratorCountAfter: number;
  temporalChanged: boolean;
  eraChanged: boolean;
  significantEvent: boolean;
  settlementReasons: readonly SettlementReason[];
}): {
  required: boolean;
  reasons: DeterministicSettlementReason[];
} {
  const reasons = new Set<DeterministicSettlementReason>(
    input.settlementReasons,
  );
  if (input.narratorCountAfter >= 6) {
    reasons.add("six_reply_checkpoint");
  }
  if (input.eraChanged) {
    reasons.add("era_change");
  }
  if (WIDE_SCALES.has(input.scale) && input.temporalChanged) {
    reasons.add("time_advance");
  }
  const semanticMajor = input.significantEvent
    && input.settlementReasons.length > 0;
  const hardChange = input.settlementReasons.some(
    (reason) => HARD_REASONS.has(reason),
  );
  return {
    required: semanticMajor
      || hardChange
      || reasons.has("six_reply_checkpoint")
      || reasons.has("time_advance")
      || reasons.has("era_change"),
    reasons: [...reasons],
  };
}

