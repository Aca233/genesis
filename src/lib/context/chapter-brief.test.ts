import { describe, expect, it } from "vitest";
import {
  ChapterBriefSchema,
  formatChapterBriefSystem,
  mergeChapterBrief,
} from "./chapter-brief";

describe("chapter brief contract", () => {
  it("normalizes partial updates without erasing unspecified fields", () => {
    const current = ChapterBriefSchema.parse({
      objective: "守住北港",
      mustHide: ["潮神已经倒戈"],
    });

    expect(mergeChapterBrief(current, {
      hintOnly: ["海堤下有空洞", "海堤下有空洞"],
    })).toEqual({
      objective: "守住北港",
      viewpointEntityId: null,
      openingConstraint: null,
      endingConstraint: null,
      readerKnows: [],
      viewpointKnows: [],
      mustHide: ["潮神已经倒戈"],
      hintOnly: ["海堤下有空洞"],
      forbiddenDevelopments: [],
    });
  });

  it("emits only populated information-control sections", () => {
    const block = formatChapterBriefSystem({
      objective: "让守军发现潮声异常",
      viewpointEntityId: "entity-guard",
      readerKnows: ["海堤正在渗水"],
      mustHide: ["潮神亲自凿穿海堤"],
      hintOnly: ["裂缝来自堤内"],
      forbiddenDevelopments: ["本轮不得让海堤彻底崩塌"],
    });

    expect(block).toContain("== CHAPTER BRIEF (binding) ==");
    expect(block).toContain("Objective: 让守军发现潮声异常");
    expect(block).toContain("Viewpoint entity id: entity-guard");
    expect(block).toContain("Reader knows:\n- 海堤正在渗水");
    expect(block).toContain("Must remain hidden:\n- 潮神亲自凿穿海堤");
    expect(block).toContain("Hint only:\n- 裂缝来自堤内");
    expect(block).toContain("Forbidden developments:\n- 本轮不得让海堤彻底崩塌");
    expect(block).not.toContain("Opening constraint:");
  });

  it("omits an empty brief", () => {
    expect(formatChapterBriefSystem({})).toBeNull();
  });
});
