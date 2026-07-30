import { createHash } from "node:crypto";
import type { GenesisMaterialSnapshot, GenesisMaterialSnapshotItem, MaterialKind } from "@/lib/materials/types";
import type { WorldMode } from "@/lib/world-mode";
import { GENESIS_V2_STAGE_IDS, type GenesisV2StageId } from "./stage-registry";

const PREFLIGHT_SCHEMA_VERSION = 1 as const;
const MAX_INPUT_TOKENS = 50_000;
const MAX_OUTPUT_TOKENS = 32_000;
const CORE_STAGES = GENESIS_V2_STAGE_IDS;

export type GenesisV2Stage = GenesisV2StageId;
export type StructuralSlotCategory = "entity" | "ability" | "event" | "relation_intent";
export type StructuralSlotBinding = "generated" | "inherit" | "locked" | "full_lock";

export type StructuralSlot = {
  slotId: string;
  category: StructuralSlotCategory;
  kind: string;
  order: number;
  canonicalRef: string;
  ownerSlotId: string | null;
  role: string | null;
  binding: StructuralSlotBinding;
  materialVersionId: string | null;
  sourceRef: string | null;
};

export type StructuralManifest = {
  schemaVersion: typeof PREFLIGHT_SCHEMA_VERSION;
  mode: WorldMode;
  slots: StructuralSlot[];
  counts: Record<string, number>;
  manifestHash: string;
};

export type SourceObligation = {
  obligationId: string;
  sourceType: "decree" | "lorebook" | "material";
  sourceHash: string;
  sourcePointer: string;
  sourceText: string;
  strength: "exact" | "semantic" | "inspirational";
  criticality: "core_required" | "core_preferred" | "enrichment_only";
  polarity: "require" | "forbid";
  targetStages: GenesisV2Stage[];
  targetSlots: string[];
  visibility: "model_and_validator" | "validator_only";
  verificationMode: "canonical_json_exact" | "exact_value" | "semantic_core" | "recognizable_influence";
  evidenceBudgetClass: "non_evictable" | "preferred";
};

export type SourceObligationManifest = {
  schemaVersion: typeof PREFLIGHT_SCHEMA_VERSION;
  obligations: SourceObligation[];
  manifestHash: string;
};

export type ComplexityPlan = {
  kind: "standard" | "extended";
  standardEntitySlots: number;
  entitySlots: number;
  abilitySlots: number;
  eventSlots: number;
  relationIntentSlots: number;
  requiredObligations: number;
  extensionReasons: string[];
};

export type PreflightBudgetPlan = {
  taskClass: "genesis_shadow";
  priority: "lowest";
  maxCalls: 5;
  maxInputTokens: number;
  maxOutputTokens: number;
  estimatedEvidenceTokens: number;
  stages: Array<{
    stage: GenesisV2Stage;
    maxInputTokens: number;
    maxOutputTokens: number;
  }>;
};

export type DeterministicPreflightInput = {
  mode: WorldMode;
  decree: string;
  lorebook?: unknown | null;
  materialSelection?: GenesisMaterialSnapshot | null;
};

export type DeterministicPreflightResult = {
  schemaVersion: typeof PREFLIGHT_SCHEMA_VERSION;
  structuralManifest: StructuralManifest;
  sourceObligationManifest: SourceObligationManifest;
  complexityPlan: ComplexityPlan;
  budgetPlan: PreflightBudgetPlan;
  preflightHash: string;
};

type ManifestWithoutHash = Omit<StructuralManifest, "manifestHash">;
type ObligationsWithoutHash = Omit<SourceObligationManifest, "manifestHash">;

const BASE_ENTITY_COUNTS: Record<WorldMode, ReadonlyArray<readonly [string, number]>> = {
  pantheon: [
    ["player_god", 1], ["major_god", 4], ["race", 2], ["faction", 3],
    ["place", 4], ["character", 4], ["cosmology", 1], ["fusion_axiom", 1],
    ["epoch_conflict", 1],
  ],
  creator: [
    ["major_god", 4], ["race", 2], ["faction", 3], ["place", 4],
    ["character", 4], ["cosmology", 1], ["fusion_axiom", 1], ["epoch_conflict", 1],
  ],
};

const ABILITY_ROLES: Record<string, readonly string[]> = {
  player_god: ["signature", "influence", "crisis"],
  major_god: ["domain", "agenda", "counterplay"],
  race: ["innate", "tradition"],
  character: ["identity", "dilemma"],
};

const FORBID_PATTERN = /(?:禁止|不得|不要|不能|不可|严禁|避免|must\s+not|do\s+not|never)/iu;

export function runDeterministicPreflight(input: DeterministicPreflightInput): DeterministicPreflightResult {
  assertInput(input);
  const structuralManifest = buildStructuralManifest(input.mode, input.materialSelection ?? null);
  const sourceObligationManifest = buildSourceObligationManifest(input, structuralManifest);
  const complexityPlan = buildComplexityPlan(input.mode, structuralManifest, sourceObligationManifest);
  const budgetPlan = buildBudgetPlan(structuralManifest, sourceObligationManifest, complexityPlan);
  const unsigned = {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    structuralManifest,
    sourceObligationManifest,
    complexityPlan,
    budgetPlan,
  };
  return { ...unsigned, preflightHash: stableHash(unsigned) };
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function assertInput(input: DeterministicPreflightInput): void {
  if (input.mode !== "pantheon" && input.mode !== "creator") throw new Error("不支持的创世模式");
  if (typeof input.decree !== "string" || input.decree.trim().length < 2) throw new Error("创世敕令过短");
  if (input.materialSelection && input.materialSelection.schemaVersion !== 1) throw new Error("不支持的素材快照版本");
}

function buildStructuralManifest(mode: WorldMode, materialSelection: GenesisMaterialSnapshot | null): StructuralManifest {
  const slots: StructuralSlot[] = [];
  const perKind = new Map<string, number>();
  const addSlot = (category: StructuralSlotCategory, kind: string, ownerSlotId: string | null, role: string | null): StructuralSlot => {
    const index = (perKind.get(kind) ?? 0) + 1;
    perKind.set(kind, index);
    const slotId = `${slotPrefix(kind)}${pad(index)}`;
    const slot: StructuralSlot = {
      slotId,
      category,
      kind,
      order: slots.length,
      canonicalRef: `gv2:${mode}:${kind}:${pad(index)}`,
      ownerSlotId,
      role,
      binding: "generated",
      materialVersionId: null,
      sourceRef: null,
    };
    slots.push(slot);
    return slot;
  };

  for (const [kind, count] of BASE_ENTITY_COUNTS[mode]) {
    for (let index = 0; index < count; index += 1) addSlot("entity", kind, null, null);
  }
  for (let index = 0; index < 3; index += 1) addSlot("event", "upcoming_event", null, null);

  const forcedMaterials = sortedMaterials(materialSelection).filter((item) =>
    item.selection.mode === "locked" || item.selection.mode === "inherit" || item.selection.fullLock,
  );
  for (const item of forcedMaterials.filter((candidate) => candidate.card.kind !== "ability")) {
    bindMaterialSlot(slots, addSlot, item);
  }

  const owners = slots.filter((slot) => slot.category === "entity" && ABILITY_ROLES[slot.kind]);
  for (const owner of owners) {
    for (const role of ABILITY_ROLES[owner.kind] ?? []) addSlot("ability", "ability", owner.slotId, role);
  }
  for (const item of forcedMaterials.filter((candidate) => candidate.card.kind === "ability")) {
    const slot = addSlot("ability", "ability", findAbilityOwner(slots, materialSelection, item), "material");
    applyMaterialBinding(slot, item);
  }
  for (const character of slots.filter((slot) => slot.category === "entity" && slot.kind === "character")) {
    for (const role of ["faction", "divinity", "central_conflict"] as const) {
      addSlot("relation_intent", "relation_intent", character.slotId, role);
    }
  }

  slots.forEach((slot, order) => { slot.order = order; });
  const counts = slots.reduce<Record<string, number>>((result, slot) => {
    result[slot.kind] = (result[slot.kind] ?? 0) + 1;
    return result;
  }, {});
  const unsigned: ManifestWithoutHash = { schemaVersion: PREFLIGHT_SCHEMA_VERSION, mode, slots, counts };
  return { ...unsigned, manifestHash: stableHash(unsigned) };
}

function bindMaterialSlot(
  slots: StructuralSlot[],
  addSlot: (category: StructuralSlotCategory, kind: string, ownerSlotId: string | null, role: string | null) => StructuralSlot,
  item: GenesisMaterialSnapshotItem,
): void {
  const slot = slots.find((candidate) =>
    candidate.category === "entity"
    && candidate.kind === item.card.kind
    && candidate.materialVersionId === null,
  ) ?? addSlot("entity", item.card.kind, null, null);
  applyMaterialBinding(slot, item);
}

function applyMaterialBinding(slot: StructuralSlot, item: GenesisMaterialSnapshotItem): void {
  const sourceRef = item.card.sourceRef.trim();
  if (!sourceRef) throw new Error(`素材 ${item.version.id} 缺少可继承的 sourceRef`);
  slot.canonicalRef = sourceRef;
  slot.sourceRef = sourceRef;
  slot.materialVersionId = item.version.id;
  slot.binding = item.selection.fullLock
    ? "full_lock"
    : item.selection.mode === "locked" ? "locked" : "inherit";
}

function findAbilityOwner(
  slots: StructuralSlot[],
  snapshot: GenesisMaterialSnapshot | null,
  item: GenesisMaterialSnapshotItem,
): string | null {
  const selectedOwner = item.selection.abilityOwner?.mode === "selected"
    ? item.selection.abilityOwner.materialVersionId
    : null;
  if (selectedOwner) return slots.find((slot) => slot.materialVersionId === selectedOwner)?.slotId ?? null;
  const content = asRecord(item.version.content);
  const owner = asRecord(content?.owner);
  const ownerRef = typeof owner?.sourceRef === "string" ? owner.sourceRef : null;
  if (ownerRef) return slots.find((slot) => slot.canonicalRef === ownerRef)?.slotId ?? null;
  const ownerMaterial = snapshot?.items.find((candidate) => candidate.card.sourceRef === ownerRef);
  return ownerMaterial ? slots.find((slot) => slot.materialVersionId === ownerMaterial.version.id)?.slotId ?? null : null;
}

function buildSourceObligationManifest(
  input: DeterministicPreflightInput,
  structuralManifest: StructuralManifest,
): SourceObligationManifest {
  const obligations: SourceObligation[] = [];
  for (const segment of splitStableText(input.decree)) {
    obligations.push(makeObligation({
      sourceType: "decree",
      sourcePointer: `decree:/paragraphs/${segment.paragraph}/sentences/${segment.sentence}`,
      sourceText: segment.text,
      strength: "semantic",
      criticality: "core_required",
      targetStages: [...CORE_STAGES],
      targetSlots: [],
      verificationMode: "semantic_core",
    }));
  }
  obligations.push(...lorebookObligations(input.lorebook));
  for (const item of sortedMaterials(input.materialSelection ?? null)) {
    const targetSlots = structuralManifest.slots
      .filter((slot) => slot.materialVersionId === item.version.id)
      .map((slot) => slot.slotId);
    const isExact = item.selection.mode === "locked" || item.selection.fullLock;
    const isInherited = item.selection.mode === "inherit" && !item.selection.fullLock;
    const sourceText = stableStringify(item.version.content);
    obligations.push(makeObligation({
      sourceType: "material",
      sourcePointer: `material:/versions/${pointerEscape(item.version.id)}/content`,
      sourceText,
      strength: isExact ? "exact" : isInherited ? "semantic" : "inspirational",
      criticality: isExact || isInherited ? "core_required" : "core_preferred",
      targetStages: stagesForMaterial(item.card.kind),
      targetSlots,
      visibility: isExact ? "validator_only" : "model_and_validator",
      verificationMode: isExact ? "canonical_json_exact" : isInherited ? "semantic_core" : "recognizable_influence",
    }));
    if (isExact || isInherited) {
      obligations.push(makeObligation({
        sourceType: "material",
        sourcePointer: `material:/versions/${pointerEscape(item.version.id)}/sourceRef`,
        sourceText: item.card.sourceRef,
        strength: "exact",
        criticality: "core_required",
        targetStages: stagesForMaterial(item.card.kind),
        targetSlots,
        visibility: "validator_only",
        verificationMode: "exact_value",
      }));
    }
  }
  obligations.sort((left, right) => compareText(left.sourcePointer, right.sourcePointer));
  const unsigned: ObligationsWithoutHash = { schemaVersion: PREFLIGHT_SCHEMA_VERSION, obligations };
  return { ...unsigned, manifestHash: stableHash(unsigned) };
}

function lorebookObligations(lorebook: unknown): SourceObligation[] {
  const root = asRecord(lorebook);
  const entries = root?.entries;
  const indexed: Array<{ id: string; value: Record<string, unknown> }> = [];
  if (Array.isArray(entries)) {
    entries.forEach((entry, index) => {
      const value = asRecord(entry);
      if (value) indexed.push({ id: String(index), value });
    });
  } else {
    const record = asRecord(entries);
    if (record) {
      for (const id of Object.keys(record).sort(compareText)) {
        const value = asRecord(record[id]);
        if (value) indexed.push({ id, value });
      }
    }
  }
  const result: SourceObligation[] = [];
  for (const entry of indexed) {
    if (entry.value.disable === true || entry.value.enabled === false) continue;
    const content = typeof entry.value.content === "string" ? entry.value.content : "";
    for (const segment of splitStableText(content)) {
      result.push(makeObligation({
        sourceType: "lorebook",
        sourcePointer: `lorebook:/entries/${pointerEscape(entry.id)}/content/paragraphs/${segment.paragraph}/sentences/${segment.sentence}`,
        sourceText: segment.text,
        strength: "semantic",
        criticality: "core_required",
        targetStages: [...CORE_STAGES],
        targetSlots: [],
        verificationMode: "semantic_core",
      }));
    }
  }
  return result;
}

function makeObligation(input: {
  sourceType: SourceObligation["sourceType"];
  sourcePointer: string;
  sourceText: string;
  strength: SourceObligation["strength"];
  criticality: SourceObligation["criticality"];
  targetStages: GenesisV2Stage[];
  targetSlots: string[];
  visibility?: SourceObligation["visibility"];
  verificationMode: SourceObligation["verificationMode"];
}): SourceObligation {
  const sourceHash = stableHash(input.sourceText);
  const identity = stableHash({ sourcePointer: input.sourcePointer, sourceHash, strength: input.strength });
  const required = input.criticality === "core_required" || input.strength === "exact";
  return {
    obligationId: `obl_${identity.slice(0, 24)}`,
    sourceType: input.sourceType,
    sourceHash,
    sourcePointer: input.sourcePointer,
    sourceText: input.sourceText,
    strength: input.strength,
    criticality: input.criticality,
    polarity: FORBID_PATTERN.test(input.sourceText) ? "forbid" : "require",
    targetStages: input.targetStages,
    targetSlots: input.targetSlots,
    visibility: input.visibility ?? "model_and_validator",
    verificationMode: input.verificationMode,
    evidenceBudgetClass: required ? "non_evictable" : "preferred",
  };
}

function buildComplexityPlan(
  mode: WorldMode,
  structuralManifest: StructuralManifest,
  obligations: SourceObligationManifest,
): ComplexityPlan {
  const standardEntitySlots = BASE_ENTITY_COUNTS[mode].reduce((sum, [, count]) => sum + count, 0);
  const entitySlots = structuralManifest.slots.filter((slot) => slot.category === "entity").length;
  const abilitySlots = structuralManifest.slots.filter((slot) => slot.category === "ability").length;
  const eventSlots = structuralManifest.slots.filter((slot) => slot.category === "event").length;
  const relationIntentSlots = structuralManifest.slots.filter((slot) => slot.category === "relation_intent").length;
  const requiredObligations = obligations.obligations.filter((item) => item.criticality === "core_required").length;
  const extensionReasons: string[] = [];
  if (entitySlots > standardEntitySlots) extensionReasons.push("forced_materials_exceed_standard_slots");
  if (requiredObligations > 80) extensionReasons.push("required_source_obligations_exceed_standard_budget");
  if (obligations.obligations.reduce((sum, item) => sum + utf8Bytes(item.sourceText), 0) > 48_000) {
    extensionReasons.push("source_evidence_exceeds_standard_budget");
  }
  return {
    kind: extensionReasons.length ? "extended" : "standard",
    standardEntitySlots,
    entitySlots,
    abilitySlots,
    eventSlots,
    relationIntentSlots,
    requiredObligations,
    extensionReasons,
  };
}

function buildBudgetPlan(
  structuralManifest: StructuralManifest,
  obligations: SourceObligationManifest,
  complexity: ComplexityPlan,
): PreflightBudgetPlan {
  const evidenceBytes = obligations.obligations.reduce((sum, item) => sum + utf8Bytes(item.sourceText), 0);
  const estimatedEvidenceTokens = Math.max(1, Math.ceil(evidenceBytes / 3));
  if (estimatedEvidenceTokens > 30_000) throw new Error("必需来源义务超过创世预检证据预算");
  const structuralTokens = structuralManifest.slots.length * 48;
  const maxInputTokens = clamp(
    estimatedEvidenceTokens * 2 + structuralTokens + (complexity.kind === "extended" ? 12_000 : 8_000),
    12_000,
    MAX_INPUT_TOKENS,
  );
  const maxOutputTokens = complexity.kind === "extended" ? 30_000 : 24_000;
  const inputShares = [18, 22, 22, 16, 22] as const;
  const outputShares = [16, 22, 22, 18, 22] as const;
  return {
    taskClass: "genesis_shadow",
    priority: "lowest",
    maxCalls: 5,
    maxInputTokens,
    maxOutputTokens: Math.min(maxOutputTokens, MAX_OUTPUT_TOKENS),
    estimatedEvidenceTokens,
    stages: CORE_STAGES.map((stage, index) => ({
      stage,
      maxInputTokens: Math.ceil(maxInputTokens * inputShares[index] / 100),
      maxOutputTokens: Math.ceil(maxOutputTokens * outputShares[index] / 100),
    })),
  };
}

function stagesForMaterial(kind: MaterialKind): GenesisV2Stage[] {
  if (kind === "player_god" || kind === "major_god" || kind === "ability") return ["blueprint", "pantheon_domain", "characters"];
  if (kind === "race" || kind === "faction" || kind === "place") return ["blueprint", "civilizations", "characters"];
  if (kind === "epoch_conflict") return ["blueprint", "eras", "characters"];
  return [...CORE_STAGES];
}

function splitStableText(source: string): Array<{ paragraph: number; sentence: number; text: string }> {
  const normalized = source.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n[\t \u3000]*\n+/gu);
  const result: Array<{ paragraph: number; sentence: number; text: string }> = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const compact = paragraph.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
    const sentences = compact.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [];
    sentences.map((sentence) => sentence.trim()).filter(Boolean).forEach((text, sentenceIndex) => {
      result.push({ paragraph: paragraphIndex, sentence: sentenceIndex, text });
    });
  });
  return result;
}

function sortedMaterials(snapshot: GenesisMaterialSnapshot | null): GenesisMaterialSnapshotItem[] {
  return [...(snapshot?.items ?? [])].sort((left, right) =>
    left.selection.priority - right.selection.priority
    || compareText(left.version.id, right.version.id),
  );
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("稳定序列化不支持非有限数字");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalize(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareText)) {
      if (record[key] !== undefined) result[key] = canonicalize(record[key]);
    }
    return result;
  }
  throw new Error(`稳定序列化不支持 ${typeof value}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pointerEscape(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function slotPrefix(kind: string): string {
  return kind.split("_").map((part, index) => index === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
