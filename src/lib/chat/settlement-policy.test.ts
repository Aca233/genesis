import { describe, expect, it } from "vitest";
import { decideSettlement } from "./settlement-policy";

const base = {
  scale: "scene" as const,
  narratorCountAfter: 1,
  temporalChanged: false,
  eraChanged: false,
  significantEvent: false,
  settlementReasons: [] as const,
};

describe("decideSettlement", () => {
  it("第六个 Narrator 回复必定整理", () => {
    expect(decideSettlement({
      ...base,
      narratorCountAfter: 6,
    }).required).toBe(true);
  });

  it("宽时间尺度只有实际推进后才整理", () => {
    expect(decideSettlement({
      ...base,
      scale: "years",
      temporalChanged: false,
    }).required).toBe(false);
    expect(decideSettlement({
      ...base,
      scale: "years",
      temporalChanged: true,
    }).required).toBe(true);
  });

  it("能力或纪元变化不能被 significant=false 绕过", () => {
    expect(decideSettlement({
      ...base,
      settlementReasons: ["ability_change"],
    }).required).toBe(true);
    expect(decideSettlement({
      ...base,
      eraChanged: true,
    }).required).toBe(true);
  });

  it("模型重大标记必须伴随合法理由", () => {
    expect(decideSettlement({
      ...base,
      significantEvent: true,
    }).required).toBe(false);
    expect(decideSettlement({
      ...base,
      significantEvent: true,
      settlementReasons: ["major_event"],
    }).required).toBe(true);
  });
});

