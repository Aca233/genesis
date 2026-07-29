import { describe, expect, it } from "vitest";
import { completeCreatorDeck } from "@/lib/abilities/embark.test-fixtures";
import type { GenesisIntentContract } from "@/lib/genesis/intent";
import type { GenesisSemanticIssue } from "@/lib/genesis/semantic-audit";
import { semanticRepairPrompt } from "./genesis-quality";

const intent: GenesisIntentContract = {
  sourceBasis: "original",
  sourceIps: [],
  explicitPremise: ["守誓者必须从零开始重建秩序"],
  narrativeCenter: {
    identity: "守誓者",
    role: "凡人主角",
    startState: "失去旧日资源",
  },
  playerRole: {
    type: "external_creator",
    narrativeFunction: "external_author",
    mustNotReplaceProtagonist: false,
  },
  forbiddenExpansions: ["开局获得完整神装"],
  factsAtAnchor: ["守誓者身处晨钟城"],
  futureOnly: ["建立新议会"],
  fusionBoundaries: [],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["资源匮乏"],
};

const issue: GenesisSemanticIssue = {
  severity: "error",
  path: "majorCharacters.0.situation",
  type: "premise_drift",
  explanation: "正文提前给予完整神装",
  evidenceRefs: ["character-1", "artifact-old-crown"],
  repairInstruction: "删除开局神装，只保留资源匮乏状态",
};

describe("semanticRepairPrompt", () => {
  it("限定修复范围并携带全部权威层", () => {
    const invalidDeck = completeCreatorDeck();
    const prompt = semanticRepairPrompt({
      mode: "creator",
      decree: "让守誓者从零开始",
      intent,
      invalidDeck,
      issues: [issue],
      requiredRemovePaths: ["majorGods[0]"],
      lockedPaths: ["worldName", "majorGods.0.ref"],
      lorebookExcerpts: "旧王冠尚未被发现",
      materialConstraints: "晨钟议会名称与摘要必须保持",
    });

    expect(prompt).toContain('mode="creator"');
    expect(prompt).toContain("让守誓者从零开始");
    expect(prompt).toContain("FROZEN GENESIS INTENT CONTRACT");
    expect(prompt).toContain(JSON.stringify(intent));
    expect(prompt).toContain(JSON.stringify(invalidDeck));
    expect(prompt).toContain(issue.path);
    expect(prompt).toContain(issue.repairInstruction);
    expect(prompt).toContain('Required remove paths (must use action="remove")');
    expect(prompt).toContain("majorGods[0]");
    expect(prompt).toContain("worldName");
    expect(prompt).toContain("旧王冠尚未被发现");
    expect(prompt).toContain("晨钟议会名称与摘要必须保持");
  });

  it("要求只返回精确问题路径的局部操作而不重写完整卡组", () => {
    const prompt = semanticRepairPrompt({
      mode: "creator",
      decree: "从零开始",
      intent,
      invalidDeck: completeCreatorDeck(),
      issues: [issue],
      lockedPaths: ["worldName"],
    });

    expect(prompt).toContain("Each path must exactly match one listed issue path");
    const normalized = prompt.toLowerCase();
    expect(normalized).toContain("return path-level operations only");
    expect(normalized).toContain("preserve all stable refs");
    expect(normalized).toContain("preserve every locked path");
    expect(normalized).toContain("remove or generalize unsupported details instead of inventing replacements");
    expect(normalized).toContain("never return the complete world deck");
  });
});
