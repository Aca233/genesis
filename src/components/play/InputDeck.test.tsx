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

  it("输入区复用主菜单卡片语言，不使用亮金表单描边", () => {
    const inputDeckSource = readFileSync(new URL("./InputDeck.tsx", import.meta.url), "utf8");
    const globalStyles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(inputDeckSource).toContain("play-input-card");
    expect(inputDeckSource).toContain("play-input-textarea");
    expect(inputDeckSource).not.toContain("play-input-well");
    expect(inputDeckSource).toContain("bg-paper-raised");
    expect(globalStyles).toMatch(/\.play-input-card:focus-within\s*\{[\s\S]*?var\(--gilt-glow\)/);
    expect(globalStyles).toMatch(/\.play-input-textarea:focus-visible\s*\{[\s\S]*?outline:\s*none/);
  });
});
