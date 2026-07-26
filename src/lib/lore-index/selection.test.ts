import { describe, expect, it } from "vitest";
import {
  CATEGORY_BUDGET_SHARES,
  selectLoreForGenesis,
  type SelectableLoreRow,
} from "./selection";

function row(
  sourceKey: string,
  category: string,
  title: string,
  priority: number,
  excerptLen: number,
): SelectableLoreRow {
  return { sourceKey, category, title, priority, excerpt: "字".repeat(excerptLen) };
}

describe("CATEGORY_BUDGET_SHARES", () => {
  it("份额为 §11 的 30/20/20/15/10/5 且总和 100", () => {
    expect(CATEGORY_BUDGET_SHARES).toEqual({
      timeline: 30,
      world_rule: 20,
      character: 20,
      faction: 15,
      place: 10,
      other: 5,
    });
    expect(Object.values(CATEGORY_BUDGET_SHARES).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("selectLoreForGenesis 预算数学", () => {
  it("每类一条超长条目时，各类恰好吃满自己的字符份额（截断收纳）", () => {
    const rows = [
      row("k-pl", "place", "pl", 50, 5000),
      row("k-tl", "timeline", "tl", 50, 5000),
      row("k-ab", "ability", "ab", 50, 5000), // ability 并入 other 桶
      row("k-ch", "character", "ch", 50, 5000),
      row("k-wr", "world_rule", "wr", 50, 5000),
      row("k-fa", "faction", "fa", 50, 5000),
    ];
    const { excerpt, usage } = selectLoreForGenesis(rows, 10000);

    // 注入顺序 = 桶序：timeline → world_rule → character → faction → place → other
    expect(usage.map((u) => u.sourceKey)).toEqual([
      "k-tl", "k-wr", "k-ch", "k-fa", "k-pl", "k-ab",
    ]);
    // 每块实际字符数 = 份额 − 分隔符长（5）：3000/2000/2000/1500/1000/500 − 5
    expect(usage.map((u) => u.chars)).toEqual([2995, 1995, 1995, 1495, 995, 495]);
    expect(usage.every((u) => u.truncated)).toBe(true);
    // 总长 = Σ块长 + 5 个分隔符 = 9970 + 25，绝不超预算
    expect(excerpt.length).toBe(9995);
    expect(excerpt.length).toBeLessThanOrEqual(10000);
  });

  it("桶内按 priority 降序收纳；保底份额用尽后剩余预算回填低优先级条目", () => {
    const rows = [
      row("k-a", "timeline", "a", 10, 100),
      row("k-b", "timeline", "b", 90, 100),
      row("k-c", "timeline", "c", 50, 100),
    ];
    // timeline 份额 300：b(118)+c(118) 后剩 64，装不下 a；
    // 第二遍回填：全局剩余 1000−236=764，a 整块补入
    const { excerpt, usage } = selectLoreForGenesis(rows, 1000);
    expect(usage.map((u) => u.sourceKey)).toEqual(["k-b", "k-c", "k-a"]);
    expect(usage.every((u) => !u.truncated)).toBe(true);
    expect(excerpt.indexOf("[timeline|b]")).toBeLessThan(excerpt.indexOf("[timeline|c]"));
    expect(excerpt.indexOf("[timeline|c]")).toBeLessThan(excerpt.indexOf("[timeline|a]"));
  });

  it("回填绝不超过全局预算：装不下的条目被跳过", () => {
    const rows = [
      row("k-a", "timeline", "a", 10, 100),
      row("k-b", "timeline", "b", 90, 100),
      row("k-c", "timeline", "c", 50, 100),
    ];
    // 份额 75 连截断（最小 200 字符）都装不下 → 第一遍空；
    // 第二遍按优先级 b、c 整块（各 118 成本）后 a 超预算被跳过
    const { excerpt, usage } = selectLoreForGenesis(rows, 250);
    expect(usage.map((u) => u.sourceKey)).toEqual(["k-b", "k-c"]);
    expect(excerpt.length).toBe(231);
    expect(excerpt.length).toBeLessThanOrEqual(250);
    expect(excerpt).not.toContain("[timeline|a]");
  });

  it("空输入与非正预算返回空选择", () => {
    expect(selectLoreForGenesis([], 8000)).toEqual({ excerpt: "", usage: [] });
    expect(selectLoreForGenesis([row("k", "timeline", "t", 50, 10)], 0)).toEqual({
      excerpt: "",
      usage: [],
    });
  });

  it("同 sourceKey 去重：首行生效", () => {
    const rows = [
      row("k-dup", "timeline", "first", 50, 50),
      row("k-dup", "timeline", "second", 99, 50),
    ];
    const { usage } = selectLoreForGenesis(rows, 8000);
    expect(usage).toHaveLength(1);
    expect(usage[0].title).toBe("first");
  });

  it("未知类别归入 other 桶且 usage 记录归一化后的类别", () => {
    const { usage } = selectLoreForGenesis(
      [row("k-x", "weird_category", "xx", 50, 100)],
      10000,
    );
    expect(usage).toHaveLength(1);
    expect(usage[0].category).toBe("other");
    expect(usage[0].truncated).toBe(false);
  });

  it("usage 记录注入的真实字符数（含条目头）", () => {
    const rows = [row("k-tl", "timeline", "tl", 50, 100)];
    const { excerpt, usage } = selectLoreForGenesis(rows, 8000);
    // "[timeline|tl]"(13) + "\n"(1) + 100
    expect(usage[0].chars).toBe(114);
    expect(excerpt.length).toBe(114);
  });
});
