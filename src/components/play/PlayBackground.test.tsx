import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayBackground } from "./PlayBackground";

describe("PlayBackground", () => {
  it("渲染无语义且不可交互的主游玩页背景层", () => {
    const html = renderToStaticMarkup(createElement(PlayBackground));

    expect(html).toContain('class="play-background"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("可为首页添加独立的透明度修饰类", () => {
    const html = renderToStaticMarkup(createElement(PlayBackground, {
      variant: "home",
    }));

    expect(html).toContain('class="play-background play-background--home"');
  });

  it.each([
    ["genesis", "play-background--genesis"],
    ["progress", "play-background--progress"],
    ["ceremony", "play-background--ceremony"],
  ] as const)("可为 %s 流程设置独立的视觉层级", (variant, modifier) => {
    const html = renderToStaticMarkup(createElement(PlayBackground, { variant }));

    expect(html).toContain(`class="play-background ${modifier}"`);
  });
});
