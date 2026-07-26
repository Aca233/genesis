import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayHeader } from "./PlayHeader";

describe("PlayHeader", () => {
  it("始终提供返回主菜单的明确出口并保留世界时间标题", () => {
    const html = renderToStaticMarkup(createElement(PlayHeader, {
      worldName: "六面世界",
      era: "铁甲纪元",
      time: "甲龙历四三二年",
    }));

    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="返回主菜单"');
    expect(html).toContain("主菜单");
    expect(html).toContain("六面世界 · 铁甲纪元 · 甲龙历四三二年");
  });
});
