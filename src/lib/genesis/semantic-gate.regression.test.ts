import { describe, expect, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { validateGenesisDeck } from "./generate";
import type { GenesisIntentContract } from "./intent";
import {
  auditGenesisSemantics,
  type GenesisSemanticAuditResult,
  type GenesisSemanticIssueType,
  type SemanticAuditDeps,
} from "./semantic-audit";
import {
  enforceGenesisQuality,
  GenesisSemanticRepairResultSchema,
  type GenesisQualityGateDeps,
} from "./semantic-gate";

const decree = "无职转生，但是鲁迪是托尼斯塔克转生";

const intent: GenesisIntentContract = {
  sourceBasis: "multi_ip",
  sourceIps: ["无职转生", "钢铁侠"],
  explicitPremise: ["鲁迪乌斯由托尼·斯塔克转生"],
  narrativeCenter: {
    identity: "托尼·斯塔克转生后的鲁迪乌斯",
    role: "转生主角",
    startState: "刚出生，仅保留人格、记忆与工程思维",
  },
  playerRole: {
    type: "independent_god",
    narrativeFunction: "limited_intervener",
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: ["独立贾维斯神格", "开局已有钢铁装甲"],
  factsAtAnchor: ["鲁迪乌斯刚出生"],
  futureOnly: ["建立工坊", "验证魔力能否驱动机械"],
  fusionBoundaries: ["工程知识只能提出假设，不能直接改写世界物理规律"],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["婴儿身体限制", "资源不足", "隐瞒成年意识", "谨慎改变历史"],
};

const issueTypes = [
  "narrative_center_duplication",
  "ontology_mismatch",
  "unsupported_canon_claim",
  "anchor_state_leak",
  "power_shortcut",
  "unsupported_fusion_rule",
  "causal_disconnect",
] satisfies GenesisSemanticIssueType[];

function limitedPlayerGod() {
  const base = completeDeck().playerGod;
  return {
    ...base,
    name: "微光守望者",
    origin: "独立于转生者的新生神明",
    domains: ["微弱启示"],
    rank: "nascent" as const,
    faithBase: "尚无稳定信徒",
    situation: "只能低调观察，偶尔以模糊征兆干预，不能替代主角行动",
    abilities: base.abilities.map((ability, index) => ({
      ...ability,
      name: `微光征兆${index + 1}`,
      effect: "提供一次含糊而有限的方向提示",
      trigger: "主角陷入无法自行察觉的危险时",
      cost: "消耗稀薄信仰并暴露神力痕迹",
      limitations: "不能提供成品、知识答案或代替主角完成选择",
    })),
  };
}

function malformedDeck() {
  const base = completeDeck();
  const jarvisGod = {
    ...base.majorGods[0],
    ref: "god-jarvis",
    name: "方舟智脑·贾维斯神格",
    aliases: ["机械叙事中枢"],
    domains: ["工程推演", "方舟管理"],
    provenance: {
      canonRelation: "generated_original" as const,
      evidence: ["由托尼记忆擅自神格化"],
    },
    abilities: base.majorGods[0].abilities.map((ability, index) => ({
      ...ability,
      ref: `ability-jarvis-${index + 1}`,
    })),
  };

  return PantheonWorldDeckSchema.parse({
    ...base,
    worldName: "无职转生·钢铁新生",
    fusionAxiom: {
      sourceIps: ["无职转生", "钢铁侠"],
      establishedRules: ["魔力回路即集成电路"],
      openQuestions: ["暂无"],
      hardLimits: ["暂无"],
      conflictRule: "斯塔克算法可以重构一切魔力",
    },
    playerGod: limitedPlayerGod(),
    majorGods: [...base.majorGods, jarvisGod],
    minorGods: [
      { name: "水神雷妲", brief: "水神流现任宗师" },
      { name: "剑神加尔·法里翁", brief: "剑神流现任宗师" },
    ],
    factions: base.factions.map((faction, index) => index === 0
      ? { ...faction, name: "阿斯福德领财政厅", overview: "负责征收领地税赋的正史机关" }
      : faction),
    majorCharacters: base.majorCharacters.map((character, index) => {
      if (index === 0) {
        return {
          ...character,
          name: "鲁迪乌斯·格雷拉特",
          aliases: ["托尼·斯塔克转生者"],
          identity: "托尼·斯塔克转生后的鲁迪乌斯",
          ageStage: "新生儿",
          goals: "以成年工程师意识立刻重建旧日成果",
          situation: "出生即掌握完整工程设施与未来人物情报",
        };
      }
      if (index === 1) return { ...character, name: "洛琪希", identity: "已确认的未来导师" };
      if (index === 2) return { ...character, name: "奥尔斯帝德", identity: "已识别的未来强者" };
      if (index === 3) return { ...character, name: "人神", identity: "已建立联系的幕后存在" };
      return character;
    }),
    relationsAtAnchor: [
      {
        sourceRef: "character-1",
        targetRef: "character-2",
        status: "ally",
        publicDescription: "新生儿已经确认洛琪希将成为未来导师",
      },
      {
        sourceRef: "character-1",
        targetRef: "character-3",
        status: "unknown",
        publicDescription: "新生儿已经识别奥尔斯帝德并预判未来接触",
      },
      {
        sourceRef: "character-1",
        targetRef: "character-4",
        status: "enemy",
        publicDescription: "新生儿出生时已经确认人神是幕后敌人",
      },
    ],
    places: base.places.map((place, index) => index === 0
      ? { ...place, name: "阿斯福德领地下秘密实验工坊" }
      : place),
    epochConflict: {
      ...base.epochConflict,
      overtConflicts: ["领地税赋征收引发贵族争议"],
      hiddenCurrents: ["种族偏见正在加剧"],
    },
    openingChapterBrief: {
      objective: "让新生儿直接完成微型方舟反应堆",
      viewpointCharacterRef: "character-1",
      openingConstraint: "从新生儿启动地下工坊并穿上钢铁装甲切入",
      endingConstraint: "以方舟反应堆稳定运转收束",
      readerKnows: ["地下工坊已经完工", "贾维斯神格可以独立行动"],
      viewpointKnows: ["完整装甲设计", "未来导师与幕后敌人的身份"],
      mustHide: [],
      hintOnly: [],
      forbiddenDevelopments: [],
    },
  });
}

function repairedDeck() {
  const base = completeDeck();
  return PantheonWorldDeckSchema.parse({
    ...base,
    worldName: "模型擅自改名",
    fusionAxiom: {
      sourceIps: ["无职转生", "钢铁侠"],
      establishedRules: ["托尼保留成年人格、记忆与工程思维"],
      openQuestions: ["魔力与电力能否转换尚待实验", "符文能否承载代码逻辑仍未证实"],
      hardLimits: ["未经验证不得宣称科技规律与魔法规律等价", "知识不能跳过材料、时间与失败成本"],
      conflictRule: "原作世界规律优先，跨体系效果必须由锚点后的实验建立",
    },
    playerGod: limitedPlayerGod(),
    majorGods: base.majorGods,
    minorGods: [],
    factions: base.factions,
    majorCharacters: base.majorCharacters.map((character, index) => index === 0
      ? {
        ...character,
        name: "鲁迪乌斯·格雷拉特",
        aliases: ["托尼·斯塔克转生者"],
        identity: "托尼·斯塔克转生后的鲁迪乌斯",
        ageStage: "新生儿",
        goals: "在身体限制下观察魔力并保护转生秘密",
        situation: "刚出生，只保留成年人格、记忆与工程思维，缺少资源与行动能力",
        divineTies: "只偶尔察觉微光守望者留下的模糊征兆",
      }
      : {
        ...character,
        name: ["保罗·格雷拉特", "塞妮丝·格雷拉特", "莉莉雅", "村中助产妇", "领地书记官"][index - 1],
        identity: "锚点时刻的普通配角",
        divineTies: "没有已确认的神秘接触",
      }),
    relationsAtAnchor: [{
      sourceRef: "character-1",
      targetRef: "character-2",
      status: "family",
      publicDescription: "新生儿与父亲的家庭关系",
    }],
    places: base.places.map((place, index) => index === 0
      ? { ...place, name: "格雷拉特家宅婴儿房", kind: "住宅", overview: "资源有限的普通婴儿房" }
      : place),
    epochConflict: {
      ...base.epochConflict,
      overtConflicts: ["成年意识受困于婴儿身体，只能在资源匮乏下隐藏异常并谨慎试探魔力"],
      hiddenCurrents: ["领地税赋争议只是外围背景，真正变化取决于转生者如何谨慎改变历史"],
    },
    openingChapterBrief: {
      objective: "让新生儿确认自己保留成年记忆，同时发现身体与资源限制",
      viewpointCharacterRef: "character-1",
      openingConstraint: "从无法控制身体的具体感受切入，只观察一个可验证的魔力迹象",
      endingConstraint: "以是否继续隐藏异常的选择收束，不完成任何成品科技",
      readerKnows: ["主角拥有成年意识与工程思维", "当前身体和资源都不足"],
      viewpointKnows: ["自己的前世记忆", "眼前观察到的有限现象"],
      mustHide: ["玩家神的完整意图"],
      hintOnly: ["魔力与工程知识也许存在可实验的联系"],
      forbiddenDevelopments: ["跳过实验与材料成本", "确认尚未发生的人物关系"],
    },
  });
}

const rawInitialAudit: GenesisSemanticAuditResult = {
  verdict: "warnings",
  issues: [
    {
      severity: "warning",
      path: "majorGods.4",
      type: "narrative_center_duplication",
      explanation: "独立贾维斯神格复制了托尼版鲁迪的机械叙事中心",
      evidenceRefs: ["god-jarvis", "character-1"],
      repairInstruction: "删除独立贾维斯神格，只保留托尼版鲁迪",
    },
    {
      severity: "warning",
      path: "minorGods",
      type: "ontology_mismatch",
      explanation: "水神与剑神是武术称号持有者，不是神性实体",
      evidenceRefs: [],
      repairInstruction: "从神谱移除武术称号持有者",
    },
    {
      severity: "warning",
      path: "factions.0.name",
      type: "unsupported_canon_claim",
      explanation: "阿斯福德领财政厅是无资料支持的正史断言",
      evidenceRefs: [],
      repairInstruction: "删除虚构正史机关并使用有依据或泛化描述",
    },
    {
      severity: "warning",
      path: "places.0.name",
      type: "anchor_state_leak",
      explanation: "出生锚点不应已有地下秘密实验设施",
      evidenceRefs: ["place-city"],
      repairInstruction: "改为出生时真实可用的普通地点",
    },
    {
      severity: "warning",
      path: "openingChapterBrief.objective",
      type: "power_shortcut",
      explanation: "新生儿直接完成反应堆跳过身体、资源和实验成本",
      evidenceRefs: ["character-1"],
      repairInstruction: "将首章目标限制为观察与提出可验证假设",
    },
    {
      severity: "warning",
      path: "fusionAxiom.establishedRules.0",
      type: "unsupported_fusion_rule",
      explanation: "魔力回路与集成电路的等价关系未经验证",
      evidenceRefs: [],
      repairInstruction: "移入待验证问题并声明硬限制",
    },
    {
      severity: "warning",
      path: "epochConflict.overtConflicts.0",
      type: "causal_disconnect",
      explanation: "税赋争议与转生前提只有低影响背景联系",
      evidenceRefs: [],
      repairInstruction: "把主冲突改为婴儿限制、资源、保密或谨慎改变历史",
    },
  ],
};

const residualPaths = [
  "majorGods",
  "minorGods",
  "factions",
  "majorCharacters",
  "relationsAtAnchor",
  "places",
  "epochConflict",
  "openingChapterBrief",
  "fusionAxiom",
] as const;

const rawResidualAudit: GenesisSemanticAuditResult = {
  verdict: "warnings",
  issues: residualPaths.map((path) => ({
    severity: "warning" as const,
    path,
    type: "premise_drift" as const,
    explanation: `${path} 仍保留与冻结前提冲突的关联内容`,
    evidenceRefs: [path],
    repairInstruction: `仅修复 ${path} 中残留的锚点偏移`,
  })),
};

describe("Tony-as-Rudeus semantic quality regression", () => {
  it("repairs the exact malformed crossover deck across two bounded rounds", async () => {
    const badDeck = malformedDeck();
    const repairOutput = repairedDeck();
    expect(PantheonWorldDeckSchema.safeParse(badDeck).success).toBe(true);
    expect(PantheonWorldDeckSchema.safeParse(repairOutput).success).toBe(true);

    const complete = vi.fn<SemanticAuditDeps["complete"]>()
      .mockResolvedValueOnce(rawInitialAudit)
      .mockResolvedValueOnce(rawResidualAudit)
      .mockResolvedValueOnce({ verdict: "pass", issues: [] });
    let auditPass = 0;
    let normalizedInitialAudit: GenesisSemanticAuditResult | undefined;
    const audit = vi.fn<GenesisQualityGateDeps["audit"]>(async (deck, options) => {
      auditPass += 1;
      const report = await auditGenesisSemantics(deck, options, { complete });
      if (auditPass === 1) normalizedInitialAudit = report;
      return report;
    });
    let repairPass = 0;
    const repair = vi.fn<GenesisQualityGateDeps["repair"]>(async (slot, request) => {
      expect(slot).toBe("narrative");
      expect(request.schema).toBe(GenesisSemanticRepairResultSchema);
      const issues = repairPass === 0 ? rawInitialAudit.issues : rawResidualAudit.issues;
      if (repairPass === 0) {
        for (const type of issueTypes) expect(request.user).toContain(type);
      }
      repairPass += 1;
      return {
        operations: issues.map((issue) => {
          const segments = issue.path.match(/[^.[\]]+/g) ?? [];
          const value = segments.reduce<unknown>(
            (current, segment) => current && typeof current === "object"
              ? (current as Record<string, unknown>)[segment]
              : undefined,
            repairOutput,
          );
          return value === undefined
            ? { path: issue.path, action: "remove" as const, valueJson: null }
            : { path: issue.path, action: "replace" as const, valueJson: JSON.stringify(value) };
        }),
      };
    });
    const validate = vi.fn<GenesisQualityGateDeps["validate"]>((rawDeck, mode, snapshot) => {
      expect(rawDeck).toMatchObject({ worldName: badDeck.worldName });
      return validateGenesisDeck(rawDeck, mode, snapshot);
    });

    const result = await enforceGenesisQuality({
      deck: badDeck,
      mode: "pantheon",
      decree,
      intent,
      userId: "regression-user",
      materialSnapshot: null,
      currentDeck: badDeck,
      lockedPaths: ["worldName"],
    }, { audit, repair, validate });

    const initialIssues = normalizedInitialAudit?.issues ?? [];
    const initialTypes = initialIssues.map(({ type }) => type);
    expect(initialTypes).toEqual(expect.arrayContaining(issueTypes));
    for (const issue of initialIssues) {
      expect(issue.severity).toBe(issue.type === "causal_disconnect" ? "warning" : "error");
    }

    expect(audit).toHaveBeenCalledTimes(3);
    expect(audit.mock.calls[0]?.[0]).toEqual(badDeck);
    expect(audit.mock.calls[2]?.[0]).toEqual(result.deck);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(repair).toHaveBeenCalledTimes(2);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(validate).toHaveBeenLastCalledWith(
      expect.objectContaining({ worldName: badDeck.worldName }),
      "pantheon",
      null,
    );
    expect(result.deck).toEqual({ ...repairOutput, worldName: badDeck.worldName });
    expect(result.report).toMatchObject({
      verdict: "pass",
      meta: {
        initialErrorCount: 6,
        initialWarningCount: 1,
        repaired: true,
        auditPasses: 3,
      },
    });
    if (result.deck.mode !== "pantheon") {
      throw new Error("回归修复必须保留 pantheon 模式");
    }
    const finalDeck = result.deck;

    const narrativeCenters = finalDeck.majorCharacters.filter((character) =>
      /托尼|鲁迪/.test(`${character.name}${character.aliases.join("")}${character.identity}`),
    );
    expect(narrativeCenters).toHaveLength(1);
    expect(narrativeCenters[0]).toMatchObject({
      name: "鲁迪乌斯·格雷拉特",
      identity: "托尼·斯塔克转生后的鲁迪乌斯",
      ageStage: "新生儿",
    });
    expect(finalDeck.playerGod).toMatchObject({
      name: "微光守望者",
      origin: "独立于转生者的新生神明",
      rank: "nascent",
      faithBase: "尚无稳定信徒",
    });
    expect(finalDeck.playerGod.abilities.every(({ limitations }) =>
      limitations.includes("不能提供成品") && limitations.includes("代替主角"),
    )).toBe(true);

    const godLists = JSON.stringify({
      playerGod: finalDeck.playerGod,
      majorGods: finalDeck.majorGods,
      minorGods: finalDeck.minorGods,
    });
    expect(godLists).not.toMatch(/贾维斯/);
    expect(godLists).not.toMatch(/水神|剑神/);

    const anchorState = JSON.stringify({
      playerGod: finalDeck.playerGod,
      majorCharacters: finalDeck.majorCharacters,
      relationsAtAnchor: finalDeck.relationsAtAnchor,
      places: finalDeck.places,
      openingChapterBrief: finalDeck.openingChapterBrief,
    });
    expect(anchorState).not.toMatch(/工坊|装甲|反应堆|未来导师|奥尔斯帝德|人神/);
    expect(finalDeck.fusionAxiom).toMatchObject({
      openQuestions: ["魔力与电力能否转换尚待实验", "符文能否承载代码逻辑仍未证实"],
      hardLimits: ["未经验证不得宣称科技规律与魔法规律等价", "知识不能跳过材料、时间与失败成本"],
    });
    expect(finalDeck.epochConflict.overtConflicts).toHaveLength(1);
    expect(finalDeck.epochConflict.overtConflicts[0]).toMatch(/成年意识|婴儿身体|资源匮乏|隐藏异常|谨慎/);
  });
});
