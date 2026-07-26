import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CelestialPageShell } from "./CelestialPageShell";

describe("CelestialPageShell", () => {
  it("为辅助页面渲染共享星图背景与纸张内容衬层", () => {
    const html = renderToStaticMarkup(
      <CelestialPageShell contentClassName="max-w-2xl">
        <p>页面内容</p>
      </CelestialPageShell>,
    );

    expect(html).toContain('class="play-background play-background--supporting"');
    expect(html).toContain("celestial-page-content");
    expect(html).toContain("max-w-2xl");
    expect(html).toContain("页面内容");
  });
});
