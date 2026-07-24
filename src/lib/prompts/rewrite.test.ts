import { describe, expect, it } from "vitest";
import {
  rewritePlannerSystem,
  rewritePlannerUserPrompt,
  rewriteResultSystem,
  rewriteResultUserPrompt,
} from "./rewrite";

describe("absolute-authority rewrite prompts", () => {
  it("makes every decree inevitable without checks and requests minimal sufficient patches", () => {
    const system = rewritePlannerSystem();

    expect(system).toContain("always achievable");
    expect(system).toContain("no power, resource, distance, rank, or success check");
    expect(system).toContain("elevate the decree");
    expect(system).toContain("smallest sufficient changes");
    expect(system).toContain("supplied IDs");
    expect(system).toContain("unique tempRef");
    expect(system).toContain("old-reality evidence");
    expect(system).toContain("never rewrite prior message text");
    expect(system).toContain("current-time prospective");
    expect(system).toContain("Output ONLY");
    expect(system).toContain('"realityCardPatches"');
    expect(system).toContain("Do not output establishedByRewriteId");
  });

  it("labels all planner inputs and preserves mixed scope hints", () => {
    const prompt = rewritePlannerUserPrompt({
      decree: "旧王朝从未存在；从今以后魔法消耗记忆。",
      requestedScope: "retroactive",
      sourceRealitySummary: "旧王朝统治北境，魔法无代价。",
      currentState: "北境处于旧历九百年。",
      existingRecords: "god-1 月神；entity-1 北境；ability-1 星火术",
    });

    expect(prompt).toContain("旧王朝从未存在；从今以后魔法消耗记忆。");
    expect(prompt).toContain("retroactive");
    expect(prompt).toContain("god-1 月神");
    expect(prompt).toContain("Do not invent an ID for an existing record");
  });

  it("narrates the new reality as settled fact without doubt or weakening", () => {
    const system = rewriteResultSystem();
    const prompt = rewriteResultUserPrompt({
      decree: "令两轮月亮自古长存。",
      interpretation: "世界自诞生起便有双月",
      scope: "retroactive",
      effectivePoint: "世界诞生之初",
      sourceRealitySummary: "旧现实只有一轮月亮。",
      newRealitySummary: "新现实一直有两轮月亮。",
      appliedConsequences: ["潮汐历法已重构", "旧消息仅作为前现实证据保留"],
      narrationFocus: "双月下的新历史",
    });

    expect(system).toContain("now true");
    expect(system).toContain("never question");
    expect(system).toContain("never weaken");
    expect(system).toContain("No checks");
    expect(prompt).toContain("旧现实只有一轮月亮");
    expect(prompt).toContain("新现实一直有两轮月亮");
    expect(prompt).toContain("潮汐历法已重构");
  });
});
