import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GodPanel } from "./GodPanel";
import type { GodRow } from "./types";

const gods: GodRow[] = [
  {
    id: "god-dragon",
    name: "龙神 奥尔斯帝德",
    tier: "major",
    isPlayer: false,
    rank: "sovereign",
    domains: ["龙", "轮回"],
    persona: { text: "寡言而坚定。" },
    voice: {
      address: "直呼其名",
      verbalTics: ["简短"],
      catchphrases: ["继续。"],
      neverSays: ["放弃"],
    },
    faithScope: "龙族与反人神阵营",
    relations: {
      "god-armored": { label: "ally", note: "共同对抗人神。" },
    },
    agenda: {
      longTermGoal: "终结人神的轮回。",
      shortTermGoals: ["整合龙神事务所"],
      methods: "谨慎布局并培养同伴。",
      stanceToPlayer: { motive: "观察创世主对现实的干预。" },
      schemes: ["封锁转生节点"],
    },
    agendaRevealed: false,
    agendaWorldVisible: false,
    abilities: [],
  },
  {
    id: "god-armored",
    name: "甲龙王 佩尔基乌斯",
    tier: "minor",
    isPlayer: false,
    rank: "exalted",
    domains: ["召唤", "结界"],
    persona: { text: "骄傲而守序。" },
    voice: null,
    faithScope: "空中城塞",
    relations: null,
    agenda: null,
    agendaRevealed: false,
    abilities: [],
  },
];

describe("GodPanel creator view", () => {
  it("展示全部神明的完整资料、真实关系对象与幕后议程", () => {
    const html = renderToStaticMarkup(createElement(GodPanel, {
      gods,
      theme: null,
      mode: "creator",
      initialGodId: "god-dragon",
    }));

    expect(html).toContain("诸神录");
    expect(html).toContain('data-god-id="god-dragon"');
    expect(html).toContain("龙神 奥尔斯帝德");
    expect(html).toContain("甲龙王 佩尔基乌斯");
    expect(html).toContain("共同对抗人神");
    expect(html).toContain("谨慎布局并培养同伴");
    expect(html).toContain("封锁转生节点");
    expect(html).toContain("直呼其名");
    expect(html).toContain("世界内不可见");
  });
});
