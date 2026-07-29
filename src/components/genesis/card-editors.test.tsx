import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { FusionAxiomEditor, MajorGodEditor } from "./card-editors";


describe("Creator MajorGodEditor", () => {
  it("编辑世界内关系且不展示或读取玩家关系字段", () => {
    const html = renderToStaticMarkup(
      <MajorGodEditor
        deck={completeCreatorDeck()}
        index={0}
        lockedPaths={[]}
        onEdit={vi.fn()}
        agendaRevealed
        onRevealAgenda={vi.fn()}
      />,
    );
    expect(html).toContain("与世界内诸神的关系");
    expect(html).toContain("世界内诸神竞争");
    expect(html).not.toContain("与玩家神");
    expect(html).not.toContain("对玩家神");
    expect(html).not.toContain("initialRelationToPlayer");
    expect(html).not.toContain("stanceToPlayer");
    expect(html).toContain('name="majorGods.0.relations.0.targetGodRef"');
    expect(html).toContain('name="majorGods.0.relations.0.label"');
    expect(html).toContain('name="majorGods.0.relations.0.note"');
  });
});

describe("FusionAxiomEditor", () => {
  it("编辑已确立规则、待验证问题与硬性限制，不再暴露旧字段", () => {
    const deck = {
      ...completeDeck(),
      fusionAxiom: {
        sourceIps: ["无职转生", "钢铁侠"],
        establishedRules: ["转生保留人格与记忆"],
        openQuestions: ["魔力能否驱动机械仍待验证"],
        hardLimits: ["开局没有装甲、工坊或助手"],
        conflictRule: "以锚点事实和原作规则为准",
      },
    };
    const html = renderToStaticMarkup(
      <FusionAxiomEditor deck={deck} lockedPaths={[]} onEdit={vi.fn()} />,
    );

    expect(html).toContain("已确立规则");
    expect(html).toContain("待验证问题");
    expect(html).toContain("硬性限制");
    expect(html).toContain("转生保留人格与记忆");
    expect(html).toContain("魔力能否驱动机械仍待验证");
    expect(html).toContain("开局没有装甲、工坊或助手");
    expect(html).not.toContain("fusionAxiom.axioms");
    expect(html).not.toContain("fusionAxiom.powerMapping");
  });
});
