import { describe, expect, it } from "vitest";
import { extractorSystem } from "./extractor";

describe("extractor ability guidance", () => {
  it("要求登记可复用的新研发能力，并排除单次环境偶发效果", () => {
    const prompt = extractorSystem();

    expect(prompt).toContain("成功研发");
    expect(prompt).toContain("正式命名");
    expect(prompt).toContain("首次稳定施展");
    expect(prompt).toContain("工程战斗技术");
    expect(prompt).toContain("learned or awakened");
    expect(prompt).toContain("单次环境偶发");
    expect(prompt).toContain("不得登记为能力");
  });
});
