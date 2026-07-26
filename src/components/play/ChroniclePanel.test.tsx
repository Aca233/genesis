import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as ChronicleModule from "./ChroniclePanel";

const entries = [
  {
    id: "entry-1",
    chapterIndex: 1,
    yearLabel: "甲龙历四二五年",
    text: "甲龙王在夏利亚布下结界。",
    entityIds: [],
    godIds: ["god-1"],
    gods: [{ id: "god-1", name: "甲龙王佩尔基乌斯" }],
    revealedAtChapter: 2,
    revealedAtTimeLabel: "甲龙历四二六年·霜月",
    source: "narrative",
    worldVisible: true,
  },
  {
    id: "entry-2",
    chapterIndex: 1,
    yearLabel: "甲龙历四二五年",
    text: "龙神事务所迁入边境。",
    entityIds: ["entity-1"],
    godIds: [],
    gods: [],
    revealedAtChapter: null,
    revealedAtTimeLabel: null,
    source: "narrative",
    worldVisible: true,
  },
];

describe("ChronicleTimeline", () => {
  it("按世界时间分组，并用揭示时间而不是内部章节索引", () => {
    const Timeline = (ChronicleModule as unknown as {
      ChronicleTimeline?: ComponentType<{ entries: typeof entries }>;
    }).ChronicleTimeline;

    expect(Timeline).toBeTypeOf("function");
    const html = renderToStaticMarkup(createElement(Timeline!, { entries }));

    expect(html.match(/甲龙历四二五年/g)).toHaveLength(1);
    expect(html).toContain("甲龙历四二六年·霜月方揭");
    expect(html).toContain("涉事诸神");
    expect(html).toContain("甲龙王佩尔基乌斯");
    expect(html).not.toContain("第1章");
    expect(html).not.toContain("第2章");
    expect(html).not.toContain("章节");
  });
});
