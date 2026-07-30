import { describe, expect, it, vi } from "vitest";
import { isTransientLlmError } from "@/lib/llm/gateway";
import type { WorldDeck } from "@/lib/cards/schemas";
import type { GenesisIntentContract } from "./intent";
import {
  GENESIS_SEMANTIC_AUDIT_SYSTEM,
  GenesisQualityReportSchema,
  GenesisSemanticAuditError,
  GenesisSemanticAuditResultSchema,
  GenesisSemanticIssueSchema,
  GenesisSemanticIssueTypeSchema,
  auditGenesisSemantics,
  hasBlockingIssues,
  parseGenesisQualityReport,
  semanticAuditUserPrompt,
  type GenesisSemanticAuditResult,
  type GenesisSemanticIssue,
  type SemanticAuditDeps,
} from "./semantic-audit";

const crossoverIntent: GenesisIntentContract = {
  sourceBasis: "multi_ip",
  sourceIps: ["无职转生", "钢铁侠"],
  explicitPremise: ["鲁迪乌斯由托尼·斯塔克转生"],
  narrativeCenter: {
    identity: "托尼·斯塔克转生后的鲁迪乌斯",
    role: "转生主角",
    startState: "刚出生，仅保留人格、记忆与工程思维",
  },
  playerRole: {
    type: "independent_god",
    narrativeFunction: "limited_intervener",
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: ["独立贾维斯神格", "开局已有钢铁装甲"],
  factsAtAnchor: ["鲁迪乌斯刚出生"],
  futureOnly: ["建立工坊", "验证魔力能否驱动机械"],
  fusionBoundaries: ["工程知识只能提出假设，不能直接改写世界物理规律"],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["婴儿身体限制", "隐瞒成年意识"],
};

const originalIntent: GenesisIntentContract = {
  ...crossoverIntent,
  sourceBasis: "original",
  sourceIps: [],
  explicitPremise: ["一名失忆钟表匠在浮空城寻找时间失窃的原因"],
  narrativeCenter: {
    identity: "失忆钟表匠",
    role: "调查者",
    startState: "刚抵达浮空城",
  },
  forbiddenExpansions: [],
  factsAtAnchor: ["浮空城的钟声已经停摆"],
  futureOnly: ["查明时间失窃的真相"],
  fusionBoundaries: [],
  corePressures: ["记忆缺失", "城市逐步失去时间"],
};

const badDeck = {
  mode: "pantheon",
  worldName: "转生钢铁魔导界",
  temporalAnchor: {
    source: { basis: "multi_ip" },
    anchor: { canonCutoff: "鲁迪乌斯出生" },
  },
  majorGods: [{ name: "独立贾维斯神格", brief: "方舟智脑已独立成神" }],
  minorGods: [{ name: "水神雷妲", brief: "水神流现任宗师" }],
  places: [{ name: "地下秘密实验工坊", brief: "新生儿的装甲基地" }],
} as unknown as WorldDeck;

const originalDeck = {
  mode: "pantheon",
  worldName: "停钟浮空城",
  temporalAnchor: {
    source: { basis: "original" },
    anchor: { canonCutoff: null },
  },
  majorCharacters: [{ name: "钟表匠", background: "城中唯一能让时间恢复的人" }],
} as unknown as WorldDeck;

function issue(
  type: GenesisSemanticIssue["type"] = "causal_disconnect",
  severity: GenesisSemanticIssue["severity"] = "warning",
): GenesisSemanticIssue {
  return {
    severity,
    path: "mainConflict",
    type,
    explanation: "主冲突与创世前提缺少直接因果关系",
    evidenceRefs: [],
    repairInstruction: "让冲突直接来自主角起始状态",
  };
}

const auditInput = {
  userId: "user-1",
  decree: "无职转生，但是鲁迪是托尼斯塔克转生",
  intent: crossoverIntent,
  lorebookExcerpts: "[时间线] 鲁迪乌斯出生时仍是婴儿",
  owner: {
    kind: "genesis_job",
    id: "job-1",
    genesisTaskId: "task-1",
    genesisJobId: "job-1",
    leaseEpoch: 3,
  },
};

describe("semantic audit schemas and persisted compatibility", () => {
  it("exposes every closed semantic issue type", () => {
    expect(GenesisSemanticIssueTypeSchema.options).toEqual(expect.arrayContaining([
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
    ]));
  });

  it("keeps model output separate from persisted quality metrics", () => {
    expect(GenesisSemanticIssueSchema.safeParse(issue()).success).toBe(true);
    expect(GenesisSemanticAuditResultSchema.safeParse({
      verdict: "pass",
      issues: [],
      meta: {
        initialErrorCount: 0,
        initialWarningCount: 0,
        repaired: false,
        auditPasses: 1,
        durationMs: 1,
      },
    }).success).toBe(false);
    expect(GenesisQualityReportSchema.safeParse({
      verdict: "pass",
      issues: [],
      meta: {
        initialErrorCount: 0,
        initialWarningCount: 0,
        repaired: false,
        auditPasses: 1,
        durationMs: 1,
      },
    }).success).toBe(true);
  });

  it("accepts the third audit pass produced by two bounded repair rounds", () => {
    expect(GenesisQualityReportSchema.safeParse({
      verdict: "pass",
      issues: [],
      meta: {
        initialErrorCount: 2,
        initialWarningCount: 0,
        repaired: true,
        auditPasses: 3,
        durationMs: 3,
      },
    }).success).toBe(true);
  });

  it("upgrades legacy warnings with repair instructions and normalized blocking severity", () => {
    const parsed = parseGenesisQualityReport({
      verdict: "warnings",
      issues: [{
        severity: "warning",
        path: "majorCharacters.0.background",
        type: "future_identity_leak",
        explanation: "旧报告",
        evidenceRefs: [],
      }],
    });

    expect(parsed).toEqual({
      verdict: "errors",
      issues: [{
        severity: "error",
        path: "majorCharacters.0.background",
        type: "future_identity_leak",
        explanation: "旧报告",
        evidenceRefs: [],
        repairInstruction: "按原报告说明检查并修复该字段",
      }],
    });
    expect(hasBlockingIssues(parsed!)).toBe(true);
  });

  it("accepts unbounded TemporalAuditResult arrays and deterministically trims the new report", () => {
    const evidenceRefs = Array.from({ length: 10 }, (_, index) => `ref-${index}`);
    const issues = Array.from({ length: 17 }, (_, index) => ({
      severity: "warning" as const,
      path: `majorCharacters.${index}.background`,
      type: "future_identity_leak" as const,
      explanation: `旧报告问题 ${index}`,
      evidenceRefs,
    }));

    const parsed = parseGenesisQualityReport({ verdict: "warnings", issues });

    expect(parsed?.issues).toHaveLength(16);
    expect(parsed?.issues[0]?.evidenceRefs).toEqual(evidenceRefs.slice(0, 8));
    expect(parsed?.issues.every((item) => item.evidenceRefs.length <= 8)).toBe(true);
    expect(parsed?.verdict).toBe("errors");
  });

  it("keeps an explicit legacy error inside the trimmed issue list", () => {
    const warnings = Array.from({ length: 17 }, (_, index) => ({
      severity: "warning" as const,
      path: `places.${index}.brief`,
      type: "continuity_mix" as const,
      explanation: `低影响旧警告 ${index}`,
      evidenceRefs: [],
    }));
    const blocking = {
      severity: "error" as const,
      path: "mainConflict",
      type: "information_leak" as const,
      explanation: "旧报告已明确标记为错误",
      evidenceRefs: [],
    };

    const parsed = parseGenesisQualityReport({
      verdict: "pass",
      issues: [...warnings, blocking],
    });

    expect(parsed?.issues).toHaveLength(16);
    expect(parsed?.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      path: "mainConflict",
    }));
    expect(parsed?.verdict).toBe("errors");
  });

  it("returns null for malformed historical JSON", () => {
    expect(parseGenesisQualityReport({ verdict: "warnings", issues: "broken" })).toBeNull();
    expect(parseGenesisQualityReport({
      verdict: "warnings",
      issues: [{
        severity: "warning",
        path: "majorCharacters.0.background",
        type: "unknown_issue",
        explanation: "脏数据",
        evidenceRefs: [],
      }],
    })).toBeNull();
  });

  it("derives verdict only from normalized issues and enforces every minimum severity", () => {
    const forcedErrorTypes: GenesisSemanticIssue["type"][] = [
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
    ];
    const parsed = parseGenesisQualityReport({
      verdict: "pass",
      issues: forcedErrorTypes.map((type) => issue(type, "warning")),
    });

    expect(parsed?.verdict).toBe("errors");
    expect(parsed?.issues.every(({ severity }) => severity === "error")).toBe(true);

    expect(parseGenesisQualityReport({
      verdict: "errors",
      issues: [
        issue("causal_disconnect", "warning"),
        issue("continuity_mix", "warning"),
        issue("information_leak", "warning"),
      ],
    })?.verdict).toBe("warnings");
    expect(parseGenesisQualityReport({ verdict: "errors", issues: [] })?.verdict).toBe("pass");
  });
});

describe("semantic audit prompt", () => {
  it("includes malformed crossover symptoms and the frozen intent contract", () => {
    const prompt = semanticAuditUserPrompt(badDeck, {
      decree: auditInput.decree,
      intent: crossoverIntent,
    });

    expect(prompt).toContain("独立贾维斯神格");
    expect(prompt).toContain("水神雷妲");
    expect(prompt).toContain("地下秘密实验工坊");
    expect(prompt).toContain("FROZEN GENESIS INTENT CONTRACT");
    expect(GENESIS_SEMANTIC_AUDIT_SYSTEM).toContain("temporal anchor");
    expect(GENESIS_SEMANTIC_AUDIT_SYSTEM).toContain("provenance");
    expect(GENESIS_SEMANTIC_AUDIT_SYSTEM).toContain("lorebook");
  });
});

describe("auditGenesisSemantics", () => {
  it("forwards bounded structured-completion options and normalizes the model report", async () => {
    const complete = vi.fn<SemanticAuditDeps["complete"]>(async () => ({
      verdict: "pass",
      issues: [issue("unsupported_canon_claim", "warning")],
    }));

    await expect(auditGenesisSemantics(badDeck, auditInput, { complete })).resolves.toEqual({
      verdict: "errors",
      issues: [issue("unsupported_canon_claim", "error")],
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("backstage", expect.objectContaining({
      task: "extract",
      userId: "user-1",
      owner: auditInput.owner,
      schema: GenesisSemanticAuditResultSchema,
      temperature: 0.1,
      maxTokens: 8000,
      maxAttempts: 2,
      transportMaxAttempts: 2,
      allowTransportFallback: true,
      failOnTruncation: true,
    }));
    expect(complete.mock.calls[0]![1].user).toContain("鲁迪乌斯出生时仍是婴儿");
  });

  it("uses at most two outer attempts", async () => {
    const report: GenesisSemanticAuditResult = { verdict: "pass", issues: [] };
    const complete = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 503: upstream overloaded"))
      .mockResolvedValueOnce(report);

    await expect(auditGenesisSemantics(badDeck, auditInput, { complete })).resolves.toEqual(report);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls.length).toBeLessThanOrEqual(2);
    expect(complete.mock.calls.every(([, options]) => options.failOnTruncation === true)).toBe(true);
  });

  it("audits original worlds while excluding only canon-specific checks", async () => {
    const complete = vi.fn<SemanticAuditDeps["complete"]>(async () => ({
      verdict: "warnings" as const,
      issues: [issue("causal_disconnect")],
    }));

    await expect(auditGenesisSemantics(originalDeck, {
      ...auditInput,
      decree: "失忆钟表匠调查浮空城时间失窃",
      intent: originalIntent,
    }, { complete })).resolves.toEqual({
      verdict: "warnings",
      issues: [issue("causal_disconnect")],
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![1].user).toContain("original");
    expect(complete.mock.calls[0]![1].system).toContain("skip only canon-specific checks");
  });

  it("throws a safe non-transient domain error with the final cause after exhaustion", async () => {
    const firstError = new Error("HTTP 503: first failure");
    const finalError = new Error("HTTP 503: second failure");
    const complete = vi.fn()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(finalError);

    let caught: unknown;
    try {
      await auditGenesisSemantics(badDeck, auditInput, { complete });
    } catch (error) {
      caught = error;
    }

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls.length).toBeLessThanOrEqual(2);
    expect(caught).toBeInstanceOf(GenesisSemanticAuditError);
    expect(caught).toMatchObject({
      message: "创世语义审计失败，请稍后重试",
      cause: finalError,
    });
    expect(isTransientLlmError(caught)).toBe(false);
  });
});
