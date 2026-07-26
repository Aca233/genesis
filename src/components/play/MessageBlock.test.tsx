import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBlock } from "./MessageBlock";
import type { MessageRow } from "./types";

function narratorMessage(meta: MessageRow["meta"]): MessageRow {
  return {
    id: "msg-1",
    chapterId: "chapter-1",
    index: 2,
    role: "narrator",
    content: "潮水退去，堤上只余盐痕。",
    scale: "scene",
    variants: null,
    meta,
    createdAt: "2026-07-25T12:00:00.000Z",
  };
}

describe("MessageBlock 本轮变化折叠行", () => {
  it("meta.outcome=thwarted 渲染『神谕受挫』且带 text-cinnabar", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBlock, {
        message: narratorMessage({
          outcome: { result: "thwarted", note: "堤坝在神力触及前已被凡人炸毁" },
        }),
      }),
    );

    expect(html).toContain("神谕受挫");
    expect(html).toContain("堤坝在神力触及前已被凡人炸毁");
    expect(html).toContain('class="text-cinnabar"');
  });

  it("meta.outcome=fulfilled 渲染『神谕如愿』且不带 text-cinnabar", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBlock, {
        message: narratorMessage({
          outcome: { result: "fulfilled", note: "潮水依神谕退去" },
        }),
      }),
    );

    expect(html).toContain("神谕如愿");
    expect(html).not.toContain('class="text-cinnabar"');
  });

  it("无 outcome 时不渲染神谕结果行", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBlock, {
        message: narratorMessage({
          activityEntries: [
            { kind: "conflict", text: "北港航道被封锁。", visibility: "public" },
          ],
        }),
      }),
    );

    expect(html).toContain("本轮变化");
    expect(html).not.toContain("神谕");
  });

  it("hidden worldActions 仍被过滤，不入变化行（回归）", () => {
    const html = renderToStaticMarkup(
      createElement(MessageBlock, {
        message: narratorMessage({
          worldActions: [
            {
              actorType: "god",
              actorId: "god-1",
              action: "夜掘暗渠",
              targetIds: [],
              visibility: "hidden",
              consequence: "无人察觉",
            },
            {
              actorType: "god",
              actorId: "god-2",
              action: "封锁北港",
              targetIds: [],
              visibility: "public",
              consequence: "粮船滞留外海",
            },
          ],
        }),
      }),
    );

    expect(html).toContain("封锁北港");
    expect(html).not.toContain("夜掘暗渠");
  });
});
