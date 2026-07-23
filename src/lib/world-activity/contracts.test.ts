import { describe, expect, it } from "vitest";
import {
  ActivityEntrySchema,
  ImportantEventMutationSchema,
  WorldActionSchema,
  WorldActivityMetaSchema,
} from "./contracts";

const validWorldAction = () => ({
  actorType: "god" as const,
  actorId: "god-1",
  action: "命令潮汐祭司封锁北港",
  targetIds: ["entity-1"],
  visibility: "public" as const,
  consequence: "北港的粮船被迫停泊在外海",
});

const validActivity = () => ({
  kind: "movement" as const,
  text: "三艘粮船停在北港外海。",
  subjectIds: ["entity-1"],
  visibility: "public" as const,
  importance: "normal" as const,
});

const validEventCreate = () => ({
  operation: "create" as const,
  tempRef: "north-harbor-war",
  kind: "war" as const,
  title: "北港封锁",
  summary: "海神与北境商盟围绕北港航道爆发冲突。",
  phase: "emerging" as const,
  participantIds: ["god-1", "entity-1"],
  visibility: "public" as const,
  progressText: "海神的祭司封锁了北港外海。",
  originActivityId: "activity:gen-1:activity:0",
});

describe("WorldActivityMetaSchema", () => {
  it("限制每轮最多三条行动和三条动态", () => {
    expect(() => WorldActivityMetaSchema.parse({
      worldActions: Array.from({ length: 4 }, validWorldAction),
      activityEntries: [],
    })).toThrow();
    expect(() => WorldActivityMetaSchema.parse({
      worldActions: [],
      activityEntries: Array.from({ length: 4 }, validActivity),
    })).toThrow();
  });

  it("拒绝任意字段和普通动态伪装重大事件", () => {
    expect(() => ActivityEntrySchema.parse({
      ...validActivity(),
      importance: "major",
      sql: "DROP TABLE worlds",
    })).toThrow();
    expect(() => WorldActionSchema.parse({
      ...validWorldAction(),
      consequence: "x".repeat(1001),
    })).toThrow();
  });

  it("对重要事件创建和推进实行严格字段与文本上限", () => {
    expect(ImportantEventMutationSchema.parse(validEventCreate())).toEqual(validEventCreate());
    expect(() => ImportantEventMutationSchema.parse({
      ...validEventCreate(),
      phase: "resolved",
    })).toThrow();
    expect(() => ImportantEventMutationSchema.parse({
      operation: "advance",
      eventId: "event-1",
      phase: "developing",
      summary: "x".repeat(2001),
      participantIds: ["god-1"],
      visibility: "hidden",
      progressText: "冲突继续。",
      arbitrary: true,
    })).toThrow();
  });

  it("为空列表提供默认值且拒绝空白 ID", () => {
    expect(WorldActivityMetaSchema.parse({})).toEqual({
      worldActions: [],
      activityEntries: [],
    });
    expect(() => WorldActionSchema.parse({
      ...validWorldAction(),
      actorId: " ",
    })).toThrow();
  });
});
