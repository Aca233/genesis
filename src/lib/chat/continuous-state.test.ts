import { describe, expect, it } from "vitest";
import {
  mergeTemporalState,
  resolveTemporalState,
} from "./continuous-state";

describe("continuous temporal state", () => {
  it("部分更新时间时保留原纪元", () => {
    expect(mergeTemporalState(
      { era: "黑潮纪元", time: "帝历三百二十七年" },
      { time: "双月重合之夜" },
    )).toEqual({
      era: "黑潮纪元",
      time: "双月重合之夜",
    });
  });

  it("旧存档回退创世卡纪元和最近编年史时间", () => {
    expect(resolveTemporalState({
      realityState: null,
      observerState: null,
      epochName: "第三次退潮时代",
      yearLabel: "潮历元年",
      latestChronicleTime: "潮历九十一年",
      eraSystem: "潮历",
    })).toEqual({
      era: "第三次退潮时代",
      time: "潮历九十一年",
    });
  });

  it("有效现实状态优先于只读回退", () => {
    expect(resolveTemporalState({
      realityState: {
        theme: {},
        style: {},
        cosmology: {},
        fusionAxiom: null,
        currentEra: "群星纪元",
        establishedFacts: [],
      },
      observerState: {
        focusType: "world",
        focusId: null,
        timeLabel: "星历七百年",
        viewpoint: "omniscient",
        activeAvatarId: null,
      },
      epochName: "旧纪元",
      yearLabel: "旧历",
      latestChronicleTime: "旧史",
      eraSystem: "星历",
    })).toEqual({
      era: "群星纪元",
      time: "星历七百年",
    });
  });

  it("缺少一切旧数据时仍返回安全标题", () => {
    expect(resolveTemporalState({
      realityState: null,
      observerState: null,
    })).toEqual({ era: "未名纪元", time: "此刻" });
  });
});

