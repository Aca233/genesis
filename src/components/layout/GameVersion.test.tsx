import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import { GameVersion } from "./GameVersion";

describe("GameVersion", () => {
  it("从 package.json 读取并展示全局右下角版本号", () => {
    const html = renderToStaticMarkup(createElement(GameVersion));

    expect(html).toContain('class="game-version"');
    expect(html).toContain(`aria-label="游戏版本 ${packageJson.version}"`);
    expect(html).toContain(`v${packageJson.version}`);
  });
});
