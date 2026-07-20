import { describe, expect, it } from "vitest";
import {
  EXTRACTION_MAX_MESSAGE_CHARS,
  EXTRACTION_MAX_MESSAGES,
  EXTRACTION_MAX_TOTAL_CHARS,
  boundExtractionMessages,
  mentionedOwnerIds,
} from "./extraction-context";

describe("bounded extraction context", () => {
  it("仅保留最新消息、原始 index 映射并限制单条和总字符", () => {
    const messages = Array.from({ length: EXTRACTION_MAX_MESSAGES + 8 }, (_, index) => ({
      id: `m-${index}`,
      index,
      role: "narrator",
      scale: "scene",
      content: `第${index}条` + "石".repeat(EXTRACTION_MAX_MESSAGE_CHARS * 2),
    }));
    const bounded = boundExtractionMessages(messages);
    expect(bounded.length).toBeLessThanOrEqual(EXTRACTION_MAX_MESSAGES);
    expect(bounded[0]?.index).toBe(messages.length - bounded.length);
    expect(bounded.at(-1)?.index).toBe(messages.length - 1);
    expect(Math.max(...bounded.map((message) => message.content.length))).toBeLessThanOrEqual(EXTRACTION_MAX_MESSAGE_CHARS);
    expect(bounded.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(EXTRACTION_MAX_TOTAL_CHARS);
  });

  it("只选择正文提及的 owner，并带上人物主种族", () => {
    const ids = mentionedOwnerIds(
      [{ id: "m", index: 1, role: "narrator", scale: "scene", content: "阿岚越过断崖。" }],
      [
        { id: "char", name: "阿岚", aliases: [], type: "character", raceId: "race" },
        { id: "other", name: "白石", aliases: [], type: "character", raceId: null },
        { id: "race", name: "山民", aliases: [], type: "race", raceId: null },
      ],
    );
    expect(ids).toEqual(new Set(["char", "race"]));
  });
});
