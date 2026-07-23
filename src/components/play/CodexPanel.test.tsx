import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CharacterRelations } from "./CodexPanel";
import type { CharacterRelationsView } from "./types";

const relations: CharacterRelationsView = {
  outgoing: [
    {
      id: "relation-1",
      direction: "outgoing",
      label: "盟友",
      note: "曾共同守卫霜河。",
      visibility: "public",
      target: {
        id: "entity-2",
        type: "character",
        name: "守河人",
        summary: "北境斥候。",
        emblemSeed: "river",
        imageUrl: null,
      },
    },
  ],
  incoming: [
    {
      id: "relation-2",
      direction: "incoming",
      label: "师长",
      note: "教授了火器制造。",
      visibility: "public",
      source: {
        id: "entity-3",
        type: "character",
        name: "旧导师",
        summary: "隐居的火器大师。",
        emblemSeed: "master",
        imageUrl: null,
      },
    },
  ],
};

describe("CharacterRelations", () => {
  it("展示中文关系标签、方向和可点击的另一角色", () => {
    const html = renderToStaticMarkup(createElement(CharacterRelations, {
      relations,
      onOpenEntity: vi.fn(),
    }));

    expect(html).toContain("人物关系");
    expect(html).toContain("盟友");
    expect(html).toContain("师长");
    expect(html).toContain("我方所系");
    expect(html).toContain("对方所系");
    expect(html).toContain("守河人");
    expect(html).toContain('data-entity-id="entity-2"');
    expect(html).toContain('data-entity-id="entity-3"');
    expect(html).toContain("曾共同守卫霜河");
  });

  it("没有关系时显示防御性空状态", () => {
    const html = renderToStaticMarkup(createElement(CharacterRelations, {
      relations: { outgoing: [], incoming: [] },
      onOpenEntity: vi.fn(),
    }));

    expect(html).toContain("人物关系");
    expect(html).toContain("尚无载入册中的人物关系");
  });
});
