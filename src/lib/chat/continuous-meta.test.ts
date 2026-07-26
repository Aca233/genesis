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

  it("在同一个连续 META 中解析世界行动、动态和重要事件", () => {
    const parsed = ContinuousNarratorMetaSchema.parse({
      ...emptyContinuousMeta(),
      worldActions: [{
        actorType: "god",
        actorId: "god-1",
        action: "封锁北港",
        targetIds: ["entity-1"],
        visibility: "public",
        consequence: "粮船滞留外海",
      }],
      activityEntries: [{
        kind: "conflict",
        text: "北港航道被封锁。",
        subjectIds: ["god-1", "entity-1"],
        visibility: "public",
        importance: "normal",
      }],
      importantEventMutation: {
        operation: "create",
        tempRef: "north-harbor",
        kind: "war",
        title: "北港之争",
        summary: "海神与商盟争夺航道。",
        phase: "emerging",
        participantIds: ["god-1", "entity-1"],
        visibility: "public",
        progressText: "北港航道首次被封锁。",
      },
    });

    expect(parsed.worldActions).toHaveLength(1);
    expect(parsed.activityEntries).toHaveLength(1);
    expect(parsed.importantEventMutation?.operation).toBe("create");
  });

  it("emptyContinuousMeta 为世界动态提供空数组", () => {
    expect(emptyContinuousMeta()).toMatchObject({
      worldActions: [],
      activityEntries: [],
    });
  });

  it("合法 outcome 申报解析通过", () => {
    const parsed = ContinuousNarratorMetaSchema.parse({
      ...emptyContinuousMeta(),
      outcome: { result: "thwarted", note: "堤坝在神力触及前已被凡人炸毁" },
    });
    expect(parsed.outcome).toEqual({
      result: "thwarted",
      note: "堤坝在神力触及前已被凡人炸毁",
    });
  });

  it("outcome.result 非法枚举被拒", () => {
    expect(() => ContinuousNarratorMetaSchema.parse({
      ...emptyContinuousMeta(),
      outcome: { result: "glorious", note: "自造裁定" },
    })).toThrow();
  });

  it("缺省 outcome 的旧 meta 继续解析", () => {
    const parsed = ContinuousNarratorMetaSchema.parse(emptyContinuousMeta());
    expect(parsed.outcome).toBeUndefined();
  });
});
