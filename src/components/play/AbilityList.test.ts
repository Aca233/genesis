import { describe, expect, it } from "vitest";
import {
  abilityDetailLines,
  groupAbilities,
  type AbilityView,
} from "./AbilityList";

const known: AbilityView = {
  id: "sun-sight",
  name: "日冕视界",
  kind: "racial_innate",
  visibility: "known",
  effect: "在强光中辨识灵力轨迹",
  trigger: "直视日光",
  cost: "双目短暂刺痛",
  limitations: "阴雨天无效",
  mastery: "adept",
  state: "normal",
  rumorText: null,
  bloodlineJustification: null,
  sourceAbilityId: null,
  lockedFields: [],
  version: 1,
};

describe("AbilityList display helpers", () => {
  it("按既定能力类型顺序分组并略过空组", () => {
    const rumored: AbilityView = {
      id: "moon-step",
      name: "月下行",
      kind: "personal",
      visibility: "rumored",
      rumorText: "据说她能踏着月影穿墙。",
      state: "sealed",
    };

    expect(groupAbilities([rumored, known])).toEqual([
      { kind: "racial_innate", label: "先天能力（族人默认继承）", abilities: [known] },
      { kind: "personal", label: "个人技能", abilities: [rumored] },
    ]);
  });

  it("已知能力完整展示机制、掌握程度与状态", () => {
    expect(abilityDetailLines(known)).toEqual([
      { label: "效果", value: "在强光中辨识灵力轨迹" },
      { label: "触发", value: "直视日光" },
      { label: "代价", value: "双目短暂刺痛" },
      { label: "限制", value: "阴雨天无效" },
      { label: "掌握", value: "娴熟" },
      { label: "状态", value: "完好" },
    ]);
  });

  it("运行时收到 hidden 项时整项拒绝，不走完整字段回退", () => {
    const hidden = { ...known, visibility: "hidden" } as unknown as AbilityView;

    expect(groupAbilities([hidden])).toEqual([]);
    expect(abilityDetailLines(hidden)).toEqual([]);
  });

  it("传闻能力仅保留名称与传闻，不泄露机制字段", () => {
    const rumored: AbilityView = {
      id: "moon-step",
      name: "月下行",
      kind: "personal",
      visibility: "rumored",
      rumorText: "据说她能踏着月影穿墙。",
      state: "sealed",
    };

    expect(abilityDetailLines(rumored)).toEqual([
      { label: "传闻", value: "据说她能踏着月影穿墙。" },
    ]);
  });
  it("全知 creator 可读隐藏能力机制并看到世界内不可见标记", () => {
    const hiddenForAuthor = {
      ...known,
      visibility: "hidden" as const,
      worldVisible: false as const,
    };
    expect(groupAbilities([hiddenForAuthor])).toEqual([{
      kind: "racial_innate",
      label: "先天能力（族人默认继承）",
      abilities: [hiddenForAuthor],
    }]);
    expect(abilityDetailLines(hiddenForAuthor)[0]).toEqual({
      label: "效果",
      value: "在强光中辨识灵力轨迹",
    });
  });

});
