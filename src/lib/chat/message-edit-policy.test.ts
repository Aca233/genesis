import { describe, expect, it } from "vitest";
import {
  assertMessageEditable,
  MessageCheckpointError,
} from "./message-edit-policy";

describe("assertMessageEditable", () => {
  it("只允许活动现实的 open 内部段", () => {
    expect(() => assertMessageEditable({
      settleState: "open",
      timelineId: "timeline-1",
      activeTimelineId: "timeline-1",
    })).not.toThrow();
  });

  it.each(["settled", "settling:extract"])("拒绝 %s 段", (settleState) => {
    expect(() => assertMessageEditable({
      settleState,
      timelineId: "timeline-1",
      activeTimelineId: "timeline-1",
    })).toThrow(MessageCheckpointError);
  });
});

