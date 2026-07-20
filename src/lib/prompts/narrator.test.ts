import { describe, expect, it } from "vitest";
import { splitMetaBlock } from "./narrator";

const meta = JSON.stringify({
  suggestions: ["追问"],
  chapterBreakHint: false,
  ability_reveals: [],
});

describe("splitMetaBlock strict tail framing", () => {
  it("只解析末尾完整且标记独占一行的 META 块", () => {
    expect(splitMetaBlock(`正文\n<<<META\n${meta}\nMETA>>>`)).toMatchObject({
      prose: "正文",
      meta: { suggestions: ["追问"] },
    });
  });

  it.each([
    `正文内联 <<<META\n${meta}\nMETA>>>`,
    `正文\n<<<META\n${meta}`,
    `正文\n<<<META trailing\n${meta}\nMETA>>>`,
    `正文\n<<<META\n${meta}\nMETA>>>\n后续正文`,
    `前段\n<<<META\n${meta}\nMETA>>>\n仍是正文\n`,
  ])("不吞掉非完整尾部块：%s", (full) => {
    expect(splitMetaBlock(full)).toEqual({
      prose: full.trim(),
      meta: { suggestions: [], chapterBreakHint: false },
    });
  });
});
