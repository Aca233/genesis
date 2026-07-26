import { describe, expect, it } from "vitest";
import { FinaleSchema, finaleSystem, finaleUserPrompt } from "./finale";

describe("finaleSystem", () => {
  it("锚定终章身份、史官笔法与无 META 契约", () => {
    const system = finaleSystem();
    expect(system).toContain("史诗终章");
    expect(system).toContain("史官笔法");
    expect(system).toContain("no META block");
    // 末尾附带 JSON schema，供结构化输出对齐
    expect(system).toContain('"finaleProse"');
    expect(system).toContain('"chronicleEntries"');
  });
});

describe("FinaleSchema", () => {
  const validEntries = [
    { yearLabel: "洪典九年", text: "神焰熄于洪典九年冬，天下缟素。" },
  ];

  it("拒绝不足 300 字的终章正文", () => {
    const parsed = FinaleSchema.safeParse({
      finaleProse: "太短的终章。",
      chronicleEntries: validEntries,
    });
    expect(parsed.success).toBe(false);
  });

  it("拒绝空编年史条目", () => {
    const parsed = FinaleSchema.safeParse({
      finaleProse: "长".repeat(600),
      chronicleEntries: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("接受完整终章产出", () => {
    const parsed = FinaleSchema.safeParse({
      finaleProse: "长".repeat(600),
      chronicleEntries: validEntries,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("finaleUserPrompt", () => {
  const baseOpts = {
    worldName: "盐潮之世",
    styleCard: { preset: "epic" },
    themeCard: { eraSystem: "洪典" },
    era: "洪典纪元",
    time: "洪典九年",
    playerGod: "潮神｜位阶：fallen｜领域：潮汐",
    gods: "潮神（fallen，玩家神）\n炉神（ascended）",
    chosen: "阿岚：盐沼城的先知。",
    recentChronicle: "[洪典八年] 盐潮越过旧堤。",
    recentProse: "最后的浪退去了。",
  };

  it("包含纪元时间与 RECENT CHRONICLE 段", () => {
    const prompt = finaleUserPrompt(baseOpts);
    expect(prompt).toContain("洪典纪元");
    expect(prompt).toContain("洪典九年");
    expect(prompt).toContain("== RECENT CHRONICLE ==");
    expect(prompt).toContain("[洪典八年] 盐潮越过旧堤。");
    expect(prompt).toContain("最后的浪退去了。");
  });

  it("正文只保留末尾 4000 字符", () => {
    const prompt = finaleUserPrompt({
      ...baseOpts,
      recentProse: `头${"废".repeat(5000)}`,
    });
    const tail = prompt.split("== RECENT PROSE (tail) ==")[1] ?? "";
    expect(tail).toContain("废".repeat(4000));
    expect(tail).not.toContain("废".repeat(4001));
    expect(tail).not.toContain("头");
  });
});
