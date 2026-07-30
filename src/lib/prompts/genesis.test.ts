import { describe, expect, it } from "vitest";
import {
  genesisRepairPrompt,
  genesisSystem,
  genesisUserPrompt,
  rerollReferenceRepairPrompt,
  rerollUserPrompt,
} from "./genesis";

const crossoverIntent = {
  sourceBasis: "multi_ip" as const,
  sourceIps: ["无职转生", "钢铁侠"],
  explicitPremise: ["鲁迪乌斯由托尼·斯塔克转生"],
  narrativeCenter: {
    identity: "托尼·斯塔克转生后的鲁迪乌斯",
    role: "转生主角",
    startState: "刚出生，仅保留人格、记忆与工程思维",
  },
  playerRole: {
    type: "independent_god" as const,
    narrativeFunction: "limited_intervener" as const,
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: ["独立贾维斯神格", "开局已有钢铁装甲"],
  factsAtAnchor: ["鲁迪乌斯刚出生"],
  futureOnly: ["建立工坊", "验证魔力能否驱动机械"],
  fusionBoundaries: ["工程知识只能提出假设，不能直接改写世界物理规律"],
  uncertaintyPolicy: "omit_or_generalize" as const,
  corePressures: ["婴儿身体限制", "隐瞒成年意识"],
};

describe("genesis mode prompts", () => {
  it("pantheon 保留玩家神规则和 pantheon schema", () => {
    const prompt = genesisSystem("pantheon");
    expect(prompt).toContain("PLAYER GOD");
    expect(prompt).toContain("Guilliman");
    expect(prompt).toContain("overflow becomes one-line minorGods");
    expect(prompt).toContain("epochConflict.hiddenCurrents");
    expect(prompt).toContain("NEVER cast the player as a mortal");
    expect(prompt).toContain('mode="pantheon"');
    expect(prompt).toMatch(/mode, worldName/);
  });

  it("系统提示词约束 IP 神谱、融合事实、锚点资产与核心冲突", () => {
    const system = genesisSystem("pantheon");
    expect(system).toContain("1-5");
    expect(system).toContain("never pad the pantheon");
    expect(system).toContain("a title containing 神 is not evidence of divinity");
    expect(system).toContain("establishedRules");
    expect(system).toContain("openQuestions");
    expect(system).toContain("hardLimits");
    expect(system).toContain("anchor-time asset test");
    expect(system).toContain("decree deletion test");
    expect(system).toContain("If an IP has more than 5 qualifying true gods, the overflow becomes one-line minorGods");
    expect(system).toContain("Original worlds target 4-9 major gods");
    expect(system).toContain("If an original world has more than 9 qualifying true gods, the overflow becomes one-line minorGods");
  });

  it("creator 将玩家置于世界外并禁止 playerGod", () => {
    const prompt = genesisSystem("creator");
    expect(prompt).toContain("outside the world");
    expect(prompt).toContain("not a god, character, faction, force, hidden entity, or worship target");
    expect(prompt).toContain("Never create playerGod");
    expect(prompt).toContain("world-internal gods");
    expect(prompt).toContain('mode="creator"');
    expect(prompt).not.toContain('"playerGod"');
  });

  it("两种模式都注入将临之事规则并把 canonEvents 排在 epochConflict 与 style 之间", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = genesisSystem(mode);
      expect(prompt).toContain("CANON FUTURE EVENTS (将临之事)");
      expect(prompt).toContain("ordinal starting at 1, strictly increasing");
      expect(prompt).toContain("epochConflict, openingChapterBrief, canonEvents, style, theme");
    }
  });

  it("两种模式都要求动态世界、因果压力、信息边界和首章桥接", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = genesisSystem(mode);
      expect(prompt).toContain("LIVING WORLD CONTRACT");
      expect(prompt).toContain("off-screen next move");
      expect(prompt).toContain("objective, obstacle, trigger, and consequence");
      expect(prompt).toContain("INFORMATION BOUNDARIES");
      expect(prompt).toContain("openingChapterBrief");
      expect(prompt).toContain("viewpointCharacterRef");
      expect(prompt).toContain("advance exactly one small causal node");
      expect(prompt).toContain("epochConflict, openingChapterBrief, canonEvents, style, theme");
    }
  });

  it("两种模式都注入时间锚点规则并把 temporalAnchor 排在 worldName 之后", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = genesisSystem(mode);
      expect(prompt).toContain("TEMPORAL ANCHOR FIRST");
      expect(prompt).toContain("emit temporalAnchor immediately after worldName");
      expect(prompt).toContain('anchorType "main_story_opening"');
      expect(prompt).toContain("canon events after the cutoff have NOT happened in this world yet");
      expect(prompt).toContain('for basis "original", canonCutoff MUST be null');
      expect(prompt).toContain("integer ordinals are the ONLY machine-checked time");
      expect(prompt).toContain("worldName, temporalAnchor, cosmology");
    }
  });

  it("两种模式都注入锚点当前态规则与权威顺序", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = genesisSystem(mode);
      expect(prompt).toContain("CURRENT STATE ONLY");
      expect(prompt).toContain("AS OF the anchor moment");
      expect(prompt).toContain("statusAtAnchor");
      expect(prompt).toContain(
        "explicit player statements > player-uploaded lorebook > the locked temporal anchor > events of this playthrough > your own canon knowledge > your free speculation",
      );
      expect(prompt).toContain("strictly greater than anchorOrdinal");
      expect(prompt).toContain("Generate 4–12 majorCharacters");
    }
  });

  it("两种模式都注入阶段 2 快照/关系/溯源规则并把 relationsAtAnchor 排在 majorCharacters 之后", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = genesisSystem(mode);
      expect(prompt).toContain("ANCHOR SNAPSHOTS");
      expect(prompt).toContain("stateAtAnchor");
      expect(prompt).toContain("BOUNDED RELATIONS");
      expect(prompt).toContain("1-4 anchor-relevant relations PER active major character");
      expect(prompt).toContain("MUST set memorial: true");
      expect(prompt).toContain("PROVENANCE (IP worlds only)");
      expect(prompt).toContain('When basis is "original", omit provenance everywhere');
      expect(prompt).toContain("majorCharacters, relationsAtAnchor, epochConflict");
    }
  });

  it("两种模式都注入卡组自身的反套话纪律", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = genesisSystem(mode);
      expect(prompt).toContain("may appear at most 6 times combined");
      expect(prompt).toContain("may appear at most ONCE per deck");
      expect(prompt).toContain("『神力消耗』 may be used as a cost at most twice per deck");
      expect(prompt).toContain("META-LANGUAGE BOUNDARY");
      expect(prompt).toContain("must use in-world designations instead");
    }
    expect(genesisSystem("pantheon")).toContain(
      "a plain speakable line in that god's daily register",
    );
  });

  it("用户与修补提示词显式冻结模式", () => {
    expect(genesisUserPrompt({ mode: "creator", decree: "造一个世界" })).toContain('mode="creator"');
    const repair = genesisRepairPrompt({
      mode: "creator",
      decree: "造一个世界",
      invalidOutput: "{}",
      validationError: "缺字段",
    });
    expect(repair).toContain("Never introduce playerGod");
    expect(repair).toContain("preserving valid content");
    expect(repair).toContain("locked path");
    expect(repair).toContain("do not reveal hidden material");
  });

  it("Creator 重掷与引用修补 prompt 冻结模式并禁止玩家神字段", () => {
    const reroll = rerollUserPrompt({
      mode: "creator",
      decree: "创造星海",
      cardKey: "majorGods",
      currentDeckJson: '{"mode":"creator"}',
    });
    const repair = rerollReferenceRepairPrompt({
      mode: "creator",
      decree: "创造星海",
      currentDeckJson: '{"mode":"creator"}',
      referenceIssue: "relation missing",
    });
    expect(reroll).toContain('mode="creator"');
    expect(reroll).toContain("Never add playerGod");
    expect(repair).toContain('mode="creator"');
    expect(repair).toContain("Never introduce playerGod");
  });

  it("生成、结构修补、重掷与引用修补都携带冻结意图契约", () => {
    const prompts = [
      genesisUserPrompt({
        mode: "pantheon",
        decree: "创世",
        intentContract: crossoverIntent,
      }),
      genesisRepairPrompt({
        mode: "pantheon",
        decree: "创世",
        invalidOutput: "{}",
        validationError: "缺字段",
        intentContract: crossoverIntent,
      }),
      rerollUserPrompt({
        mode: "pantheon",
        decree: "创世",
        cardKey: "majorGods",
        currentDeckJson: "{}",
        intentContract: crossoverIntent,
      }),
      rerollReferenceRepairPrompt({
        mode: "pantheon",
        decree: "创世",
        currentDeckJson: "{}",
        referenceIssue: "引用无效",
        intentContract: crossoverIntent,
      }),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain("FROZEN GENESIS INTENT CONTRACT");
      expect(prompt).toContain("托尼·斯塔克转生后的鲁迪乌斯");
      expect(prompt).toContain("omit_or_generalize");
    }
    expect(genesisUserPrompt({
      mode: "pantheon",
      decree: "创世",
      intentContract: "预序列化契约",
    })).toContain("预序列化契约");
  });
});
