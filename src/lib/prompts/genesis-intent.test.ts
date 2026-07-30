import { describe, expect, it } from "vitest";
import { genesisIntentSystem, genesisIntentUserPrompt } from "./genesis-intent";

describe("genesis intent prompts", () => {
  it("pantheon 固定单一叙事中心、独立玩家神与不确定性策略", () => {
    const prompt = genesisIntentSystem("pantheon");

    expect(prompt).toContain("exactly one narrative center");
    expect(prompt).toContain("independent god");
    expect(prompt).toContain("must not replace the protagonist");
    expect(prompt).toContain("omit_or_generalize");
  });

  it("creator 固定世界外创世者角色", () => {
    const prompt = genesisIntentSystem("creator");

    expect(prompt).toContain("exactly one narrative center");
    expect(prompt).toContain("external creator");
    expect(prompt).toContain("narrativeFunction to external_author");
    expect(prompt).toContain("omit_or_generalize");
  });

  it("明示 sourceBasis 与 sourceIps 的基数映射", () => {
    const prompt = genesisIntentSystem("pantheon");

    expect(prompt).toContain("original requires exactly 0 sourceIps");
    expect(prompt).toContain("single_ip requires exactly 1 sourceIps");
    expect(prompt).toContain("multi_ip requires 2 to 6 sourceIps");
  });

  it("用户提示词包含模式、神谕与可选资料摘录", () => {
    const prompt = genesisIntentUserPrompt({
      mode: "pantheon",
      decree: "无职转生，但是鲁迪是托尼斯塔克转生",
      lorebookExcerpts: "布耶纳村资料",
    });

    expect(prompt).toContain('mode="pantheon"');
    expect(prompt).toContain("无职转生，但是鲁迪是托尼斯塔克转生");
    expect(prompt).toContain("布耶纳村资料");
  });
});
