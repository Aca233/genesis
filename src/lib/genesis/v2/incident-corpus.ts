/**
 * Stable regression cases distilled from production Genesis incidents.
 *
 * This corpus intentionally describes observable safety contracts only. It is
 * not an alternate implementation of the transport, validator, or DAG.
 */
export const GENESIS_V2_INCIDENT_CATEGORIES = [
  "structural_contract",
  "transport",
  "structured_validation",
  "source_fidelity",
  "shadow_isolation",
] as const;

export type GenesisV2IncidentCategory =
  (typeof GENESIS_V2_INCIDENT_CATEGORIES)[number];

export type GenesisV2IncidentClassification =
  | "missing_required_slot"
  | "empty_stream"
  | "terminal_unknown"
  | "validation_exhausted"
  | "locked_source_mismatch"
  | "inherit_write_attempt"
  | "full_lock_source_mismatch"
  | "forbidden_shadow_write";

export type GenesisV2HardGate =
  | "reject_unsealed_artifact"
  | "start_new_physical_attempt"
  | "hold_permit_until_terminal_evidence"
  | "forbid_retry_or_fallback"
  | "stop_after_validation_budget"
  | "preserve_source_fields_exactly"
  | "exclude_inherited_fields_from_model_writes"
  | "forbid_world_projection";

export interface GenesisV2IncidentCase {
  readonly id: string;
  readonly category: GenesisV2IncidentCategory;
  readonly signal: string;
  readonly expectedClassification: GenesisV2IncidentClassification;
  readonly hardGates: readonly GenesisV2HardGate[];
  readonly expected: Readonly<Record<string, unknown>>;
}

export const GENESIS_V2_INCIDENT_CORPUS = [
  {
    id: "genesis-v2.race-abilities.minimum-two",
    category: "structural_contract",
    signal: "races[0/1].abilities fails minimum=2",
    expectedClassification: "missing_required_slot",
    hardGates: ["reject_unsealed_artifact"],
    expected: {
      requiredSlotIds: ["innate", "tradition"],
      repairScope: "missing_slot_only",
      preserves: ["ref", "owner", "order"],
    },
  },
  {
    id: "genesis-v2.transport.empty-stream",
    category: "transport",
    signal: "provider stream reaches EOF without content",
    expectedClassification: "empty_stream",
    hardGates: ["start_new_physical_attempt"],
    expected: {
      continuationAllowed: false,
      terminalEvidence: "stream_eof",
    },
  },
  {
    id: "genesis-v2.transport.socket-terminated",
    category: "transport",
    signal: "socket terminated before provider terminal evidence",
    expectedClassification: "terminal_unknown",
    hardGates: [
      "hold_permit_until_terminal_evidence",
      "forbid_retry_or_fallback",
    ],
    expected: {
      releasesPermit: false,
      entersWaitingForProvider: true,
    },
  },
  {
    id: "genesis-v2.transport.gateway-504-html",
    category: "transport",
    signal: "HTTP 504 carries an openresty HTML error page",
    expectedClassification: "terminal_unknown",
    hardGates: [
      "hold_permit_until_terminal_evidence",
      "forbid_retry_or_fallback",
    ],
    expected: {
      releasesPermit: false,
      htmlIsStructuredPayload: false,
    },
  },
  {
    id: "genesis-v2.validation.structured-three-failures",
    category: "structured_validation",
    signal: "structured output still fails validation after three attempts",
    expectedClassification: "validation_exhausted",
    hardGates: ["stop_after_validation_budget", "reject_unsealed_artifact"],
    expected: {
      maximumAttempts: 3,
      accepted: false,
    },
  },
  {
    id: "genesis-v2.material.locked-fidelity",
    category: "source_fidelity",
    signal: "a locked material differs from its source fields",
    expectedClassification: "locked_source_mismatch",
    hardGates: ["preserve_source_fields_exactly", "reject_unsealed_artifact"],
    expected: {
      comparison: "field_by_field",
      preservesOriginalRef: true,
    },
  },
  {
    id: "genesis-v2.material.inherit-write-protection",
    category: "source_fidelity",
    signal: "a model attempts to write an inherited core field",
    expectedClassification: "inherit_write_attempt",
    hardGates: ["exclude_inherited_fields_from_model_writes"],
    expected: {
      modelWritable: false,
      preservesOriginalRef: true,
    },
  },
  {
    id: "genesis-v2.material.full-lock-fidelity",
    category: "source_fidelity",
    signal: "a fullLock material differs from its complete source card",
    expectedClassification: "full_lock_source_mismatch",
    hardGates: ["preserve_source_fields_exactly", "reject_unsealed_artifact"],
    expected: {
      comparison: "entire_card_field_by_field",
      preservesOriginalRef: true,
    },
  },
  {
    id: "genesis-v2.shadow.forbidden-world-projection",
    category: "shadow_isolation",
    signal: "a shadow run attempts to persist a legacy world projection",
    expectedClassification: "forbidden_shadow_write",
    hardGates: ["forbid_world_projection"],
    expected: {
      forbiddenWrites: ["World", "draftDeck"],
      artifactWritesAllowed: true,
    },
  },
] as const satisfies readonly GenesisV2IncidentCase[];
