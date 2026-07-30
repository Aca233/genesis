export const GENESIS_V2_STAGE_IDS = [
  "blueprint",
  "pantheon_domain",
  "civilizations",
  "eras",
  "characters",
] as const;

export type GenesisV2StageId = (typeof GENESIS_V2_STAGE_IDS)[number];
export type GenesisV2WaveId = "blueprint" | "core_parallel" | "characters";

export interface GenesisV2StageContract {
  readonly id: GenesisV2StageId;
  readonly wave: GenesisV2WaveId;
  readonly contractVersion: string;
  readonly outputSchemaId: string;
  readonly dependencies: readonly GenesisV2StageId[];
  readonly ownedFields: readonly string[];
  readonly allowedTargetKinds: readonly string[];
  readonly evidenceSlice: string;
}

function freezeContract(contract: GenesisV2StageContract): GenesisV2StageContract {
  Object.freeze(contract.dependencies);
  Object.freeze(contract.ownedFields);
  Object.freeze(contract.allowedTargetKinds);
  return Object.freeze(contract);
}

const registry = [
  freezeContract({
    id: "blueprint",
    wave: "blueprint",
    contractVersion: "genesis-v2/blueprint/v1",
    outputSchemaId: "genesis-v2/blueprint/output-v1",
    dependencies: [],
    ownedFields: [
      "worldProposition",
      "cosmology",
      "timeAnchors",
      "centralConflict",
      "canonBrief",
      "slotBriefs",
      "differentiationMatrix",
    ],
    allowedTargetKinds: ["world", "slot_brief"],
    evidenceSlice: "world_rules_timeline_and_cross_domain_materials",
  }),
  freezeContract({
    id: "pantheon_domain",
    wave: "core_parallel",
    contractVersion: "genesis-v2/pantheon-domain/v1",
    outputSchemaId: "genesis-v2/pantheon-domain/output-v1",
    dependencies: ["blueprint"],
    ownedFields: [
      "gods.core",
      "gods.currentGoals",
      "gods.conflictLinks",
      "gods.domainAbilities",
    ],
    allowedTargetKinds: ["player_god", "major_god", "divine_ability"],
    evidenceSlice: "divinity_power_and_pantheon_materials",
  }),
  freezeContract({
    id: "civilizations",
    wave: "core_parallel",
    contractVersion: "genesis-v2/civilizations/v1",
    outputSchemaId: "genesis-v2/civilizations/output-v1",
    dependencies: ["blueprint"],
    ownedFields: [
      "races.core",
      "races.abilities",
      "factions.core",
      "places.core",
      "territorialAffiliations",
    ],
    allowedTargetKinds: ["race", "race_ability", "faction", "place"],
    evidenceSlice: "race_faction_place_and_territory_materials",
  }),
  freezeContract({
    id: "eras",
    wave: "core_parallel",
    contractVersion: "genesis-v2/eras/v1",
    outputSchemaId: "genesis-v2/eras/output-v1",
    dependencies: ["blueprint"],
    ownedFields: [
      "timeAnchors.detail",
      "epochConflict",
      "impendingEvents",
      "conditionalConsequences",
      "styleExecutionRules",
    ],
    allowedTargetKinds: ["era", "event", "consequence", "style_rule"],
    evidenceSlice: "timeline_canon_cutoff_and_historical_materials",
  }),
  freezeContract({
    id: "characters",
    wave: "characters",
    contractVersion: "genesis-v2/characters/v1",
    outputSchemaId: "genesis-v2/characters/output-v1",
    dependencies: ["pantheon_domain", "civilizations", "eras"],
    ownedFields: [
      "characters.core",
      "characters.abilities",
      "characters.affiliations",
      "relationshipIntents",
    ],
    allowedTargetKinds: ["major_character", "character_ability", "relationship_intent"],
    evidenceSlice: "character_relationship_and_cross_domain_materials",
  }),
] satisfies GenesisV2StageContract[];

export const GENESIS_V2_STAGE_REGISTRY: readonly GenesisV2StageContract[] =
  Object.freeze(registry);

export const GENESIS_V2_STAGE_WAVES: readonly (readonly GenesisV2StageId[])[] =
  Object.freeze([
    Object.freeze(["blueprint"] as const),
    Object.freeze(["pantheon_domain", "civilizations", "eras"] as const),
    Object.freeze(["characters"] as const),
  ]);

const contractsById = new Map<GenesisV2StageId, GenesisV2StageContract>(
  GENESIS_V2_STAGE_REGISTRY.map((contract) => [contract.id, contract]),
);

export function getGenesisV2StageContract(stageId: GenesisV2StageId): GenesisV2StageContract {
  const contract = contractsById.get(stageId);
  if (!contract) {
    throw new Error(`Unknown Genesis V2 stage: ${stageId}`);
  }
  return contract;
}
