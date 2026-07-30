import { describe, expect, it } from "vitest";
import { lintNarrativeProse } from "./index";

describe("narrative prose lint", () => {
  it("reports deterministic format and stock-expression findings", () => {
    const prose = `### 正文
空气仿佛凝固！！

钟声越过城墙，守军抬头。

钟声越过长街，潮水退去。

\`\`\`
幕后说明
\`\`\``;

    const ruleIds = lintNarrativeProse(prose).map((finding) => finding.ruleId);

    expect(ruleIds).toContain("markdown_heading");
    expect(ruleIds).toContain("stock_phrase");
    expect(ruleIds).toContain("repeated_punctuation");
    expect(ruleIds).toContain("repeated_paragraph_opening");
    expect(ruleIds).toContain("code_fence");
  });

  it("returns no findings for concise compliant prose", () => {
    expect(lintNarrativeProse("潮水退到礁石之外。守卫放下号角，回头看向仍亮着灯的塔楼。"))
      .toEqual([]);
  });
});
