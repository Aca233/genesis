import { describe, expect, it } from "vitest";
import { ChapterSettlementSchema, chapterSettlementSchema, settlementSystem, settlementUserPrompt } from "./settlement";

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

  it("creator prompt treats observations as world-external and turns as internal", () => {
    const system = settlementSystem("creator");
    const user = settlementUserPrompt({
      mode: "creator", chapterMessages: "【天外观测】看向盐沼", scaleNote: "场景",
      eraSystem: "纪元", currentYearLabel: "元年", entities: "盐沼城", gods: "潮神",
      abilities: "覆潮", lockedPaths: "—",
    });
    expect(system).toContain("world-external Creator");
    expect(system).toContain("world-internal gods or entities");
    expect(system).toContain("never produce stanceToPlayer");
    expect(system).not.toContain("required when an action directly targets the player god");
    expect(system).not.toContain("含玩家神");
    expect(user).toContain("【天外观测】");
  });

  it("retains pantheon player-god settlement semantics", () => {
    const prompt = settlementSystem("pantheon");
    expect(prompt).toContain("directly targets the player god");
    expect(prompt).toContain("pantheonTurns");
  });
});
