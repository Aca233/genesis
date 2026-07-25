import type { ImgHTMLAttributes } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GenesisModeBackground } from "./GenesisModeBackground";

/* eslint-disable @typescript-eslint/no-unused-vars, @next/next/no-img-element, jsx-a11y/alt-text */
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    preload,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    preload?: boolean;
  }) => (
    <img
      {...props}
      data-preload={preload ? "true" : "false"}
    />
  ),
}));
/* eslint-enable @typescript-eslint/no-unused-vars, @next/next/no-img-element, jsx-a11y/alt-text */

describe("GenesisModeBackground", () => {
  it.each([
    ["pantheon", "genesis-mode-background__image--pantheon"],
    ["creator", "genesis-mode-background__image--creator"],
  ] as const)("将 %s 图层设为激活态", (mode, activeClass) => {
    const html = renderToStaticMarkup(
      createElement(GenesisModeBackground, { mode }),
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(
      `/images/backgrounds/genesis-mode-pantheon.webp`,
    );
    expect(html).toContain(
      `/images/backgrounds/genesis-mode-creator.webp`,
    );
    expect(html).toContain(`${activeClass} is-active`);
    expect(html.match(/data-preload="true"/g)).toHaveLength(2);
    expect(html).not.toContain("role=");
    expect(html).not.toContain("tabindex=");
  });
});
