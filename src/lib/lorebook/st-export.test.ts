import { describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { compileDeckToEntries } from "./st-export";

describe("compileDeckToEntries fusion axioms", () => {
  it("exports every canonical fusion group without reading legacy keys", () => {
    const deck = PantheonWorldDeckSchema.parse({
      ...completeDeck(),
      fusionAxiom: {
        sourceIps: ["无职转生", "钢铁侠"],
        establishedRules: ["转生只保留人格、记忆与工程思维"],
        openQuestions: ["魔力能否驱动机械仍待验证"],
        hardLimits: ["开局不存在装甲、工坊或智能助手"],
        conflictRule: "以锚点事实和原作规则为准",
      },
    });

    const fusionEntry = compileDeckToEntries(deck).find((entry) =>
      entry.comment === "融合公理"
    );

    expect(fusionEntry?.content).toContain("【已确立规则】");
    expect(fusionEntry?.content).toContain("转生只保留人格、记忆与工程思维");
    expect(fusionEntry?.content).toContain("【待验证问题】");
    expect(fusionEntry?.content).toContain("魔力能否驱动机械仍待验证");
    expect(fusionEntry?.content).toContain("【硬性限制】");
    expect(fusionEntry?.content).toContain("开局不存在装甲、工坊或智能助手");
    expect(fusionEntry?.content).toContain("【冲突裁决】以锚点事实和原作规则为准");
    expect(fusionEntry?.content).not.toContain("力量对标");
  });
});
