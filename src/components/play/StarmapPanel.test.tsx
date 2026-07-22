import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StarmapPanel, godRelationsForDetail } from "./StarmapPanel";
import type { GodRow } from "./types";

const god = (input: Partial<GodRow> & Pick<GodRow, "id" | "name">): GodRow => ({
  tier: "major",
  isPlayer: false,
  rank: "exalted",
  domains: [],
  persona: null,
  voice: null,
  faithScope: null,
  relations: null,
  agenda: null,
  agendaRevealed: false,
  abilities: [],
  ...input,
});

describe("Creator starmap relations", () => {
  const sun = god({
    id: "god-sun",
    name: "日神",
    relations: { "god-moon": { label: "rival", note: "争夺天空" } },
  });
  const moon = god({ id: "god-moon", name: "月神" });

  it("GodRow 的真实 God ID 关系会画成世界内诸神连线", () => {
    const html = renderToStaticMarkup(<StarmapPanel gods={[sun, moon]} theme={null} />);

    expect(html).toContain('data-relation-source="god-sun"');
    expect(html).toContain('data-relation-target="god-moon"');
  });

  it("creator 神详情列出世界内关系且不生成对玩家未知关系", () => {
    expect(godRelationsForDetail(sun, [sun, moon], null)).toEqual([{
      targetId: "god-moon",
      targetName: "月神",
      label: "rival",
      note: "争夺天空",
    }]);
    expect(godRelationsForDetail(moon, [sun, moon], null)).toEqual([]);
  });
});
