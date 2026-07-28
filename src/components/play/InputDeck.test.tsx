import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("InputDeck", () => {
  it("移除神权快捷提示及其页面数据链，由叙事模型从能力上下文自行裁决", () => {
    const inputDeckSource = readFileSync(new URL("./InputDeck.tsx", import.meta.url), "utf8");
    const playPageSource = readFileSync(
      new URL("../../app/play/[worldId]/page.tsx", import.meta.url),
      "utf8",
    );

    expect(inputDeckSource).not.toContain("powerHints");
    expect(inputDeckSource).not.toContain("神权提示条");
    expect(playPageSource).not.toContain("powerHints");
  });

  it("输入区直接复用设置页典籍面板与凹纸字段", () => {
    const inputDeckSource = readFileSync(new URL("./InputDeck.tsx", import.meta.url), "utf8");

    expect(inputDeckSource).toContain("tome-plate tome-plate--corners");
    expect(inputDeckSource).toContain("play-input-textarea");
    expect(inputDeckSource).toContain("bg-paper-sunken");
    expect(inputDeckSource).not.toContain("play-input-card");
    expect(inputDeckSource).not.toContain("seal-ground-hi");
  });
});
