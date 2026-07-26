import { describe, expect, it } from "vitest";
import {
  LORE_INDEX_UNAVAILABLE_NOTICE,
  fallbackLorebookExcerpts,
  lorebookExcerpts,
  parseStWorldbook,
  type ParsedLorebookEntry,
} from "./st-import";
import { restoreImportedEntries } from "./st-export";

function entry(
  keys: string[],
  content: string,
  enabled = true,
): ParsedLorebookEntry {
  return { keys, content, enabled, stExtra: {} };
}

describe("parseStWorldbook", () => {
  it("兼容对象/数组 entries，合并 key+keys，disable 取反为 enabled，未识别字段进 stExtra", () => {
    const parsed = parseStWorldbook({
      entries: {
        "0": {
          uid: 0,
          key: ["旧王朝"],
          keys: ["王朝", "旧王朝"],
          content: "王朝编年史",
          disable: true,
          order: 42,
        },
        "1": { key: ["空条目"], content: "   " },
        "2": { key: ["法则"], content: "世界法则" },
      },
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      keys: ["旧王朝", "王朝"],
      content: "王朝编年史",
      enabled: false,
    });
    expect(parsed[0]!.stExtra).toMatchObject({ uid: 0, order: 42 });
    expect(parsed[1]).toMatchObject({ keys: ["法则"], content: "世界法则", enabled: true });
  });

  it("ST 往返：导入条目经 restoreImportedEntries 原样还原 key/content/disable 与 stExtra 字段", () => {
    const source = {
      entries: [
        {
          uid: 7,
          key: ["星海"],
          content: "星海的边界",
          disable: false,
          probability: 77,
          comment: "原注释",
        },
      ],
    };
    const restored = restoreImportedEntries(parseStWorldbook(source));

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      key: ["星海"],
      content: "星海的边界",
      disable: false,
      probability: 77,
      comment: "原注释",
    });
  });
});

describe("lorebookExcerpts（原始上传序截取，行为锁定）", () => {
  it("按上传顺序拼块：[keys: …] 头 + \\n---\\n 分隔，跳过 disabled 条目", () => {
    const text = lorebookExcerpts([
      entry(["甲", "乙"], "第一条内容"),
      entry(["丙"], "被禁用", false),
      entry(["丁"], "第二条内容"),
    ]);
    expect(text).toBe("[keys: 甲, 乙]\n第一条内容\n---\n[keys: 丁]\n第二条内容");
  });

  it("预算裁剪：首个超出预算的块即停止（不跳块续取）", () => {
    const first = entry(["a"], "字".repeat(50));
    const second = entry(["b"], "字".repeat(50));
    const third = entry(["c"], "短");
    // 块长 = "[keys: x]\n".length(10) + 50 = 60；预算 100 只容第一块
    const text = lorebookExcerpts([first, second, third], 100);
    expect(text).toBe(`[keys: a]\n${"字".repeat(50)}`);
  });

  it("空输入返回空字符串", () => {
    expect(lorebookExcerpts([])).toBe("");
  });
});

describe("fallbackLorebookExcerpts（§11 索引失败回退）", () => {
  it("回退说明行精确措辞固定", () => {
    expect(LORE_INDEX_UNAVAILABLE_NOTICE).toBe("资料索引不可用，按原始顺序注入");
  });

  it("与 lorebookExcerpts 逐字节一致，仅前置一行说明", () => {
    const entries = [entry(["甲"], "第一条内容"), entry(["乙"], "第二条内容")];
    expect(fallbackLorebookExcerpts(entries)).toBe(
      `资料索引不可用，按原始顺序注入\n${lorebookExcerpts(entries)}`,
    );
  });

  it("透传预算参数，截取结果与同预算 lorebookExcerpts 一致", () => {
    const entries = [entry(["a"], "字".repeat(50)), entry(["b"], "字".repeat(50))];
    expect(fallbackLorebookExcerpts(entries, 100)).toBe(
      `${LORE_INDEX_UNAVAILABLE_NOTICE}\n${lorebookExcerpts(entries, 100)}`,
    );
  });

  it("摘录为空时返回空字符串，不注入孤立说明行", () => {
    expect(fallbackLorebookExcerpts([])).toBe("");
    expect(fallbackLorebookExcerpts([entry(["丙"], "全部禁用", false)])).toBe("");
  });
});
