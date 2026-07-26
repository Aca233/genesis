import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as CodexModule from "./CodexPanel";
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

describe("EntityChronicle", () => {
  it("人物历史用世界时间显示揭示时刻，不暴露内部章节索引", () => {
    const EntityChronicle = (CodexModule as unknown as {
      EntityChronicle?: ComponentType<{ chronicle: Array<{
        id: string;
        chapterIndex: number;
        yearLabel: string;
        text: string;
        revealedAtChapter: number | null;
        revealedAtTimeLabel: string | null;
        worldVisible: boolean;
      }> }>;
    }).EntityChronicle;
    expect(EntityChronicle).toBeTypeOf("function");

    const html = renderToStaticMarkup(createElement(EntityChronicle!, {
      chronicle: [{
        id: "chronicle-1",
        chapterIndex: 1,
        yearLabel: "甲龙历四二五年",
        text: "鲁迪习得九六零新式穿甲弹。",
        revealedAtChapter: 2,
        revealedAtTimeLabel: "甲龙历四二六年·霜月",
        worldVisible: true,
      }],
    }));

    expect(html).toContain("甲龙历四二五年");
    expect(html).toContain("甲龙历四二六年·霜月方揭");
    expect(html).not.toContain("第2章");
    expect(html).not.toContain("章节");
  });
});
