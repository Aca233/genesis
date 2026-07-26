import type { ImgHTMLAttributes } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenesisModeBackground } from "./GenesisModeBackground";

type MockImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  preload?: boolean;
  priority?: boolean;
};

const reactMocks = vi.hoisted(() => ({
  useState: vi.fn(),
}));

const imageMocks = vi.hoisted(() => ({
  props: [] as MockImageProps[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useState: reactMocks.useState,
  };
});

/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    preload,
    ...props
  }: MockImageProps) => {
    imageMocks.props.push({ ...props, fill: _fill, preload });

    return (
      <img
        {...props}
        data-preload={preload ? "true" : "false"}
      />
    );
  },
}));
/* eslint-enable @next/next/no-img-element, jsx-a11y/alt-text */

describe("GenesisModeBackground", () => {
  beforeEach(() => {
    imageMocks.props.length = 0;
    reactMocks.useState.mockReset();
    reactMocks.useState.mockImplementation((initial) => [initial, vi.fn()]);
  });

  it.each([
    ["pantheon", "genesis-mode-background__image--pantheon"],
    ["creator", "genesis-mode-background__image--creator"],
  ] as const)("仅将 %s 图层设为激活态", (mode, activeClass) => {
    const html = renderToStaticMarkup(
      createElement(GenesisModeBackground, { mode }),
    );
    const activeImages = imageMocks.props.filter(({ className }) => (
      className?.split(" ").includes("is-active")
    ));

    expect(imageMocks.props).toHaveLength(2);
    expect(imageMocks.props.map(({ src }) => src)).toEqual([
      "/images/backgrounds/genesis-mode-pantheon.webp",
      "/images/backgrounds/genesis-mode-creator.webp",
    ]);
    expect(activeImages).toHaveLength(1);
    expect(activeImages[0]?.className).toBe(
      `genesis-mode-background__image ${activeClass} is-active`,
    );
    expect(imageMocks.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alt: "", preload: true }),
        expect.objectContaining({ alt: "", preload: true }),
      ]),
    );
    imageMocks.props.forEach((props) => {
      expect(props).not.toHaveProperty("priority");
      expect(props).not.toHaveProperty("role");
      expect(props).not.toHaveProperty("tabIndex");
    });
    expect(html).toContain(
      `<div class="genesis-mode-background genesis-mode-background--${mode}" aria-hidden="true">`,
    );
  });

  it("图片加载失败时只移除失败图层并保留另一图层和当前模式", () => {
    let failed = {
      pantheon: false,
      creator: false,
    };
    const setFailed = vi.fn(
      (update: (current: typeof failed) => typeof failed) => {
        failed = update(failed);
      },
    );
    reactMocks.useState.mockImplementation(() => [failed, setFailed]);

    renderToStaticMarkup(
      createElement(GenesisModeBackground, { mode: "pantheon" }),
    );
    const failedImage = imageMocks.props.find(
      ({ src }) => src === "/images/backgrounds/genesis-mode-pantheon.webp",
    );

    failedImage?.onError?.(undefined as never);
    imageMocks.props.length = 0;

    const html = renderToStaticMarkup(
      createElement(GenesisModeBackground, { mode: "pantheon" }),
    );

    expect(setFailed).toHaveBeenCalledOnce();
    expect(failed).toEqual({
      pantheon: true,
      creator: false,
    });
    expect(imageMocks.props).toHaveLength(1);
    expect(imageMocks.props[0]?.src).toBe(
      "/images/backgrounds/genesis-mode-creator.webp",
    );
    expect(html).toContain(
      '<div class="genesis-mode-background genesis-mode-background--pantheon" aria-hidden="true">',
    );
  });
});
