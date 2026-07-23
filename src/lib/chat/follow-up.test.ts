import { describe, expect, it } from "vitest";
import { StoredGenerationResultSchema } from "./follow-up";

describe("StoredGenerationResultSchema", () => {
  it("保存 settlement follow-up 供重放", () => {
    expect(StoredGenerationResultSchema.parse({
      version: 1,
      messageId: "message-1",
      meta: {
        suggestions: [],
        operation: "continue",
        immediateChanges: [],
        significantEvent: false,
        settlementReasons: [],
      },
      followUp: { kind: "settlement", segmentId: "segment-1" },
    }).followUp).toEqual({
      kind: "settlement",
      segmentId: "segment-1",
    });
  });

  it("追溯完成允许 messageId 为空", () => {
    expect(StoredGenerationResultSchema.parse({
      version: 1,
      messageId: null,
      meta: {
        suggestions: [],
        operation: "retroactive_rewrite",
        immediateChanges: [],
        significantEvent: true,
        settlementReasons: ["major_event"],
      },
      followUp: { kind: "rewrite", taskId: "rewrite-1" },
    }).messageId).toBeNull();
  });
});

