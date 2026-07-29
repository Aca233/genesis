import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LorePanel } from "./LorePanel";
import type { WorldInfo } from "./types";

describe("LorePanel fusion axioms", () => {
  it("renders only the canonical established, open, and limited groups", () => {
    const world = {
      cosmology: null,
      fusionAxiom: {
        sourceIps: ["无职转生", "钢铁侠"],
        establishedRules: ["转生只保留人格、记忆与工程思维"],
        openQuestions: ["魔力能否驱动机械仍待验证"],
        hardLimits: ["开局不存在装甲、工坊或智能助手"],
        conflictRule: "以锚点事实和原作规则为准",
      },
      epochConflict: null,
      styleCard: null,
    } as unknown as WorldInfo;

    const html = renderToStaticMarkup(<LorePanel world={world} />);

    expect(html).toContain("已确立规则");
    expect(html).toContain("转生只保留人格、记忆与工程思维");
    expect(html).toContain("待验证问题");
    expect(html).toContain("魔力能否驱动机械仍待验证");
    expect(html).toContain("硬性限制");
    expect(html).toContain("开局不存在装甲、工坊或智能助手");
    expect(html).toContain("冲突裁决");
    expect(html).not.toContain("力量对标");
  });
});
