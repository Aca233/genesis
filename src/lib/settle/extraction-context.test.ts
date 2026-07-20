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

it("分窗覆盖早期消息且长消息前缀不丢失，所有 chunk 保留原始 index", async () => {
  const { extractionMessageWindows } = await import("./extraction-context");
  const early = { id: "early", index: 3, role: "narrator", scale: "scene", content: "阿岚早年习得踏岩步。" };
  const long = { id: "long", index: 99, role: "narrator", scale: "years", content: "阿岚在开头觉醒石心。" + "山".repeat(EXTRACTION_MAX_MESSAGE_CHARS * 3) + "章末。" };
  const middle = Array.from({ length: EXTRACTION_MAX_MESSAGES + 5 }, (_, index) => ({ id: `m${index}`, index: index + 4, role: "narrator", scale: "scene", content: `中段${index}` }));
  const windows = extractionMessageWindows([early, ...middle, long]);
  expect(windows.flat().some((message) => message.id === "early" && message.content.includes("早年习得"))).toBe(true);
  expect(windows.flat().some((message) => message.id === "long" && message.content.includes("开头觉醒"))).toBe(true);
  expect(windows.flat().filter((message) => message.id === "long").every((message) => message.index === 99)).toBe(true);
  expect(windows.every((window) => window.length <= EXTRACTION_MAX_MESSAGES)).toBe(true);
  expect(windows.every((window) => window.reduce((sum, message) => sum + message.content.length, 0) <= EXTRACTION_MAX_TOTAL_CHARS)).toBe(true);
});
