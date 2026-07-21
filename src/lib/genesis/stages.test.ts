import { describe, expect, it } from "vitest";
import {
  completedStageIndex,
  deriveStreamingStage,
  GENESIS_STAGES,
  mergeCompletedKeys,
  furthestStage,
} from "./stages";

describe("创世阶段映射", () => {
  it("只有一组所需字段全部完成才进入下一阶段", () => {
    expect(deriveStreamingStage([])).toBe("laws");
    expect(deriveStreamingStage(["worldName", "cosmology"])).toBe("laws");
    expect(deriveStreamingStage(["worldName", "cosmology", "fusionAxiom"])).toBe("gods");
    expect(
      deriveStreamingStage([
        "worldName",
        "cosmology",
        "fusionAxiom",
        "playerGod",
        "majorGods",
        "minorGods",
      ]),
    ).toBe("peoples");
  });

  it("固定输出顺序会先完整展示疆域阶段再进入人物阶段", () => {
    expect(deriveStreamingStage([
      "worldName", "cosmology", "fusionAxiom", "playerGod", "majorGods", "minorGods",
      "factions", "races", "places",
    ])).toBe("characters");
    expect(deriveStreamingStage([
      "worldName", "cosmology", "fusionAxiom", "playerGod", "majorGods", "minorGods",
      "factions", "races", "places", "majorCharacters",
    ])).toBe("conflict");
  });

  it("众生疆域阶段不依赖字段到达顺序", () => {
    expect(
      deriveStreamingStage([
        "worldName",
        "cosmology",
        "fusionAxiom",
        "playerGod",
        "majorGods",
        "minorGods",
        "places",
        "races",
        "factions",
      ]),
    ).toBe("characters");
  });

  it("所有流式字段完成但流尚未结束时仍停留在时代冲突", () => {
    expect(deriveStreamingStage([
      "worldName", "cosmology", "fusionAxiom", "playerGod", "majorGods", "minorGods",
      "factions", "races", "places", "majorCharacters", "epochConflict", "style", "theme",
    ])).toBe("conflict");
  });

  it("合并完成字段时去重且不允许进度倒退", () => {
    expect(mergeCompletedKeys(["worldName", "cosmology"], ["worldName", "fusionAxiom"]))
      .toEqual(["worldName", "cosmology", "fusionAxiom"]);
  });

  it("恢复或修补重试时阶段只能前进不能倒退", () => {
    expect(furthestStage("repair", "validation")).toBe("repair");
    expect(furthestStage("gods", "characters")).toBe("characters");
    expect(furthestStage("repair", "saving")).toBe("saving");
  });

  it("失败状态仍可按当前阶段计算已完成时间线", () => {
    expect(completedStageIndex("repair", "failed")).toBe(7);
    expect(completedStageIndex("completed", "completed")).toBe(GENESIS_STAGES.length);
  });
});
