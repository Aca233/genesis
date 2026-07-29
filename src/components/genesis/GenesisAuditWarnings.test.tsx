import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GenesisQualityReport } from "@/lib/genesis/semantic-audit";
import { GenesisAuditWarnings } from "./GenesisAuditWarnings";

const warningReport: GenesisQualityReport = {
  verdict: "warnings",
  issues: [{
    severity: "warning",
    path: "epochConflict.backgroundConflicts.0",
    type: "causal_disconnect",
    explanation: "背景税务冲突与核心转生压力的联系较弱。",
    evidenceRefs: ["epochConflict.backgroundConflicts.0"],
    repairInstruction: "保留为低影响背景线索。",
  }],
};

describe("GenesisAuditWarnings", () => {
  it("仅陈列 warning 的解释与修复提示", () => {
    const mixedReport: GenesisQualityReport = {
      verdict: "errors",
      issues: [
        ...warningReport.issues,
        {
          severity: "error",
          path: "majorGods.0",
          type: "narrative_center_duplication",
          explanation: "不得显示的阻断错误。",
          evidenceRefs: ["majorGods.0"],
          repairInstruction: "删除重复叙事中心。",
        },
      ],
    };

    const html = renderToStaticMarkup(<GenesisAuditWarnings report={mixedReport} />);

    expect(html).toContain("审计提醒");
    expect(html).toContain("背景税务冲突与核心转生压力的联系较弱。");
    expect(html).toContain("保留为低影响背景线索。");
    expect(html).not.toContain("不得显示的阻断错误。");
    expect(html).not.toContain("删除重复叙事中心。");
  });

  it("pass、null 或仅含 error 时不渲染", () => {
    const passReport: GenesisQualityReport = { verdict: "pass", issues: [] };
    const errorReport: GenesisQualityReport = {
      verdict: "errors",
      issues: [{
        severity: "error",
        path: "majorGods.0",
        type: "narrative_center_duplication",
        explanation: "阻断错误。",
        evidenceRefs: ["majorGods.0"],
        repairInstruction: "删除重复叙事中心。",
      }],
    };

    expect(renderToStaticMarkup(<GenesisAuditWarnings report={passReport} />)).toBe("");
    expect(renderToStaticMarkup(<GenesisAuditWarnings report={null} />)).toBe("");
    expect(renderToStaticMarkup(<GenesisAuditWarnings report={errorReport} />)).toBe("");
  });

  it("失败进度页可显式陈列 error 的路径、解释与修复建议", () => {
    const errorReport: GenesisQualityReport = {
      verdict: "errors",
      issues: [{
        severity: "error",
        path: "relationsAtAnchor[3].memorial",
        type: "death_conflict",
        explanation: "存活人物被错误标记为追念关系。",
        evidenceRefs: ["char_alive"],
        repairInstruction: "移除 memorial 标记。",
      }],
    };

    const html = renderToStaticMarkup(
      <GenesisAuditWarnings report={errorReport} severity="error" />,
    );

    expect(html).toContain("阻断详情");
    expect(html).toContain("存活人物被错误标记为追念关系。");
    expect(html).toContain("relationsAtAnchor[3].memorial");
    expect(html).toContain("移除 memorial 标记。");
  });
});
