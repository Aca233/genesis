import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  type WorldDeck,
} from "@/lib/cards/schemas";
import { completeStructured } from "@/lib/llm/structured";
import type { CompletionRequest, SlotName } from "@/lib/llm/types";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import { genesisSystem } from "@/lib/prompts/genesis";
import { semanticRepairPrompt } from "@/lib/prompts/genesis-quality";
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
  schema: typeof PantheonWorldDeckSchema | typeof CreatorWorldDeckSchema;
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

export type GenesisQualityGateDeps = {
  audit: typeof auditGenesisSemantics;
  repair: (slot: SlotName, request: SemanticRepairRequest) => Promise<unknown>;
  validate: typeof validateGenesisDeck;
};

export const defaultGenesisQualityGateDeps: GenesisQualityGateDeps = {
  audit: auditGenesisSemantics,
  repair: (slot, request) => request.schema === PantheonWorldDeckSchema
    ? completeStructured(slot, { ...request, schema: PantheonWorldDeckSchema })
    : completeStructured(slot, { ...request, schema: CreatorWorldDeckSchema }),
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

function withMetrics(
  report: GenesisSemanticAuditResult,
  initialReport: GenesisSemanticAuditResult,
  repaired: boolean,
  auditPasses: 1 | 2,
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

  await input.onStage?.("semantic_repair");
  const repairRequest = {
    task: "genesis" as const,
    userId: input.userId,
    owner: input.owner,
    system: genesisSystem(input.mode),
    user: semanticRepairPrompt({
      mode: input.mode,
      decree: input.decree,
      intent: input.intent,
      invalidDeck: input.deck,
      issues: initialReport.issues,
      lockedPaths: input.lockedPaths,
      lorebookExcerpts: input.lorebookExcerpts,
      materialConstraints: input.materialConstraints,
    }),
    temperature: 0.1,
    maxTokens: 16000,
    maxAttempts: 1,
    transportMaxAttempts: 1,
    allowTransportFallback: false,
    failOnTruncation: false,
    cache: { namespace: `genesis-quality:v1:${input.mode}` },
    maxInputBytes: GENESIS_MODEL_INPUT_MAX_BYTES,
    maxOutputBytes: GENESIS_MODEL_OUTPUT_MAX_BYTES,
  };
  const repairedRaw = input.mode === "pantheon"
    ? await deps.repair("narrative", { ...repairRequest, schema: PantheonWorldDeckSchema })
    : await deps.repair("narrative", { ...repairRequest, schema: CreatorWorldDeckSchema });

  const restored = input.currentDeck === undefined
    ? repairedRaw
    : preserveLockedPaths(
      repairedRaw,
      input.currentDeck,
      input.lockedPaths ?? [],
      input.mode,
    );
  const repairedDeck = deps.validate(restored, input.mode, input.materialSnapshot);
  const finalAudit = await deps.audit(repairedDeck, auditOptions(input));
  const finalReport = withMetrics(finalAudit, initialReport, true, 2, startedAt);

  if (hasBlockingIssues(finalAudit)) {
    throw new GenesisSemanticGateError(finalReport);
  }

  return { deck: repairedDeck, report: finalReport };
}
