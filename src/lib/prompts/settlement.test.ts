import { describe, expect, it } from "vitest";
import {
  ChapterSettlementSchema,
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
});
