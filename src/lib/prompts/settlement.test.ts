import { describe, expect, it } from "vitest";
import {
  ChapterSettlementSchema,
  CreatorChapterSettlementSchema,
  SettlementWorldActivitySchema,
  chapterSettlementSchema,
  settlementSystem,
  settlementUserPrompt,
} from "./settlement";

describe("ChapterSettlementSchema", () => {
  it("拒绝缺少证据字段的能力变化，避免单次响应静默丢技能", () => {
    const parsed = ChapterSettlementSchema.safeParse({
      pantheonTurns: [],
      extraction: {
        newEntities: [], newGods: [], entityUpdates: [], godUpdates: [],
        revealSections: [], majorCharacterPromotions: [],
        abilityChanges: [{ ownerName: "阿岚", type: "learned" }],
      },
      chronicle: { entries: [{ yearLabel: "元年", text: "盐潮越过旧堤。", entityNames: ["盐沼城"], godNames: ["潮神"] }], epilogue: "终", chapterTitle: "终章" },
    });
    expect(parsed.success).toBe(false);
  });

  it("接受同一次整理中的动态合并、事件升级、解决和派生", () => {
    const parsed = SettlementWorldActivitySchema.parse({
      mergeActivityIds: ["activity-a", "activity-b"],
      eventMutations: [
        {
          operation: "create",
          sourceActivityIds: ["activity-a", "activity-b"],
          kind: "war",
          title: "盐路之战",
          summary: "港口冲突已升级为持续战争。",
          phase: "escalating",
          participantIds: ["god-tide", "entity-port"],
          visibility: "public",
        },
        {
          operation: "advance",
          eventId: "event-war",
          phase: "resolved",
          summary: "双方签订停战约。",
          participantIds: ["god-tide", "entity-port"],
          visibility: "public",
          progressText: "盐路之战正式结束。",
        },
        {
          operation: "derive",
          parentEventId: "event-war",
          title: "港口复兴",
          kind: "faction_shift",
          summary: "停战后的港口势力重新洗牌。",
          participantIds: ["entity-port"],
          visibility: "player_known",
        },
      ],
    });

    expect(parsed.eventMutations.map((mutation) => mutation.operation)).toEqual([
      "create",
      "advance",
      "derive",
    ]);
  });
});


describe("creator settlement contract", () => {
  const base = {
    godName: "潮神",
    action: { description: "令海潮侵入盐沼", targets: ["盐沼城"] },
    omen: "井水泛咸",
    agendaUpdate: { shortTermGoals: ["控制盐路"], schemes: ["扶植海商"] },
    relationsUpdate: [{ target: "炉神", label: "rival", note: "争夺盐路" }],
    proactiveEvent: { type: "envoy", openingHook: "潮神使者抵达炉神殿" },
  };
  const envelope = (turn: Record<string, unknown>) => ({
    pantheonTurns: [turn],
    extraction: {
      newEntities: [], newGods: [], entityUpdates: [], godUpdates: [],
      revealSections: [], majorCharacterPromotions: [], abilityChanges: [],
    },
    chronicle: { entries: [{ yearLabel: "元年", text: "盐潮越过旧堤。", entityNames: ["盐沼城"], godNames: ["潮神"] }], epilogue: "潮声未止", chapterTitle: "盐潮" },
  });

  it("creator turns reject stanceToPlayer while allowing internal proactive targets", () => {
    expect(chapterSettlementSchema("creator").safeParse(envelope(base)).success).toBe(true);
    expect(chapterSettlementSchema("creator").safeParse(envelope({
      ...base,
      agendaUpdate: { ...base.agendaUpdate, stanceToPlayer: { level: "hostility", motive: "敌视玩家" } },
    })).success).toBe(false);
  });

  it("defines relation targets as exact world-internal god names or aliases only", () => {
    const system = settlementSystem("creator");
    expect(system).toContain("exact god name or alias");
    expect(system).toContain("never an entity name");
  });

  it("世界整理提示词不要求玩家可见章节或章题", () => {
    const prompt = settlementSystem("creator");
    expect(prompt).toContain("checkpoint window");
    expect(prompt).toContain("world-settlement");
    expect(prompt).not.toContain("chapter-settlement engine");
    expect(prompt).not.toContain("4-8 character chapter title");
  });

  it("世界整理明确抽取成功研发或首次稳定施展的可复用新能力", () => {
    const prompt = settlementSystem("creator");

    expect(prompt).toContain("成功研发");
    expect(prompt).toContain("正式命名");
    expect(prompt).toContain("首次稳定施展");
    expect(prompt).toContain("法术、战技或工程战斗技术");
    expect(prompt).toContain("单次环境偶发");
    expect(prompt).toContain("不得登记为能力");
  });

  it("creator prompt treats observations as world-external and turns as internal", () => {
    const system = settlementSystem("creator");
    const user = settlementUserPrompt({
      mode: "creator", chapterMessages: "【创世主意图】看向盐沼", scaleNote: "场景",
      eraSystem: "纪元", currentYearLabel: "元年", entities: "盐沼城", gods: "潮神",
      abilities: "覆潮", lockedPaths: "—",
    });
    expect(system).toContain("world-external Creator");
    expect(system).toContain("world-internal gods or entities");
    expect(system).toContain("never produce stanceToPlayer");
    expect(system).not.toContain("required when an action directly targets the player god");
    expect(system).not.toContain("含玩家神");
    expect(user).toContain("【创世主意图】");
  });

  it("retains pantheon player-god settlement semantics", () => {
    const prompt = settlementSystem("pantheon");
    expect(prompt).toContain("directly targets the player god");
    expect(prompt).toContain("pantheonTurns");
  });

  it("只允许按输入 ID 合并、升级、解决或派生事件", () => {
    const system = settlementSystem("creator");
    const user = settlementUserPrompt({
      mode: "creator",
      chapterMessages: "[message-1 | 1 | scene]\n盐潮越过旧堤。",
      scaleNote: "场景",
      eraSystem: "纪元",
      currentYearLabel: "元年",
      entities: "盐沼城 [entity-port]",
      gods: "潮神 [god-tide]",
      abilities: "—",
      lockedPaths: "—",
      worldActivity: [
        "CHECKPOINT ACTIVITIES:",
        "activity-a | conflict | 盐商在北港械斗",
        "UNRESOLVED EVENTS:",
        "event-war | war | developing | 盐路冲突",
      ].join("\n"),
    });

    expect(system).toContain("merge duplicate activities");
    expect(system).toContain("derive");
    expect(system).toContain("Never guess an activity or event ID");
    expect(user).toContain("activity-a");
    expect(user).toContain("event-war");
    expect(user).toContain("CHECKPOINT WORLD ACTIVITY");
  });

  it("要求整理正文明确改变的人物关系和整栏内容，不凭空补全", () => {
    const system = settlementSystem("creator");

    expect(system).toContain("character relation");
    expect(system).toContain("exact known character name or alias");
    expect(system).toContain("directional");
    expect(system).toContain("whole section");
    expect(system).toContain("explicitly changed");
    expect(system).toContain("Never invent");
  });

  it("抽取规则声明既存关系图谱只报增量，不复读未变关系", () => {
    const system = settlementSystem("creator");

    expect(system).toContain(
      "EXISTING RELATIONS lines show the stored graph; never re-emit an unchanged listed relation.",
    );
  });
});

describe("era digest settlement contract", () => {
  it.each(["pantheon", "creator"] as const)("%s 系统词含 ERA TO CLOSE 指令且序列化 schema 含 eraDigest", (mode) => {
    const system = settlementSystem(mode);

    expect(system).toContain("When an == ERA TO CLOSE == block is supplied, additionally fill chronicle.eraDigest");
    expect(system).toContain("Otherwise omit eraDigest.");
    expect(system).toContain("\"eraDigest\"");
    expect(system).toContain("closedEra");
  });

  const baseOpts = {
    mode: "pantheon" as const,
    chapterMessages: "【玩家神谕】看向盐沼",
    scaleNote: "场景",
    eraSystem: "纪元",
    currentYearLabel: "元年",
    entities: "盐沼城",
    gods: "潮神",
    abilities: "—",
    lockedPaths: "—",
  };

  it("settlementUserPrompt 传 eraToClose 时渲染 ERA TO CLOSE 块", () => {
    const user = settlementUserPrompt({
      ...baseOpts,
      eraToClose: "The chronicle lines below belong to the era that ended within this checkpoint. Distill them into chronicle.eraDigest.\n[元年] 盐潮越过旧堤。",
    });

    expect(user).toContain("== ERA TO CLOSE (compress into chronicle.eraDigest) ==");
    expect(user).toContain("[元年] 盐潮越过旧堤。");
  });

  it("settlementUserPrompt 不传 eraToClose 时不出现 ERA TO CLOSE 块", () => {
    expect(settlementUserPrompt(baseOpts)).not.toContain("ERA TO CLOSE");
  });
});

describe("settlement clock contract", () => {
  const baseOpts = {
    mode: "pantheon" as const,
    chapterMessages: "【玩家神谕】看向盐沼",
    scaleNote: "数年跨度",
    eraSystem: "纪元",
    currentYearLabel: "元年",
    entities: "盐沼城",
    gods: "潮神",
    abilities: "—",
    lockedPaths: "—",
  };

  it("settlementUserPrompt 传 timeBudget 时渲染 TIME BUDGET 块并禁止自造历法", () => {
    const user = settlementUserPrompt({ ...baseOpts, timeBudget: "数年跨度" });

    expect(user).toContain("== TIME BUDGET ==");
    expect(user).toContain("This checkpoint window spans 数年跨度");
    expect(user).toContain("never invent a rival calendar");
  });

  it("settlementUserPrompt 不传 timeBudget 时不出现 TIME BUDGET 块", () => {
    expect(settlementUserPrompt(baseOpts)).not.toContain("TIME BUDGET");
  });

  it("settlementUserPrompt 传 chosenMortals 时渲染 CHOSEN MORTALS 块并要求逐一表态", () => {
    const user = settlementUserPrompt({
      ...baseOpts,
      chosenMortals: "阿岚 [entity-1] lifespan=未记",
    });

    expect(user).toContain("== CHOSEN MORTALS (lifespan adjudication required) ==");
    expect(user).toContain("阿岚 [entity-1] lifespan=未记");
    expect(user).toContain("chosenLifespanChecks");
  });

  it("settlementUserPrompt 不传 chosenMortals 时不出现 CHOSEN MORTALS 块", () => {
    expect(settlementUserPrompt(baseOpts)).not.toContain("CHOSEN MORTALS");
  });

  it("divineCostAudit 审计任务仅出现在 pantheon 系统词", () => {
    const pantheon = settlementSystem("pantheon");

    expect(pantheon).toContain("divineCostAudit");
    expect(pantheon).toContain("世间暗记");
    expect(settlementSystem("creator")).not.toContain("divineCostAudit");
  });

  const clockEnvelope = {
    pantheonTurns: [],
    extraction: {
      newEntities: [], newGods: [], entityUpdates: [], godUpdates: [],
      revealSections: [], majorCharacterPromotions: [], abilityChanges: [],
    },
    chronicle: { entries: [{ yearLabel: "元年", text: "盐潮越过旧堤。", entityNames: [], godNames: [] }], epilogue: "终", chapterTitle: "" },
  };

  it("ChapterSettlementSchema 兼容缺省 divineCostAudit 的旧 pendingSettlement（断点恢复回归）", () => {
    const parsed = ChapterSettlementSchema.parse(clockEnvelope);

    expect(parsed.divineCostAudit).toBeUndefined();
    expect(parsed.extraction.chosenLifespanChecks).toEqual([]);
  });

  it("接受合法 divineCostAudit 并拒绝非法 verdict", () => {
    const parsed = ChapterSettlementSchema.parse({
      ...clockEnvelope,
      divineCostAudit: [{ abilityName: "覆潮", verdict: "dodged", note: "河谷的井水一夜转咸。" }],
    });

    expect(parsed.divineCostAudit).toEqual([
      { abilityName: "覆潮", verdict: "dodged", note: "河谷的井水一夜转咸。" },
    ]);
    expect(ChapterSettlementSchema.safeParse({
      ...clockEnvelope,
      divineCostAudit: [{ abilityName: "覆潮", verdict: "ignored", note: "非法裁决" }],
    }).success).toBe(false);
  });
});

describe("canon settlement contract", () => {
  it.each(["pantheon", "creator"] as const)("%s 系统词含 canonEventUpdates 裁决任务与作者侧防泄露规则", (mode) => {
    const system = settlementSystem(mode);

    expect(system).toContain("canonEventUpdates:");
    expect(system).toContain("IMPENDING CANON EVENTS are author-only");
    expect(system).toContain("pressure, not a script");
  });

  const baseOpts = {
    mode: "pantheon" as const,
    chapterMessages: "【玩家神谕】看向盐沼",
    scaleNote: "场景",
    eraSystem: "纪元",
    currentYearLabel: "元年",
    entities: "盐沼城",
    gods: "潮神",
    abilities: "—",
    lockedPaths: "—",
  };

  it("settlementUserPrompt 传 canonEvents 时渲染 IMPENDING CANON EVENTS 块", () => {
    const user = settlementUserPrompt({
      ...baseOpts,
      canonEvents: "[canon-blood-moon] ordinal=1 status=pending | 血月盟约（三年后的血月）: 山民与盐商缔约。 | prerequisites=[]",
    });

    expect(user).toContain("== IMPENDING CANON EVENTS (author-only; never quote verbatim) ==");
    expect(user).toContain("[canon-blood-moon] ordinal=1 status=pending");
  });

  it("settlementUserPrompt 不传 canonEvents 时不出现 IMPENDING CANON EVENTS 块", () => {
    expect(settlementUserPrompt(baseOpts)).not.toContain("== IMPENDING CANON EVENTS");
  });

  const canonEnvelope = {
    pantheonTurns: [],
    extraction: {
      newEntities: [], newGods: [], entityUpdates: [], godUpdates: [],
      revealSections: [], majorCharacterPromotions: [], abilityChanges: [],
    },
    chronicle: { entries: [{ yearLabel: "元年", text: "盐潮越过旧堤。", entityNames: [], godNames: [] }], epilogue: "终", chapterTitle: "" },
  };

  it("两种模式 schema 均兼容缺省 canonEventUpdates 的旧 pendingSettlement（默认 []）", () => {
    expect(ChapterSettlementSchema.parse(canonEnvelope).canonEventUpdates).toEqual([]);
    expect(CreatorChapterSettlementSchema.parse(canonEnvelope).canonEventUpdates).toEqual([]);
  });

  it("拒绝 status 为 pending 的将临之事更新（状态机不允许回退未裁决）", () => {
    const parsed = ChapterSettlementSchema.safeParse({
      ...canonEnvelope,
      canonEventUpdates: [{ ref: "canon-blood-moon", status: "pending", note: "不得回退" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("接受 eligible 携带传闻与 occurred 无传闻的合法更新", () => {
    const parsed = ChapterSettlementSchema.parse({
      ...canonEnvelope,
      canonEventUpdates: [
        { ref: "canon-blood-moon", status: "eligible", note: "停战已成，前提俱备。", rumor: "盐道旅人传言血月之下将有大事。" },
        { ref: "canon-gate-fall", status: "occurred", note: "正文已明写山门倾覆。" },
      ],
    });

    expect(parsed.canonEventUpdates).toHaveLength(2);
    expect(parsed.canonEventUpdates[0]).toMatchObject({ status: "eligible", rumor: "盐道旅人传言血月之下将有大事。" });
  });
});
