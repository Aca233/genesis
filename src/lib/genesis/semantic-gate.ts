import { z } from "zod";
import type { WorldDeck } from "@/lib/cards/schemas";
import { completeStructured } from "@/lib/llm/structured";
import type { CompletionRequest, SlotName } from "@/lib/llm/types";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import {
  GENESIS_SEMANTIC_REPAIR_SYSTEM,
  semanticRepairPrompt,
} from "@/lib/prompts/genesis-quality";
import type { WorldMode } from "@/lib/world-mode";
import { validateGenesisDeck } from "./generate";
import type { GenesisIntentContract } from "./intent";
import {
  auditGenesisSemantics,
  hasBlockingIssues,
  type GenesisQualityReport,
  type GenesisSemanticIssue,
  type GenesisSemanticAuditResult,
} from "./semantic-audit";
import { preserveLockedPaths } from "./locked-paths";
import {
  GENESIS_MODEL_INPUT_MAX_BYTES,
  GENESIS_MODEL_OUTPUT_MAX_BYTES,
} from "./limits";

type GenesisQualityGateInput = {
  deck: WorldDeck;
  mode: WorldMode;
  decree: string;
  intent: GenesisIntentContract;
  userId: string;
  lorebookExcerpts?: string;
  materialSnapshot: GenesisMaterialSnapshot | null;
  materialConstraints?: string;
  lockedPaths?: string[];
  currentDeck?: WorldDeck;
  owner?: CompletionRequest["owner"];
  onStage?: (stage: "audit" | "semantic_repair") => Promise<void> | void;
};

type SemanticRepairRequest = {
  task: "genesis";
  userId: string;
  owner?: CompletionRequest["owner"];
  system: string;
  user: string;
  schema: typeof GenesisSemanticRepairResultSchema;
  temperature: number;
  maxTokens: number;
  maxAttempts: number;
  transportMaxAttempts: number;
  allowTransportFallback: boolean;
  failOnTruncation: boolean;
  cache: { namespace: string };
  maxInputBytes: number;
  maxOutputBytes: number;
};

const MAX_SEMANTIC_REPAIR_ROUNDS = 5;

const JsonTextSchema = z.string().refine((value) => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}, "valueJson 必须包含一个合法 JSON 值");

const NormalizedJsonTextSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}, JsonTextSchema);

const ReplaceOperationSchema = z.union([
  z.object({
    path: z.string().min(1),
    action: z.literal("replace"),
    valueJson: NormalizedJsonTextSchema,
  }).strict(),
  z.object({
    path: z.string().min(1),
    action: z.literal("replace"),
    value: NormalizedJsonTextSchema,
  }).strict().transform(({ path, action, value }) => ({ path, action, valueJson: value })),
]);

const RemoveOperationSchema = z.union([
  z.object({
    path: z.string().min(1),
    action: z.literal("remove"),
    valueJson: z.null().optional(),
  }).strict(),
  z.object({
    path: z.string().min(1),
    action: z.literal("remove"),
    value: z.null(),
  }).strict(),
]).transform(({ path, action }) => ({ path, action, valueJson: null }));

const SemanticRepairOperationSchema = z.union([ReplaceOperationSchema, RemoveOperationSchema]);
const SemanticRepairOperationsSchema = z.array(SemanticRepairOperationSchema).max(16);

export const GenesisSemanticRepairResultSchema = z.union([
  z.object({ operations: SemanticRepairOperationsSchema }).strict(),
  SemanticRepairOperationsSchema.transform((operations) => ({ operations })),
]);
type GenesisSemanticRepairResult = z.infer<typeof GenesisSemanticRepairResultSchema>;

export type GenesisQualityGateDeps = {
  audit: typeof auditGenesisSemantics;
  repair: (slot: SlotName, request: SemanticRepairRequest) => Promise<unknown>;
  validate: typeof validateGenesisDeck;
};

export const defaultGenesisQualityGateDeps: GenesisQualityGateDeps = {
  audit: auditGenesisSemantics,
  repair: (slot, request) => completeStructured(slot, request),
  validate: validateGenesisDeck,
};

export class GenesisSemanticGateError extends Error {
  override name = "GenesisSemanticGateError";
  readonly report: GenesisQualityReport;

  constructor(report: GenesisQualityReport) {
    super("创世语义修复后仍有阻断问题，已安全终止生成");
    this.report = report;
  }
}

export class GenesisSemanticRepairValidationError extends Error {
  override name = "GenesisSemanticRepairValidationError";

  constructor(validationError: string) {
    super(`语义补丁未通过完整世界校验：${validationError.slice(0, 1_000)}`);
  }
}

function withMetrics(
  report: GenesisSemanticAuditResult,
  initialReport: GenesisSemanticAuditResult,
  repaired: boolean,
  auditPasses: 1 | 2 | 3 | 4 | 5 | 6,
  startedAt: number,
): GenesisQualityReport {
  return {
    ...report,
    meta: {
      initialErrorCount: initialReport.issues.filter(({ severity }) => severity === "error").length,
      initialWarningCount: initialReport.issues.filter(({ severity }) => severity === "warning").length,
      repaired,
      auditPasses,
      durationMs: Math.max(0, Date.now() - startedAt),
    },
  };
}

function auditOptions(input: GenesisQualityGateInput) {
  return {
    userId: input.userId,
    decree: input.decree,
    intent: input.intent,
    lorebookExcerpts: input.lorebookExcerpts,
    owner: input.owner,
  };
}

const MISSING_PATH = Symbol("missing-semantic-repair-path");

function pathSegments(path: string): string[] {
  return path.match(/[^.[\]]+/g) ?? [];
}

function readPath(value: unknown, segments: string[]): unknown | typeof MISSING_PATH {
  let current = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !(segment in current)) {
      return MISSING_PATH;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function semanticIdentityTokens(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record.ref, record.name, ...(Array.isArray(record.aliases) ? record.aliases : [])]
    .filter((token): token is string => typeof token === "string" && token.length >= 2);
}

function canonicalizeDirectArrayIssuePath(
  deck: WorldDeck,
  issue: GenesisSemanticIssue,
): GenesisSemanticIssue {
  const segments = pathSegments(issue.path);
  const key = segments.at(-1);
  if (key === undefined || !/^\d+$/.test(key)) return issue;
  const parent = readPath(deck, segments.slice(0, -1));
  if (!Array.isArray(parent)) return issue;

  const evidence = [issue.explanation, issue.repairInstruction, ...issue.evidenceRefs].join("\n");
  const matches = parent.flatMap((value, index) =>
    semanticIdentityTokens(value).some((token) => evidence.includes(token)) ? [index] : [],
  );
  if (matches.length !== 1 || matches[0] === Number(key)) return issue;

  const correctedIndex = String(matches[0]);
  const path = issue.path.endsWith(`[${key}]`)
    ? `${issue.path.slice(0, -(`[${key}]`.length))}[${correctedIndex}]`
    : `${issue.path.slice(0, -(key.length))}${correctedIndex}`;
  return { ...issue, path };
}

const REMOVABLE_REFERENCE_ISSUE_TYPES = new Set<GenesisSemanticIssue["type"]>([
  "anchor_state_leak",
  "ontology_mismatch",
  "causal_disconnect",
  "continuity_mix",
  "unsupported_canon_claim",
]);

function canonicalizeReferenceLeafIssuePath(
  deck: WorldDeck,
  issue: GenesisSemanticIssue,
): GenesisSemanticIssue {
  if (issue.severity !== "error" || !REMOVABLE_REFERENCE_ISSUE_TYPES.has(issue.type)) {
    return issue;
  }
  const segments = pathSegments(issue.path);
  const field = segments.at(-1);
  const index = segments.at(-2);
  const collection = segments.at(-3);
  const isRemovableReference = (collection === "keyCharacterRefs" && field === "ref")
    || (collection === "factionMemberships" && field === "factionRef")
    || (collection === "relationsAtAnchor" && (field === "sourceRef" || field === "targetRef"));
  if (!isRemovableReference || index === undefined || !/^\d+$/.test(index)) return issue;

  const entrySegments = segments.slice(0, -1);
  const entry = readPath(deck, entrySegments);
  if (entry === MISSING_PATH) return issue;
  return {
    ...issue,
    path: issue.path.replace(/\.(?:ref|factionRef|sourceRef|targetRef)$/, ""),
  };
}

function requiredUnsupportedRemovalPaths(
  deck: WorldDeck,
  issues: GenesisSemanticIssue[],
): string[] {
  return issues.flatMap((issue) => {
    if (issue.severity !== "error" || issue.type !== "unsupported_canon_claim") return [];
    const segments = pathSegments(issue.path);
    const key = segments.at(-1);
    if (key === undefined || !/^\d+$/.test(key)) return [];
    const parent = readPath(deck, segments.slice(0, -1));
    return Array.isArray(parent) && Number(key) < parent.length ? [issue.path] : [];
  });
}

function requiredReferenceRemovalPaths(
  deck: WorldDeck,
  issues: GenesisSemanticIssue[],
): string[] {
  return issues.flatMap((issue) => {
    if (issue.severity !== "error" || !REMOVABLE_REFERENCE_ISSUE_TYPES.has(issue.type)) return [];
    const segments = pathSegments(issue.path);
    const index = segments.at(-1);
    const collection = segments.at(-2);
    if (
      index === undefined
      || !/^\d+$/.test(index)
      || (
        collection !== "keyCharacterRefs"
        && collection !== "factionMemberships"
        && collection !== "relationsAtAnchor"
      )
    ) return [];
    const parent = readPath(deck, segments.slice(0, -1));
    return Array.isArray(parent) && Number(index) < parent.length ? [issue.path] : [];
  });
}

function enforceRequiredRemovals(
  repair: GenesisSemanticRepairResult,
  requiredRemovePaths: string[],
): GenesisSemanticRepairResult {
  if (requiredRemovePaths.length === 0) return repair;
  const required = new Set(requiredRemovePaths);
  return {
    operations: [
      ...repair.operations.filter(({ path }) => !required.has(path)),
      ...requiredRemovePaths.map((path) => ({
        path,
        action: "remove" as const,
        valueJson: null,
      })),
    ],
  };
}

const STRUCTURAL_ENTITY_FIELDS = new Set([
  "ref",
  "factionRef",
  "raceRef",
  "sourceAbilityRef",
  "targetGodRef",
  "state",
  "status",
  "statusAtAnchor",
  "kind",
  "mastery",
  "visibility",
  "rank",
  "level",
  "timing",
  "canonRelation",
  "mode",
]);

const STRUCTURAL_ENTITY_COLLECTIONS = new Set([
  "abilities",
  "factionMemberships",
  "learnedTraditionRefs",
  "racialOverrides",
  "relations",
  "keyCharacterRefs",
]);

function mergeEntitySemanticFields(
  original: unknown,
  replacement: unknown,
  field?: string,
): unknown {
  if (field !== undefined && (
    STRUCTURAL_ENTITY_FIELDS.has(field)
    || STRUCTURAL_ENTITY_COLLECTIONS.has(field)
  )) {
    return structuredClone(original);
  }
  if (
    original === null
    || replacement === null
    || typeof original !== "object"
    || typeof replacement !== "object"
    || Array.isArray(original)
    || Array.isArray(replacement)
  ) {
    return structuredClone(replacement);
  }

  const result = structuredClone(original) as Record<string, unknown>;
  for (const [key, value] of Object.entries(replacement)) {
    if (!(key in result)) continue;
    result[key] = mergeEntitySemanticFields(result[key], value, key);
  }
  return result;
}

function hardenDirectArrayEntityReplacement(
  target: unknown,
  segments: string[],
  replacement: unknown,
): unknown {
  const key = segments.at(-1);
  if (key === undefined || !/^\d+$/.test(key)) return replacement;
  const parent = readPath(target, segments.slice(0, -1));
  if (!Array.isArray(parent)) return replacement;
  const original = parent[Number(key)];
  return mergeEntitySemanticFields(original, replacement);
}

function sanitizeReferenceCollectionReplacement(
  target: unknown,
  path: string,
  replacement: unknown,
): unknown {
  if (!path.endsWith(".factionMemberships") || !Array.isArray(replacement)) {
    return replacement;
  }
  if (target === null || typeof target !== "object") return replacement;
  const factions = (target as Record<string, unknown>).factions;
  if (!Array.isArray(factions)) return replacement;
  const validFactionRefs = new Set(factions.flatMap((faction) => {
    if (faction === null || typeof faction !== "object") return [];
    const ref = (faction as Record<string, unknown>).ref;
    return typeof ref === "string" ? [ref] : [];
  }));
  return replacement.filter((membership) => {
    if (membership === null || typeof membership !== "object") return false;
    const record = membership as Record<string, unknown>;
    return typeof record.factionRef === "string"
      && validFactionRefs.has(record.factionRef)
      && typeof record.role === "string"
      && typeof record.isPrimary === "boolean";
  });
}

function writePath(target: unknown, segments: string[], replacement: unknown | typeof MISSING_PATH): void {
  const key = segments.at(-1);
  if (key === undefined) return;

  const parent = readPath(target, segments.slice(0, -1));
  if (parent === MISSING_PATH || parent === null || typeof parent !== "object") return;

  if (replacement === MISSING_PATH) {
    if (Array.isArray(parent) && /^\d+$/.test(key)) parent.splice(Number(key), 1);
    else delete (parent as Record<string, unknown>)[key];
    return;
  }
  (parent as Record<string, unknown>)[key] = structuredClone(replacement);
}

function applySemanticRepairs(
  original: WorldDeck,
  repair: GenesisSemanticRepairResult,
  issuePaths: string[],
): unknown {
  const bounded = structuredClone(original) as unknown;
  const allowedPaths = new Set(issuePaths);
  const operations = [...repair.operations].sort((left, right) => {
    if (left.action !== right.action) return left.action === "replace" ? -1 : 1;
    if (left.action !== "remove" || right.action !== "remove") return 0;
    const leftSegments = pathSegments(left.path);
    const rightSegments = pathSegments(right.path);
    const leftParent = leftSegments.slice(0, -1).join("\u0000");
    const rightParent = rightSegments.slice(0, -1).join("\u0000");
    const leftKey = leftSegments.at(-1) ?? "";
    const rightKey = rightSegments.at(-1) ?? "";
    if (leftParent === rightParent && /^\d+$/.test(leftKey) && /^\d+$/.test(rightKey)) {
      return Number(rightKey) - Number(leftKey);
    }
    return rightSegments.length - leftSegments.length;
  });
  for (const operation of operations) {
    if (!allowedPaths.has(operation.path)) continue;
    const segments = pathSegments(operation.path);
    if (segments.length === 0) continue;
    const replacement = operation.action === "remove"
      ? MISSING_PATH
      : hardenDirectArrayEntityReplacement(
        bounded,
        segments,
        sanitizeReferenceCollectionReplacement(
          bounded,
          operation.path,
          JSON.parse(operation.valueJson),
        ),
      );
    writePath(bounded, segments, replacement);
  }
  return bounded;
}

export async function enforceGenesisQuality(
  input: GenesisQualityGateInput,
  deps: GenesisQualityGateDeps = defaultGenesisQualityGateDeps,
): Promise<{ deck: WorldDeck; report: GenesisQualityReport }> {
  const startedAt = Date.now();
  await input.onStage?.("audit");
  const initialReport = await deps.audit(input.deck, auditOptions(input));

  if (!hasBlockingIssues(initialReport)) {
    return {
      deck: input.deck,
      report: withMetrics(initialReport, initialReport, false, 1, startedAt),
    };
  }

  let currentDeck = input.deck;
  let currentReport = initialReport;
  let finalReport: GenesisQualityReport | undefined;

  for (let round = 1; round <= MAX_SEMANTIC_REPAIR_ROUNDS; round += 1) {
    await input.onStage?.("semantic_repair");
    let repairedDeck: WorldDeck | null = null;
    let repairFeedback: string | undefined;
    const repairIssues = currentReport.issues.map((issue) =>
      canonicalizeReferenceLeafIssuePath(
        currentDeck,
        canonicalizeDirectArrayIssuePath(currentDeck, issue),
      ),
    );
    const issueValues = repairIssues.map(({ path }) => {
      const value = readPath(currentDeck, pathSegments(path));
      return { path, value: value === MISSING_PATH ? null : value };
    });
    const requiredRemovePaths = [
      ...new Set([
        ...requiredUnsupportedRemovalPaths(currentDeck, repairIssues),
        ...requiredReferenceRemovalPaths(currentDeck, repairIssues),
      ]),
    ];
    for (let patchAttempt = 1; patchAttempt <= 2; patchAttempt += 1) {
      const repairRequest = {
        task: "genesis" as const,
        userId: input.userId,
        owner: input.owner,
        system: GENESIS_SEMANTIC_REPAIR_SYSTEM,
        user: semanticRepairPrompt({
          mode: input.mode,
          decree: input.decree,
          intent: input.intent,
          invalidDeck: currentDeck,
          issues: repairIssues,
          issueValues,
          requiredRemovePaths,
          lockedPaths: input.lockedPaths,
          lorebookExcerpts: input.lorebookExcerpts,
          materialConstraints: input.materialConstraints,
          repairFeedback,
        }),
        temperature: 0.1,
        maxTokens: 8000,
        maxAttempts: 2,
        transportMaxAttempts: 2,
        allowTransportFallback: false,
        failOnTruncation: false,
        cache: { namespace: `genesis-quality:v2:${input.mode}:round-${round}:patch-${patchAttempt}` },
        maxInputBytes: GENESIS_MODEL_INPUT_MAX_BYTES,
        maxOutputBytes: GENESIS_MODEL_OUTPUT_MAX_BYTES,
      };
      const repairedRaw = await deps.repair("narrative", {
        ...repairRequest,
        schema: GenesisSemanticRepairResultSchema,
      });
      const parsedRepair = enforceRequiredRemovals(
        GenesisSemanticRepairResultSchema.parse(repairedRaw),
        requiredRemovePaths,
      );
      const boundedRepair = applySemanticRepairs(
        currentDeck,
        parsedRepair,
        repairIssues.map(({ path }) => path),
      );
      const restored = input.currentDeck === undefined
        ? boundedRepair
        : preserveLockedPaths(
          boundedRepair,
          input.currentDeck,
          input.lockedPaths ?? [],
          input.mode,
        );
      try {
        repairedDeck = deps.validate(restored, input.mode, input.materialSnapshot);
        break;
      } catch (error) {
        repairFeedback = error instanceof Error ? error.message : String(error);
        if (patchAttempt === 2) {
          const diagnostics = JSON.stringify({
            issuePaths: repairIssues.map(({ path, type }) => ({ path, type })),
            operations: parsedRepair.operations.map(({ path, action }) => ({ path, action })),
          });
          throw new GenesisSemanticRepairValidationError(`${repairFeedback}; patchDiagnostics=${diagnostics}`);
        }
      }
    }
    if (!repairedDeck) throw new Error("语义补丁未生成可校验世界");
    const nextAudit = await deps.audit(repairedDeck, auditOptions(input));
    finalReport = withMetrics(nextAudit, initialReport, true, (round + 1) as 2 | 3 | 4 | 5 | 6, startedAt);

    if (!hasBlockingIssues(nextAudit)) {
      return { deck: repairedDeck, report: finalReport };
    }
    currentDeck = repairedDeck;
    currentReport = nextAudit;
  }

  throw new GenesisSemanticGateError(finalReport!);
}
