import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Emblem } from "./Emblem";

const motif = {
  body: "<path data-testid=\"catalog-motif\" d=\"M2 2h20v20H2z\"/>",
  width: 24,
  height: 24,
};

describe("Emblem", () => {
  it("keeps the deterministic outer ring and renders a monochrome catalog motif", () => {
    const html = renderToStaticMarkup(createElement(Emblem, {
      seed: "entity-1",
      type: "artifact",
      size: 48,
      motif,
    }));

    expect(html).toContain("data-testid=\"catalog-motif\"");
    expect(html).toContain("color:var(--ink-soft)");
    expect(html).toContain("var(--gilt)");
  });

  it("uses only the simplified motif below 30px and preserves uploaded image priority", () => {
    const small = renderToStaticMarkup(createElement(Emblem, {
      seed: "entity-1",
      type: "artifact",
      size: 24,
      motif,
    }));
    const image = renderToStaticMarkup(createElement(Emblem, {
      seed: "entity-1",
      type: "artifact",
      size: 48,
      motif,
      imageUrl: "/uploaded.png",
    }));

    expect(small).toContain("data-testid=\"catalog-motif\"");
    expect(small).not.toContain("var(--gilt)");
    expect(image).toContain("src=\"/uploaded.png\"");
    expect(image).not.toContain("data-testid=\"catalog-motif\"");
  });
});
