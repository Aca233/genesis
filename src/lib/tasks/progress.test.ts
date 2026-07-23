import { describe, expect, it } from "vitest";
import { advanceTaskStage, taskStages } from "./progress";

describe("task progress", () => {
  it("只允许同阶段幂等或向前推进", () => {
    expect(advanceTaskStage("chat", "generating", "output_stored")).toBe("output_stored");
    expect(advanceTaskStage("chat", "output_stored", "output_stored")).toBe("output_stored");
    expect(() => advanceTaskStage("chat", "applying", "generating"))
      .toThrow("任务阶段不可倒退");
  });

  it("三类任务都有完整真实步骤", () => {
    expect(taskStages.chat.map((item) => item.id)).toEqual([
      "reserved",
      "context_ready",
      "generating",
      "output_stored",
      "applying",
      "completed",
    ]);
    expect(taskStages.settlement.at(-1)?.id).toBe("completed");
    expect(taskStages.rewrite.at(-1)?.id).toBe("completed");
  });

  it("拒绝不属于任务的阶段", () => {
    expect(() => advanceTaskStage("settlement", "checkpoint_read", "generating"))
      .toThrow("未知任务阶段");
  });
});
