import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IconPicker } from "./IconPicker";

describe("IconPicker", () => {
  it("uses the current icon itself as the change trigger without visible helper text", () => {
    const html = renderToStaticMarkup(createElement(IconPicker, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "entity",
      subjectId: "entity-1",
      value: {
        token: "entity",
        source: "generated",
        playerLocked: false,
        icon: { body: "<path d=\"M0 0h24v24H0z\"/>", width: 24, height: 24 },
      },
      onChange: vi.fn(),
    }));

    expect(html).toContain("aria-label=\"更换图标\"");
    expect(html).toContain("<svg");
    expect(html).not.toContain(">更换图标<");
    expect(html).not.toContain(">图标已锁<");
  });
});
