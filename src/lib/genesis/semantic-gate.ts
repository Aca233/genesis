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
  auditPasses: 1 | 2 | 3,
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
  for (const operation of repair.operations) {
    if (!allowedPaths.has(operation.path)) continue;
    const segments = pathSegments(operation.path);
    if (segments.length === 0) continue;
    writePath(
      bounded,
      segments,
      operation.action === "remove" ? MISSING_PATH : JSON.parse(operation.valueJson),
    );
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

  for (let round = 1; round <= 2; round += 1) {
    await input.onStage?.("semantic_repair");
    let repairedDeck: WorldDeck | null = null;
    let repairFeedback: string | undefined;
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
          issues: currentReport.issues,
          lockedPaths: input.lockedPaths,
          lorebookExcerpts: input.lorebookExcerpts,
          materialConstraints: input.materialConstraints,
          repairFeedback,
        }),
        temperature: 0.1,
        maxTokens: 8000,
        maxAttempts: 2,
        transportMaxAttempts: 1,
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
      const boundedRepair = applySemanticRepairs(
        currentDeck,
        GenesisSemanticRepairResultSchema.parse(repairedRaw),
        currentReport.issues.map(({ path }) => path),
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
        if (patchAttempt === 2) throw new GenesisSemanticRepairValidationError(repairFeedback);
      }
    }
    if (!repairedDeck) throw new Error("语义补丁未生成可校验世界");
    const nextAudit = await deps.audit(repairedDeck, auditOptions(input));
    finalReport = withMetrics(nextAudit, initialReport, true, (round + 1) as 2 | 3, startedAt);

    if (!hasBlockingIssues(nextAudit)) {
      return { deck: repairedDeck, report: finalReport };
    }
    currentDeck = repairedDeck;
    currentReport = nextAudit;
  }

  throw new GenesisSemanticGateError(finalReport!);
}
