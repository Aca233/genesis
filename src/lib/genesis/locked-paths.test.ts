import { describe, expect, it } from "vitest";
import {
  completeCreatorDeck,
  completeDeck,
} from "@/lib/abilities/embark.test-fixtures";
import { preserveLockedPaths } from "./locked-paths";

describe("preserveLockedPaths", () => {
  it("恢复玩家锁定的顶层与嵌套字段", () => {
    const generated = completeCreatorDeck();
    generated.worldName = "模型新名字";
    generated.majorGods[0]!.voice.address = "陌生人";

    const current = completeCreatorDeck();
    current.worldName = "玩家锁定名字";
    current.majorGods[0]!.voice.address = "守誓者";

    const merged = preserveLockedPaths(
      generated,
      current,
      ["worldName", "majorGods.0.voice.address"],
      "creator",
    );

    expect(merged.worldName).toBe("玩家锁定名字");
    expect(merged.majorGods[0]!.voice.address).toBe("守誓者");
    expect(generated.worldName).toBe("模型新名字");
  });

  it("锁定字段合并后卡组无效时抛错而不是返回未校验 JSON", () => {
    const generated = completeCreatorDeck();
    const current = completeCreatorDeck();
    current.majorGods = [];

    expect(() => preserveLockedPaths(
      generated,
      current,
      ["majorGods"],
      "creator",
    )).toThrow();
  });

  it("锁定路径不能把修复结果切换到另一种模式", () => {
    expect(() => preserveLockedPaths(
      completeCreatorDeck(),
      completeDeck(),
      ["mode"],
      "creator",
    )).toThrow(/creator/);
  });
});
