import { describe, expect, it, vi } from "vitest";
import {
  auditTemporalSemantics as auditTemporalSemanticsImpl,
  temporalAuditUserPrompt,
  TEMPORAL_AUDIT_SYSTEM,
  TemporalAuditResultSchema,
  type TemporalAuditResult,
} from "./temporal-audit";

function auditTemporalSemantics(
  deck: Parameters<typeof auditTemporalSemanticsImpl>[0],
  opts: Omit<Parameters<typeof auditTemporalSemanticsImpl>[1], "userId"> = {},
  deps?: Parameters<typeof auditTemporalSemanticsImpl>[2],
) {
  return auditTemporalSemanticsImpl(
    deck,
    { userId: "test-user", ...opts },
    deps,
  );
}

function ipDeck(basis: "single_ip" | "multi_ip" = "single_ip") {
  return {
    worldName: "测试之界",
    temporalAnchor: {
      source: { basis },
      anchor: { canonCutoff: "原著第一卷开幕之前" },
      anchorOrdinal: 0,
    },
    majorCharacters: [{ ref: "char:hero", name: "英雄", background: "尚未拔剑的学徒" }],
  };
}

function warningIssue(path = "majorCharacters.0.background") {
  return {
    severity: "warning" as const,
    path,
    type: "future_identity_leak" as const,
    explanation: "把截止点之后才获得的圣剑写成了现状",
    evidenceRefs: ["char:hero"],
  };
}

describe("TemporalAuditResultSchema（§10.4 输出契约）", () => {
  it("接受 pass 空清单与 warnings 清单", () => {
    expect(TemporalAuditResultSchema.safeParse({ verdict: "pass", issues: [] }).success).toBe(true);
    expect(
      TemporalAuditResultSchema.safeParse({ verdict: "warnings", issues: [warningIssue()] }).success,
    ).toBe(true);
  });

  it("severity 只允许 warning，type 只允许五种闭合枚举", () => {
    expect(
      TemporalAuditResultSchema.safeParse({
        verdict: "warnings",
        issues: [{ ...warningIssue(), severity: "error" }],
      }).success,
    ).toBe(false);
    expect(
      TemporalAuditResultSchema.safeParse({
        verdict: "warnings",
        issues: [{ ...warningIssue(), type: "made_up_type" }],
      }).success,
    ).toBe(false);
  });

  it("strict：多余字段被拒（结构化字段名一经落地不可变）", () => {
    expect(
      TemporalAuditResultSchema.safeParse({ verdict: "pass", issues: [], extra: 1 }).success,
    ).toBe(false);
    expect(
      TemporalAuditResultSchema.safeParse({
        verdict: "warnings",
        issues: [{ ...warningIssue(), fix: "改掉" }],
      }).success,
    ).toBe(false);
  });
});

describe("auditTemporalSemantics（§10.4 报告型 AI 语义审计）", () => {
  it("无 temporalAnchor 的旧卡组：跳过且不调用模型", async () => {
    const complete = vi.fn();
    await expect(
      auditTemporalSemantics({ worldName: "旧界" } as never, {}, { complete }),
    ).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("basis=original 的原创世界：跳过且不调用模型（无正史可泄漏）", async () => {
    const complete = vi.fn();
    const deck = {
      ...ipDeck(),
      temporalAnchor: { source: { basis: "original" }, anchor: { canonCutoff: null }, anchorOrdinal: 0 },
    };
    await expect(auditTemporalSemantics(deck, {}, { complete })).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("IP 世界：一次 backstage/extract 调用，输入为全卡组紧凑 JSON", async () => {
    const report: TemporalAuditResult = { verdict: "warnings", issues: [warningIssue()] };
    const complete = vi.fn(async () => report);
    const deck = ipDeck("multi_ip");

    await expect(auditTemporalSemantics(deck, {}, { complete })).resolves.toEqual(report);

    expect(complete).toHaveBeenCalledTimes(1);
    const [slot, opts] = complete.mock.calls[0]! as unknown as [string, {
      task: string; system: string; user: string; schema: unknown;
    }];
    expect(slot).toBe("backstage");
    expect(opts.task).toBe("extract");
    expect(opts.system).toBe(TEMPORAL_AUDIT_SYSTEM);
    expect(opts.schema).toBe(TemporalAuditResultSchema);
    expect(opts.user).toContain(JSON.stringify(deck));
    expect(opts.user).not.toContain("lore excerpts");
  });

  it("提供资料索引摘录时并入审计输入", async () => {
    const complete = vi.fn(async (
      ...args: [string, { user: string }]
    ) => {
      void args;
      return { verdict: "pass", issues: [] } as TemporalAuditResult;
    });
    await auditTemporalSemantics(ipDeck(), { lorebookExcerpts: "[timeline|编年史]\n主线大事记" }, { complete });
    const opts = complete.mock.calls[0]![1] as { user: string };
    expect(opts.user).toContain("主线大事记");
    expect(opts.user).toBe(temporalAuditUserPrompt(ipDeck(), "[timeline|编年史]\n主线大事记"));
  });

  it("verdict 由 issues 确定性归一：自报 pass 却带 issue → warnings；自报 warnings 空清单 → pass", async () => {
    const inconsistentPass = vi.fn(async () => ({
      verdict: "pass",
      issues: [warningIssue()],
    } as TemporalAuditResult));
    await expect(auditTemporalSemantics(ipDeck(), {}, { complete: inconsistentPass }))
      .resolves.toEqual({ verdict: "warnings", issues: [warningIssue()] });

    const inconsistentWarnings = vi.fn(async () => ({
      verdict: "warnings",
      issues: [],
    } as TemporalAuditResult));
    await expect(auditTemporalSemantics(ipDeck(), {}, { complete: inconsistentWarnings }))
      .resolves.toEqual({ verdict: "pass", issues: [] });
  });

  it("审计调用自身失败 → null，静默跳过（报告型：绝不阻断创世）", async () => {
    const complete = vi.fn(async () => {
      throw new Error("结构化输出在 3 次尝试后仍未通过校验");
    });
    await expect(auditTemporalSemantics(ipDeck(), {}, { complete })).resolves.toBeNull();
  });

  it("系统提示词内嵌输出 JSON Schema 且声明只报告不修改", () => {
    expect(TEMPORAL_AUDIT_SYSTEM).toContain("REPORT-ONLY");
    expect(TEMPORAL_AUDIT_SYSTEM).toContain("future_identity_leak");
    expect(TEMPORAL_AUDIT_SYSTEM).toContain("unsupported_canon_claim");
    expect(TEMPORAL_AUDIT_SYSTEM).toContain('"verdict"');
  });
});
