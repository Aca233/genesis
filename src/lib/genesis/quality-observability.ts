import type {
  GenesisSemanticIssue,
  GenesisSemanticIssueType,
} from "./semantic-audit";

type GenesisIssueCounts = Partial<Record<GenesisSemanticIssueType, number>>;

export type GenesisQualityEvent =
  | { kind: "intent_generated"; taskId: string; durationMs: number }
  | { kind: "intent_failed"; taskId: string; durationMs: number }
  | {
      kind: "semantic_gate_completed";
      taskId: string;
      initialErrorCount: number;
      initialWarningCount: number;
      repaired: boolean;
      auditPasses: number;
      durationMs: number;
      issueCounts: GenesisIssueCounts;
    }
  | {
      kind: "semantic_gate_rejected";
      taskId: string;
      errorCount: number;
      issueCounts: GenesisIssueCounts;
    };

export function countGenesisSemanticIssues(
  issues: ReadonlyArray<Pick<GenesisSemanticIssue, "type">>,
): GenesisIssueCounts {
  return issues.reduce<GenesisIssueCounts>((counts, issue) => {
    counts[issue.type] = (counts[issue.type] ?? 0) + 1;
    return counts;
  }, {});
}

export function recordGenesisQualityEvent(event: GenesisQualityEvent): void {
  console.info("genesis_quality", event);
}
