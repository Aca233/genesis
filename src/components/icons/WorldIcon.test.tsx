import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperationIcon } from "./OperationIcon";
import { WorldIcon } from "./WorldIcon";

describe("icon rendering", () => {
  it("renders resolved world SVG without layout shifting", () => {
    const html = renderToStaticMarkup(createElement(WorldIcon, {
      icon: { body: "<path d=\"M0 0h24v24H0z\"/>", width: 24, height: 24 },
      label: "打开现实树",
    }));
    expect(html).toContain("<svg");
    expect(html).toContain("width=\"20\"");
    expect(html).toContain("height=\"20\"");
    expect(html).toContain("aria-label=\"打开现实树\"");
  });

  it("keeps operation icons fixed and decorative when nearby text exists", () => {
    const html = renderToStaticMarkup(createElement(OperationIcon, { name: "settings" }));
    expect(html).toContain("<svg");
    expect(html).toContain("aria-hidden=\"true\"");
  });
});
