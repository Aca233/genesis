import { z } from "zod";
import type { WorldDeck } from "@/lib/cards/schemas";
import { completeStructured } from "@/lib/llm/structured";
import type { CompletionRequest, SlotName } from "@/lib/llm/types";
import type { GenesisIntentContract } from "./intent";

export const GenesisSemanticIssueTypeSchema = z.enum([
  "future_identity_leak",
  "continuity_mix",
  "death_conflict",
  "causality_conflict",
  "unsupported_canon_claim",
  "premise_drift",
  "narrative_center_duplication",
  "ontology_mismatch",
  "anchor_state_leak",
  "power_shortcut",
  "unsupported_fusion_rule",
  "causal_disconnect",
  "information_leak",
]);
export type GenesisSemanticIssueType = z.infer<typeof GenesisSemanticIssueTypeSchema>;

export const GenesisSemanticIssueSchema = z.object({
  severity: z.enum(["warning", "error"]),
  path: z.string().min(1),
  type: GenesisSemanticIssueTypeSchema,
  explanation: z.string().min(1),
  evidenceRefs: z.array(z.string()).max(8),
  repairInstruction: z.string().min(1),
}).strict();
export type GenesisSemanticIssue = z.infer<typeof GenesisSemanticIssueSchema>;

export const GenesisSemanticAuditResultSchema = z.object({
  verdict: z.enum(["pass", "warnings", "errors"]),
  issues: z.array(GenesisSemanticIssueSchema).max(16),
}).strict();
export type GenesisSemanticAuditResult = z.infer<typeof GenesisSemanticAuditResultSchema>;

const GenesisQualityMetaSchema = z.object({
  initialErrorCount: z.number().int().min(0),
  initialWarningCount: z.number().int().min(0),
  repaired: z.boolean(),
  auditPasses: z.number().int().min(1).max(9),
  durationMs: z.number().int().min(0),
}).strict();

export const GenesisQualityReportSchema = GenesisSemanticAuditResultSchema.extend({
  meta: GenesisQualityMetaSchema.optional(),
}).strict();
export type GenesisQualityReport = z.infer<typeof GenesisQualityReportSchema>;

const LegacyGenesisSemanticIssueSchema = z.object({
  severity: z.enum(["warning", "error"]),
  path: z.string().min(1),
  type: GenesisSemanticIssueTypeSchema,
  explanation: z.string().min(1),
  evidenceRefs: z.array(z.string()),
}).strict();

const LegacyGenesisQualityReportSchema = z.object({
  verdict: z.enum(["pass", "warnings", "errors"]),
  issues: z.array(LegacyGenesisSemanticIssueSchema),
}).strict();

const ERROR_MINIMUM_TYPES = new Set<GenesisSemanticIssueType>([
  "premise_drift",
  "narrative_center_duplication",
  "ontology_mismatch",
  "unsupported_canon_claim",
  "anchor_state_leak",
  "power_shortcut",
  "unsupported_fusion_rule",
  "future_identity_leak",
  "death_conflict",
  "causality_conflict",
]);

const LEGACY_REPAIR_INSTRUCTION = "按原报告说明检查并修复该字段";

function normalizeIssue(issue: GenesisSemanticIssue): GenesisSemanticIssue {
  return ERROR_MINIMUM_TYPES.has(issue.type)
    ? { ...issue, severity: "error" }
    : issue;
}

function verdictForIssues(issues: GenesisSemanticIssue[]): GenesisSemanticAuditResult["verdict"] {
  if (issues.some(({ severity }) => severity === "error")) return "errors";
  return issues.length > 0 ? "warnings" : "pass";
}

function normalizeReport(report: GenesisQualityReport): GenesisQualityReport {
  const issues = report.issues.map(normalizeIssue);
  return {
    verdict: verdictForIssues(issues),
    issues,
    ...(report.meta === undefined ? {} : { meta: report.meta }),
  };
}

function normalizeLegacyIssues(
  issues: z.infer<typeof LegacyGenesisSemanticIssueSchema>[],
): GenesisSemanticIssue[] {
  const normalized = issues.map((item) => normalizeIssue({
    ...item,
    evidenceRefs: item.evidenceRefs.slice(0, 8),
    repairInstruction: LEGACY_REPAIR_INSTRUCTION,
  }));
  return [
    ...normalized.filter(({ severity }) => severity === "error"),
    ...normalized.filter(({ severity }) => severity === "warning"),
  ].slice(0, 16);
}

export function parseGenesisQualityReport(value: unknown): GenesisQualityReport | null {
  const current = GenesisQualityReportSchema.safeParse(value);
  if (current.success) return normalizeReport(current.data);

  const legacy = LegacyGenesisQualityReportSchema.safeParse(value);
  if (!legacy.success) return null;

  return normalizeReport({
    verdict: legacy.data.verdict,
    issues: normalizeLegacyIssues(legacy.data.issues),
  });
}

export function hasBlockingIssues(
  report: Pick<GenesisSemanticAuditResult, "issues">,
): boolean {
  return report.issues.some((item) => normalizeIssue(item).severity === "error");
}

const auditJsonSchema = JSON.stringify(z.toJSONSchema(GenesisSemanticAuditResultSchema), null, 2);

export const GENESIS_SEMANTIC_AUDIT_SYSTEM = `You are the semantic quality auditor for a god-roleplay world generator. Compare the complete world deck against all supplied authority layers: the creator decree, the FROZEN GENESIS INTENT CONTRACT, the temporal anchor, field-level provenance, and the lorebook excerpts.

Audit for exactly these issue types:
- premise_drift: the deck changes or dilutes an explicit premise.
- narrative_center_duplication: another entity duplicates or replaces the frozen narrative center.
- ontology_mismatch: a character, title, faction, place, or divinity is put in the wrong ontological category.
- anchor_state_leak: the deck reveals a relationship, identity, location, resource, institution, or capability unavailable at the starting anchor.
- power_shortcut: knowledge or premise is converted into finished power, equipment, resources, or mastery without an earned causal path.
- unsupported_fusion_rule: a crossover interaction is asserted as settled fact beyond the frozen fusion boundaries.
- causal_disconnect: a conflict, faction, place, or opening objective is not causally grounded in the premise, starting state, or core pressures.
- information_leak: an entity knows information unavailable from its position at the anchor.
- future_identity_leak, continuity_mix, death_conflict, causality_conflict, unsupported_canon_claim: prose-level source continuity and temporal violations.

Rules:
1. Audit the full deck and report at most 16 significant issues. Never rewrite the deck.
2. For IP-derived worlds, check source claims against the declared temporal anchor, provenance, and lorebook. Player overrides are deliberate changes only where provenance explicitly marks them as such.
3. For original worlds, skip only canon-specific checks; still audit premise drift, narrative-center duplication, ontology, anchor state, power shortcuts, fusion boundaries, causal connection, and information access. Never skip the whole audit.
4. Treat the frozen intent contract as authoritative. Uncertain unsupported detail must be omitted or generalized, not invented.
5. path is the exact dot-path of the offending deck field. evidenceRefs contains at most eight stable refs or lore headings.
6. explanation and repairInstruction are concise Chinese. repairInstruction must identify a bounded correction without inventing replacement lore.
7. Use severity "error" for premise_drift, narrative_center_duplication, ontology_mismatch, unsupported_canon_claim, anchor_state_leak, power_shortcut, unsupported_fusion_rule, future_identity_leak, death_conflict, and causality_conflict. causal_disconnect, continuity_mix, and information_leak may remain "warning" only when genuinely low impact.
8. verdict must reflect the issue list: errors when any error exists, warnings when only warnings exist, otherwise pass.

Output ONLY a JSON object matching this JSON Schema. No commentary or markdown fence.

${auditJsonSchema}`;

export type SemanticAuditPromptOptions = {
  decree: string;
  intent: GenesisIntentContract;
  lorebookExcerpts?: string;
};

export function semanticAuditUserPrompt(
  deck: WorldDeck,
  opts: SemanticAuditPromptOptions,
): string {
  const sections = [
    "Audit this generated world deck against every supplied authority layer and return the JSON report.",
    `Creator decree:\n${opts.decree}`,
    `FROZEN GENESIS INTENT CONTRACT:\n${JSON.stringify(opts.intent)}`,
    `World deck JSON (compact):\n${JSON.stringify(deck)}`,
  ];
  if (opts.lorebookExcerpts !== undefined && opts.lorebookExcerpts.trim().length > 0) {
    sections.push(`Lorebook excerpts (reference evidence):\n${opts.lorebookExcerpts}`);
  }
  return sections.join("\n\n");
}

export type SemanticAuditDeps = {
  complete: (
    slot: SlotName,
    opts: {
      task: "extract";
      userId: string;
      owner?: CompletionRequest["owner"];
      system: string;
      user: string;
      schema: z.ZodType<GenesisSemanticAuditResult>;
      temperature: number;
      maxTokens: number;
      maxAttempts: number;
      transportMaxAttempts: number;
      allowTransportFallback: boolean;
      failOnTruncation: boolean;
    },
  ) => Promise<unknown>;
};

export class GenesisSemanticAuditError extends Error {
  override name = "GenesisSemanticAuditError";

  constructor(cause: unknown) {
    super("创世语义审计失败，请稍后重试", { cause });
  }
}

const SEMANTIC_AUDIT_ATTEMPTS = 2;

export async function auditGenesisSemantics(
  deck: WorldDeck,
  opts: {
    userId: string;
    decree: string;
    intent: GenesisIntentContract;
    lorebookExcerpts?: string;
    slot?: SlotName;
    owner?: CompletionRequest["owner"];
  },
  deps: SemanticAuditDeps = { complete: completeStructured },
): Promise<GenesisSemanticAuditResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SEMANTIC_AUDIT_ATTEMPTS; attempt += 1) {
    try {
      const result = await deps.complete(opts.slot ?? "backstage", {
        task: "extract",
        userId: opts.userId,
        owner: opts.owner,
        system: GENESIS_SEMANTIC_AUDIT_SYSTEM,
        user: semanticAuditUserPrompt(deck, opts),
        schema: GenesisSemanticAuditResultSchema,
        temperature: 0.1,
        maxTokens: 8000,
        maxAttempts: 1,
        transportMaxAttempts: 2,
        allowTransportFallback: false,
        failOnTruncation: false,
      });
      const parsed = GenesisSemanticAuditResultSchema.parse(result);
      const issues = parsed.issues.map(normalizeIssue);
      return {
        verdict: verdictForIssues(issues),
        issues,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new GenesisSemanticAuditError(lastError);
}
