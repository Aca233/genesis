import { describe, expect, it } from "vitest";
import { factionSections } from "./faction-sections";

describe("factionSections", () => {
  it("优先将关键人物引用解析为主要人物姓名，并为旧草稿回退 keyFigures", () => {
    const base = { overview: "概览", territory: "疆域", faith: "信仰" };
    expect(
      factionSections(
        { ...base, keyCharacterRefs: [{ ref: "character-2" }, { ref: "character-1" }], keyFigures: ["旧名"] },
        [{ ref: "character-1", name: "阿黎" }, { ref: "character-2", name: "衡" }],
      ).find((section) => section.key === "keyFigures")?.content,
    ).toEqual({ names: ["衡", "阿黎"] });

    expect(
      factionSections({ ...base, keyCharacterRefs: [], keyFigures: ["旧名"] }, []).find(
        (section) => section.key === "keyFigures",
      )?.content,
    ).toEqual({ names: ["旧名"] });
  });
});
