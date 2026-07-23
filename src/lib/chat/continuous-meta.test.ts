import { describe, expect, it } from "vitest";
import {
  ContinuousNarratorMetaSchema,
  emptyContinuousMeta,
} from "./continuous-meta";

describe("ContinuousNarratorMetaSchema", () => {
  it("接受普通推进、部分时间更新和安全轻变化", () => {
    const parsed = ContinuousNarratorMetaSchema.parse({
      suggestions: ["继续观察港口"],
      operation: "continue",
      temporalState: { time: "双月重合之夜" },
      immediateChanges: [
        { kind: "set_scene_presence", entityId: "entity-1", present: true },
      ],
      significantEvent: false,
      settlementReasons: [],
    });

    expect(parsed.temporalState).toEqual({ time: "双月重合之夜" });
  });

  it("拒绝模型自造的任意数据库字段", () => {
    expect(() => ContinuousNarratorMetaSchema.parse({
      ...emptyContinuousMeta(),
      immediateChanges: [{ kind: "raw_sql", value: "drop table worlds" }],
    })).toThrow();
  });

  it("时间变化至少提供一个非空字段", () => {
    expect(() => ContinuousNarratorMetaSchema.parse({
      ...emptyContinuousMeta(),
      temporalState: {},
    })).toThrow();
  });
});

