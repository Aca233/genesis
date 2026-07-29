import { describe, expect, it, vi } from "vitest";
import {
  countGenesisSemanticIssues,
  recordGenesisQualityEvent,
} from "./quality-observability";

describe("genesis quality observability", () => {
  it("按语义问题类型聚合数量", () => {
    expect(countGenesisSemanticIssues([
      { type: "premise_drift" },
      { type: "premise_drift" },
      { type: "causal_disconnect" },
    ])).toEqual({
      premise_drift: 2,
      causal_disconnect: 1,
    });
  });

  it("只记录结构化指标，不记录神谕或卡牌正文", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const decree = "无职转生，但是鲁迪是托尼斯塔克转生";
    const malformedCardText = "让新生儿直接完成微型方舟反应堆";

    recordGenesisQualityEvent({
      kind: "semantic_gate_completed",
      taskId: "task-1",
      initialErrorCount: 2,
      initialWarningCount: 1,
      repaired: true,
      auditPasses: 2,
      durationMs: 321,
      issueCounts: {
        power_shortcut: 1,
        unsupported_fusion_rule: 1,
      },
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("genesis_quality", {
      kind: "semantic_gate_completed",
      taskId: "task-1",
      initialErrorCount: 2,
      initialWarningCount: 1,
      repaired: true,
      auditPasses: 2,
      durationMs: 321,
      issueCounts: {
        power_shortcut: 1,
        unsupported_fusion_rule: 1,
      },
    });
    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toContain(decree);
    expect(serialized).not.toContain(malformedCardText);

    info.mockRestore();
  });
});
