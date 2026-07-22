import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { completeCreatorDeck } from "@/lib/abilities/embark.test-fixtures";
import { MajorGodEditor } from "./card-editors";


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
