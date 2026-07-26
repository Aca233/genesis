import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuneRail } from "./RuneRail";

describe("RuneRail", () => {
  it("renders semantic SVG icons without emoji or unicode glyph mixing", () => {
    const html = renderToStaticMarkup(createElement(RuneRail, {
      mode: "creator",
      active: "realities",
      onOpen: () => undefined,
    }));
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/[📜📖👥⚱✦◌◈◉⌘]/u);
    expect(html).toContain("aria-current=\"page\"");
    expect(html).toContain("现实树");
  });

  it("groups runes into semantic clusters with every tab still reachable", () => {
    const html = renderToStaticMarkup(createElement(RuneRail, {
      mode: "creator",
      active: "realities",
      onOpen: () => undefined,
    }));
    for (const cluster of ["记事", "神明", "现实"]) {
      expect(html).toContain(`role="group" aria-label="${cluster}"`);
    }
    for (const tab of ["activity", "starmap", "chronicle", "god", "creator", "realities", "lore", "codex"]) {
      expect(html).toContain(`data-rune-tab="${tab}"`);
    }
    expect(html).toContain("打开设置");
  });
});
