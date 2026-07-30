import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GenesisIntentContract } from "@/lib/genesis/intent";
import { GenesisIntentSummary } from "./GenesisIntentSummary";

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

describe("GenesisIntentSummary", () => {
  it("以六个只读语义区块陈列冻结的神谕理解", () => {
    const html = renderToStaticMarkup(<GenesisIntentSummary intent={crossoverIntent} />);

    expect(html).toContain("神谕理解");
    expect(html).toContain("叙事中心");
    expect(html).toContain("托尼·斯塔克转生后的鲁迪乌斯");
    expect(html).toMatch(/独立.*神/);
    expect(html).toContain("禁止扩张");
    expect(html).toContain("锚点边界");
    expect(html).toContain("融合边界");
    expect(html).toContain("核心压力");
    expect(html).toContain("工程知识只能提出假设，不能直接改写世界物理规律");
  });

  it("保持 presentation-only，不提供编辑或重掷控件", () => {
    const html = renderToStaticMarkup(<GenesisIntentSummary intent={crossoverIntent} />);

    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("重掷");
  });
});
