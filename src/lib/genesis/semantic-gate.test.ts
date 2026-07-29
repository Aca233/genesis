import { describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { isTransientLlmError } from "@/lib/llm/gateway";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import type { GenesisIntentContract } from "./intent";
import type {
  GenesisQualityReport,
  GenesisSemanticAuditResult,
} from "./semantic-audit";
import {
  enforceGenesisQuality,
  GenesisSemanticGateError,
  GenesisSemanticRepairResultSchema,
} from "./semantic-gate";

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

const warningReport: GenesisSemanticAuditResult = {
  verdict: "warnings",
  issues: [{
    severity: "warning",
    path: "epochConflict.hiddenCurrents.0",
    type: "causal_disconnect",
    explanation: "背景暗流与开局压力连接偏弱",
    evidenceRefs: [],
    repairInstruction: "后续演进时补充因果连接",
  }],
};

const errorReport: GenesisSemanticAuditResult = {
  verdict: "errors",
  issues: [{
    severity: "error",
    path: "majorCharacters.0.situation",
    type: "premise_drift",
    explanation: "正文泄漏：旧王冠已经归还",
    evidenceRefs: ["character-1"],
    repairInstruction: "删除提前获得的旧王冠",
  }],
};

const passReport: GenesisSemanticAuditResult = { verdict: "pass", issues: [] };
const owner = {
  kind: "genesis-task",
  id: "owner-1",
  genesisTaskId: "task-1",
} as const;

function qualityInput() {
  return {
    deck: completeCreatorDeck(),
    mode: "creator" as const,
    decree: "让守誓者从零开始",
    intent,
    userId: "user-1",
    materialSnapshot: null,
    owner,
  };
}

describe("enforceGenesisQuality", () => {
  it("兼容模型把补丁值直接作为 JSON 值或 value 字段返回", () => {
    expect(GenesisSemanticRepairResultSchema.parse({
      operations: [
        { path: "majorCharacters.0.situation", action: "replace", valueJson: { state: "失落" } },
        { path: "majorCharacters.0.name", action: "replace", value: "南宫婉" },
        { path: "majorCharacters.0.futureAbility", action: "remove" },
      ],
    })).toEqual({
      operations: [
        {
          path: "majorCharacters.0.situation",
          action: "replace",
          valueJson: JSON.stringify({ state: "失落" }),
        },
        {
          path: "majorCharacters.0.name",
          action: "replace",
          valueJson: JSON.stringify("南宫婉"),
        },
        { path: "majorCharacters.0.futureAbility", action: "remove", valueJson: null },
      ],
    });
  });

  it("兼容模型直接返回补丁操作数组", () => {
    expect(GenesisSemanticRepairResultSchema.parse([
      { path: "majorCharacters.0.situation", action: "replace", valueJson: "失落" },
    ])).toEqual({
      operations: [{
        path: "majorCharacters.0.situation",
        action: "replace",
        valueJson: JSON.stringify("失落"),
      }],
    });
  });

  it("warning-only 输出原样通过且不 repair", async () => {
    const input = qualityInput();
    const audit = vi.fn().mockResolvedValue(warningReport);
    const repair = vi.fn();
    const validate = vi.fn();

    const result = await enforceGenesisQuality(input, { audit, repair, validate });

    expect(result.deck).toBe(input.deck);
    expect(result.report).toMatchObject({
      verdict: "warnings",
      meta: {
        initialErrorCount: 0,
        initialWarningCount: 1,
        repaired: false,
        auditPasses: 1,
      },
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(input.deck, expect.objectContaining({
      userId: input.userId,
      owner,
    }));
    expect(repair).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });

  it("只 repair 一次，恢复 locked paths，完整校验后再 audit 一次", async () => {
    const events: string[] = [];
    const input = qualityInput();
    const currentDeck = completeCreatorDeck();
    currentDeck.worldName = "玩家锁定世界名";
    const repairOutput = {
      operations: [{
        path: "worldName",
        action: "replace" as const,
        valueJson: JSON.stringify("模型改写世界名"),
      }],
    };
    const lockedPathReport: GenesisSemanticAuditResult = {
      verdict: "errors",
      issues: [{
        ...errorReport.issues[0]!,
        path: "worldName",
      }],
    };
    const materialSnapshot = { selections: [], resolved: [] } as unknown as GenesisMaterialSnapshot;
    const audit = vi.fn()
      .mockImplementationOnce(async () => {
        events.push("audit:initial");
        return lockedPathReport;
      })
      .mockImplementationOnce(async (deck) => {
        events.push("audit:final");
        expect(deck.worldName).toBe("玩家锁定世界名");
        return passReport;
      });
    const repair = vi.fn().mockImplementation(async (slot, opts) => {
      events.push("repair");
      expect(slot).toBe("narrative");
      expect(opts).toMatchObject({
        task: "genesis",
        userId: input.userId,
        owner,
        schema: GenesisSemanticRepairResultSchema,
        maxAttempts: 2,
        transportMaxAttempts: 1,
        allowTransportFallback: false,
        failOnTruncation: false,
      });
      expect(opts.user).toContain("晨钟议会名称不可修改");
      return repairOutput;
    });
    const validate = vi.fn().mockImplementation((rawDeck, expectedMode, snapshot) => {
      events.push("validate");
      expect(rawDeck.worldName).toBe("玩家锁定世界名");
      expect(expectedMode).toBe("creator");
      expect(snapshot).toBe(materialSnapshot);
      return rawDeck;
    });

    const result = await enforceGenesisQuality({
      ...input,
      materialSnapshot,
      materialConstraints: "晨钟议会名称不可修改",
      lorebookExcerpts: "旧王冠仍处于失落状态",
      lockedPaths: ["worldName"],
      currentDeck,
      onStage: async (stage) => { events.push(`stage:${stage}`); },
    }, { audit, repair, validate });

    expect(events).toEqual([
      "stage:audit",
      "audit:initial",
      "stage:semantic_repair",
      "repair",
      "validate",
      "audit:final",
    ]);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ owner }));
    expect(repair).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(result.deck.worldName).toBe("玩家锁定世界名");
    expect(result.report).toMatchObject({
      verdict: "pass",
      meta: {
        initialErrorCount: 1,
        initialWarningCount: 0,
        repaired: true,
        auditPasses: 2,
      },
    });
  });

  it("补丁值未通过完整校验时携精确错误在补丁步骤内重试", async () => {
    const input = qualityInput();
    const audit = vi.fn()
      .mockResolvedValueOnce(errorReport)
      .mockResolvedValueOnce(passReport);
    const repair = vi.fn().mockResolvedValue({
      operations: [{
        path: "majorCharacters.0.situation",
        action: "replace",
        valueJson: JSON.stringify("仍在寻找旧王冠"),
      }],
    });
    const validate = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("places.2.statusAtAnchor 必须是 accessible|hidden|sealed");
      })
      .mockImplementationOnce((deck) => deck);

    const result = await enforceGenesisQuality(input, { audit, repair, validate });

    expect(result.report.verdict).toBe("pass");
    expect(repair).toHaveBeenCalledTimes(2);
    expect(repair.mock.calls[1]![1].user).toContain("places.2.statusAtAnchor 必须是 accessible|hidden|sealed");
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("整项无依据正史对象必须删除，不能用模型生成的不完整对象替换", async () => {
    const original = completeDeck();
    const unsupportedGodReport: GenesisSemanticAuditResult = {
      verdict: "errors",
      issues: [{
        severity: "error",
        path: "majorGods[0]",
        type: "unsupported_canon_claim",
        explanation: "律法之神不存在于原作",
        evidenceRefs: ["forbiddenExpansions"],
        repairInstruction: "移除 majorGods[0]（律法之神）",
      }],
    };
    const audit = vi.fn()
      .mockResolvedValueOnce(unsupportedGodReport)
      .mockResolvedValueOnce(passReport);
    const repair = vi.fn().mockResolvedValue({
      operations: [{
        path: "majorGods[0]",
        action: "replace",
        valueJson: JSON.stringify({
          name: "另一个虚构神明",
          agenda: { stanceToPlayer: { level: "不明" } },
          abilities: [],
        }),
      }],
    });
    const validate = vi.fn().mockImplementation((deck) => deck);

    const result = await enforceGenesisQuality({
      ...qualityInput(),
      deck: original,
      mode: "pantheon",
    }, { audit, repair, validate });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0]![1].user).toContain('Required remove paths (must use action="remove"):\n["majorGods[3]"]');
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        majorGods: original.majorGods.slice(0, -1),
      }),
      "pantheon",
      null,
    );
    expect(result.deck.majorGods).toEqual(original.majorGods.slice(0, -1));
  });

  it("整个人物对象补丁保留结构字段，只采纳语义字段修改", async () => {
    const original = completeDeck();
    const originalCharacter = original.majorCharacters[3]!;
    const characterReport: GenesisSemanticAuditResult = {
      verdict: "errors",
      issues: [{
        severity: "error",
        path: "majorCharacters[3]",
        type: "anchor_state_leak",
        explanation: `${originalCharacter.name} 的当前处境提前泄漏未来事件`,
        evidenceRefs: ["futureOnly"],
        repairInstruction: "只修正当前处境，不修改人物结构与能力",
      }],
    };
    const audit = vi.fn()
      .mockResolvedValueOnce(characterReport)
      .mockResolvedValueOnce(passReport);
    const repair = vi.fn().mockResolvedValue({
      operations: [{
        path: "majorCharacters[3]",
        action: "replace",
        valueJson: JSON.stringify({
          ...originalCharacter,
          situation: "仍在等待开局事件发生",
          factionMemberships: [{ role: "未知" }],
          abilities: originalCharacter.abilities.map((ability) => ({
            ...ability,
            state: "正常",
          })),
        }),
      }],
    });
    const validate = vi.fn().mockImplementation((deck) => deck);

    const result = await enforceGenesisQuality({
      ...qualityInput(),
      deck: original,
      mode: "pantheon",
    }, { audit, repair, validate });

    expect(result.deck.majorCharacters[3]).toMatchObject({
      situation: "仍在等待开局事件发生",
      factionMemberships: originalCharacter.factionMemberships,
      abilities: originalCharacter.abilities,
    });
  });

  it("势力成员关系补丁丢弃不存在的势力引用", async () => {
    const original = completeDeck();
    const membershipReport: GenesisSemanticAuditResult = {
      verdict: "errors",
      issues: [{
        severity: "error",
        path: "majorCharacters[3].factionMemberships",
        type: "causal_disconnect",
        explanation: "该人物不应提前加入未来势力",
        evidenceRefs: ["futureOnly"],
        repairInstruction: "移除不存在或尚未加入的势力成员关系",
      }],
    };
    const audit = vi.fn()
      .mockResolvedValueOnce(membershipReport)
      .mockResolvedValueOnce(passReport);
    const repair = vi.fn().mockResolvedValue({
      operations: [{
        path: "majorCharacters[3].factionMemberships",
        action: "replace",
        valueJson: JSON.stringify([{
          factionRef: "gv2:pantheon:faction:04",
          role: "未来成员",
          isPrimary: true,
        }]),
      }],
    });

    const result = await enforceGenesisQuality({
      ...qualityInput(),
      deck: original,
      mode: "pantheon",
    }, {
      audit,
      repair,
      validate: vi.fn().mockImplementation((deck) => deck),
    });

    expect(result.deck.majorCharacters[3]!.factionMemberships).toEqual([]);
  });

  it.each([
    ["factions[1].keyCharacterRefs[0].ref", "unsupported_canon_claim"],
    ["majorCharacters[3].factionMemberships[0].factionRef", "causal_disconnect"],
  ] as const)("引用叶子问题 %s 强制删除整个关系项", async (path, type) => {
    const original = completeDeck();
    const report: GenesisSemanticAuditResult = {
      verdict: "errors",
      issues: [{
        severity: "error",
        path,
        type,
        explanation: "该引用在锚点时刻不成立",
        evidenceRefs: ["futureOnly"],
        repairInstruction: "移除错误引用",
      }],
    };
    const audit = vi.fn()
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce(passReport);
    const repair = vi.fn().mockResolvedValue({
      operations: [{ path, action: "replace", valueJson: JSON.stringify("") }],
    });

    const result = await enforceGenesisQuality({
      ...qualityInput(),
      deck: original,
      mode: "pantheon",
    }, {
      audit,
      repair,
      validate: vi.fn().mockImplementation((deck) => deck),
    });

    const expectedPath = path.replace(/\.(?:ref|factionRef)$/, "");
    expect(repair.mock.calls[0]![1].user).toContain(JSON.stringify(expectedPath));
    if (path.startsWith("factions")) {
      expect(result.deck.factions[1]!.keyCharacterRefs).toEqual([]);
    } else {
      expect(result.deck.majorCharacters[3]!.factionMemberships).toEqual([]);
    }
  });

  it("两次补丁都无法通过完整校验时抛出可分类的补丁校验错误", async () => {
    const input = qualityInput();
    const audit = vi.fn().mockResolvedValue(errorReport);
    const repair = vi.fn().mockResolvedValue({ operations: [] });
    const validate = vi.fn().mockImplementation(() => {
      throw new Error("势力引用 gv2:pantheon:faction:04 不存在");
    });

    await expect(enforceGenesisQuality(input, { audit, repair, validate }))
      .rejects.toMatchObject({
        name: "GenesisSemanticRepairValidationError",
        message: expect.stringContaining('patchDiagnostics={"issuePaths":[{"path":"majorCharacters.0.situation","type":"premise_drift"}],"operations":[]'),
      });
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it("只应用初审列出的修复路径，丢弃完整文档重写造成的无关漂移", async () => {
    const original = completeCreatorDeck();
    original.worldName = "原始世界名";
    original.cosmology.powerSystem = "原始且受支持的力量体系";
    original.majorCharacters[0]!.situation = "旧王冠已经归还";

    const bracketPathReport: GenesisSemanticAuditResult = {
      verdict: "errors",
      issues: [{
        ...errorReport.issues[0]!,
        path: "majorCharacters[0].situation",
      }],
    };
    const audit = vi.fn()
      .mockResolvedValueOnce(bracketPathReport)
      .mockImplementationOnce(async (deck) => {
        expect(deck.majorCharacters[0]!.situation).toBe("旧王冠仍处于失落状态");
        expect(deck.worldName).toBe("原始世界名");
        expect(deck.cosmology.powerSystem).toBe("原始且受支持的力量体系");
        return passReport;
      });
    const validate = vi.fn().mockImplementation((deck) => deck);
    const repair = vi.fn().mockImplementation(async (_slot, opts) => {
      const patch = {
        operations: [{
          path: "majorCharacters[0].situation",
          action: "replace",
          valueJson: JSON.stringify("旧王冠仍处于失落状态"),
        }],
      };
      expect(opts.schema.safeParse(patch).success).toBe(true);
      return patch;
    });

    const result = await enforceGenesisQuality({
      ...qualityInput(),
      deck: original,
    }, {
      audit,
      repair,
      validate,
    });

    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        worldName: "原始世界名",
        cosmology: expect.objectContaining({
          powerSystem: "原始且受支持的力量体系",
        }),
        majorCharacters: expect.arrayContaining([
          expect.objectContaining({ situation: "旧王冠仍处于失落状态" }),
        ]),
      }),
      "creator",
      null,
    );
    expect(result.deck.worldName).toBe("原始世界名");
  });

  it("首轮修复仍有阻断问题时继续第二轮有界修复", async () => {
    const original = completeCreatorDeck();
    original.majorCharacters[0]!.situation = "旧王冠已经归还";
    original.cosmology.powerSystem = "错误力量体系";

    const firstRepair = {
      operations: [{
        path: "majorCharacters.0.situation",
        action: "replace" as const,
        valueJson: JSON.stringify("旧王冠仍处于失落状态"),
      }],
    };
    const residualReport: GenesisSemanticAuditResult = {
      verdict: "errors",
      issues: [{
        severity: "error",
        path: "cosmology.powerSystem",
        type: "unsupported_canon_claim",
        explanation: "力量体系仍含错误设定",
        evidenceRefs: ["cosmology.powerSystem"],
        repairInstruction: "恢复受支持的力量体系",
      }],
    };
    const secondRepair = {
      operations: [{
        path: "cosmology.powerSystem",
        action: "replace" as const,
        valueJson: JSON.stringify("受支持的力量体系"),
      }],
    };

    const audit = vi.fn()
      .mockResolvedValueOnce(errorReport)
      .mockResolvedValueOnce(residualReport)
      .mockResolvedValueOnce(passReport);
    const repair = vi.fn()
      .mockResolvedValueOnce(firstRepair)
      .mockResolvedValueOnce(secondRepair);

    const result = await enforceGenesisQuality({
      ...qualityInput(),
      deck: original,
    }, {
      audit,
      repair,
      validate: vi.fn().mockImplementation((deck) => deck),
    });

    expect(repair).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(3);
    expect(result.deck.majorCharacters[0]!.situation).toBe("旧王冠仍处于失落状态");
    expect(result.deck.cosmology.powerSystem).toBe("受支持的力量体系");
    expect(result.report.meta).toMatchObject({ repaired: true, auditPasses: 3 });
  });

  it("audit 调用失败时原样向上传播且不 repair", async () => {
    const auditFailure = new Error("audit transport failed");
    const repair = vi.fn();

    await expect(enforceGenesisQuality(qualityInput(), {
      audit: vi.fn().mockRejectedValue(auditFailure),
      repair,
      validate: vi.fn(),
    })).rejects.toBe(auditFailure);
    expect(repair).not.toHaveBeenCalled();
  });

  it("五轮修复后的复审仍有 error 时抛携带最终 report 的安全 terminal error", async () => {
    const audit = vi.fn().mockResolvedValue(errorReport);
    const repair = vi.fn().mockResolvedValue({
      operations: [{
        path: "majorCharacters.0.situation",
        action: "replace",
        valueJson: JSON.stringify("旧王冠仍处于失落状态"),
      }],
    });
    let caught: unknown;

    try {
      await enforceGenesisQuality(qualityInput(), {
        audit,
        repair,
        validate: vi.fn().mockImplementation((deck) => deck),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GenesisSemanticGateError);
    expect((caught as GenesisSemanticGateError).report).toMatchObject<GenesisQualityReport>({
      verdict: "errors",
      issues: errorReport.issues,
      meta: {
        initialErrorCount: 1,
        initialWarningCount: 0,
        repaired: true,
        auditPasses: 6,
        durationMs: expect.any(Number),
      },
    });
    expect((caught as Error).message).toBe("创世语义修复后仍有阻断问题，已安全终止生成");
    expect((caught as Error).message).not.toContain("旧王冠已经归还");
    expect(isTransientLlmError(caught)).toBe(false);
    expect(repair).toHaveBeenCalledTimes(5);
    expect(audit).toHaveBeenCalledTimes(6);
  });
});
