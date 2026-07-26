import { describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { PantheonWorldDeckSchema, type PantheonWorldDeck } from "@/lib/cards/schemas";
import {
  collectTemporalIssues,
  TemporalConsistencyError,
  validateTemporalConsistency,
  type TemporalConsistencyDeckView,
  type TemporalIssueCode,
} from "./temporal-validator";

function ipTemporalAnchorCard() {
  return {
    source: {
      basis: "single_ip" as const,
      sourceIps: ["测试原作"],
      continuity: "原著小说线",
      continuitySource: "model_inferred" as const,
      ambiguityNotes: [],
    },
    anchor: {
      anchorType: "main_story_opening" as const,
      currentTimeLabel: "裂光元年冬",
      currentEraLabel: "裂光纪",
      anchorEvent: "主线开幕前夜，晨钟尚未鸣响",
      canonCutoff: "原著第一卷开幕之前" as string | null,
      selectionSource: "model_inferred" as const,
      confidence: "high" as const,
      assumptions: ["神谕未指定时期，默认主线前夕"],
    },
    anchorOrdinal: 0,
  };
}

function originalTemporalAnchorCard() {
  return {
    source: { basis: "original" as const, ambiguityNotes: [] },
    anchor: {
      ...ipTemporalAnchorCard().anchor,
      anchorType: "original_present" as const,
      canonCutoff: null as string | null,
      selectionSource: "player_explicit" as const,
      assumptions: [],
    },
    anchorOrdinal: 0,
  };
}

/** 携带 IP 锚点卡、经 schema 全量解析的合法卡组。 */
function anchoredDeck(): PantheonWorldDeck {
  return PantheonWorldDeckSchema.parse({
    ...completeDeck(),
    temporalAnchor: ipTemporalAnchorCard(),
  });
}

/** 引用均落在 completeDeck 稳定 ref 上的合法将临之事（schema 可解析）。 */
function validCanonEvents() {
  return [
    {
      ref: "canon-event-1",
      title: "旧神苏醒的前兆",
      timeLabel: "三年后的血月",
      ordinal: 1,
      epoch: "future" as const,
      summary: "旧神在裂隙深处半睁开眼",
      participantRefs: ["god-major-1", "place-city"],
      prerequisites: [
        { kind: "entity_status" as const, entityRef: "faction-court", requiredStatus: ["动摇"] },
      ],
      blockers: [],
      expectedConsequences: [
        { kind: "status_change" as const, targetRef: "faction-court", toStatus: "分裂" },
      ],
      status: "pending" as const,
      visibility: "author_only" as const,
    },
    {
      ref: "canon-event-2",
      title: "晨钟异响",
      timeLabel: "血月之后",
      ordinal: 2,
      epoch: "future" as const,
      summary: "晨钟城的钟声开始逆响",
      participantRefs: ["character-1"],
      prerequisites: [
        { kind: "prior_event_occurred" as const, canonEventRef: "canon-event-1" },
      ],
      blockers: [],
      expectedConsequences: [],
      status: "pending" as const,
      visibility: "author_only" as const,
    },
    {
      ref: "canon-event-3",
      title: "星图残缺",
      timeLabel: "数年之后",
      ordinal: 5,
      epoch: "future" as const,
      summary: "星图学会发现天穹缺了一角",
      participantRefs: ["faction-archive"],
      prerequisites: [
        { kind: "custom" as const, description: "学会尚未被卷入信仰战争" },
      ],
      blockers: [],
      expectedConsequences: [],
      status: "pending" as const,
      visibility: "author_only" as const,
    },
  ];
}

/** 引用均落在 completeDeck 稳定 ref 上的合法阶段 2 锚点关系（schema 可解析）。 */
function validRelationsAtAnchor() {
  return [
    {
      sourceRef: "character-1",
      targetRef: "character-2",
      status: "ally" as const,
      publicDescription: "议会中的同僚与盟友",
    },
    {
      sourceRef: "character-2",
      targetRef: "god-major-1",
      status: "unknown" as const,
      publicDescription: "对潮汐之神心存敬畏",
      hiddenDescription: "私下研习潮汐禁仪",
    },
  ];
}

function issuesOf(deck: TemporalConsistencyDeckView, code: TemporalIssueCode) {
  return collectTemporalIssues(deck).filter((issue) => issue.code === code);
}

describe("collectTemporalIssues", () => {
  it("旧卡组（无 temporalAnchor）跳过全部时间检查", () => {
    const deck = completeDeck();
    // 即使存在会触发 T2 的数据（关键人物已死），旧卡组也必须零检查、零影响。
    deck.majorCharacters[1]!.statusAtAnchor = "dead";
    expect(collectTemporalIssues(deck)).toEqual([]);
    expect(() => validateTemporalConsistency(deck)).not.toThrow();
  });

  it("合法的 IP 锚点卡组（含将临之事与锚点关系）零问题", () => {
    const deck = PantheonWorldDeckSchema.parse({
      ...completeDeck(),
      temporalAnchor: ipTemporalAnchorCard(),
      relationsAtAnchor: validRelationsAtAnchor(),
      canonEvents: validCanonEvents(),
    });
    expect(collectTemporalIssues(deck)).toEqual([]);
    expect(() => validateTemporalConsistency(deck)).not.toThrow();
  });

  it("T1 ANCHOR_MISSING：IP 世界缺 canonCutoff 被点名", () => {
    const base = anchoredDeck();
    const deck: TemporalConsistencyDeckView = {
      ...base,
      temporalAnchor: {
        ...base.temporalAnchor!,
        anchor: { ...base.temporalAnchor!.anchor, canonCutoff: null },
      },
    };
    const issues = collectTemporalIssues(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("ANCHOR_MISSING");
    expect(issues[0]!.message).toContain("canonCutoff");
    expect(issues[0]!.message).toContain("single_ip");
  });

  it("T1 豁免：原创世界（basis=original）无截止点不报错", () => {
    const deck = PantheonWorldDeckSchema.parse({
      ...completeDeck(),
      temporalAnchor: originalTemporalAnchorCard(),
    });
    expect(collectTemporalIssues(deck)).toEqual([]);
  });

  it("T2 DEAD_LEADER：现役势力的关键人物非 active 被点名", () => {
    const deck = anchoredDeck();
    // character-2 是 faction-court（active）的关键人物。
    deck.majorCharacters[1]!.statusAtAnchor = "dead";
    deck.majorCharacters[1]!.anchorNote = "三年前战死于北境";
    const issues = collectTemporalIssues(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("DEAD_LEADER");
    expect(issues[0]!.message).toContain("(faction-court)");
    expect(issues[0]!.message).toContain("(character-2)");
    expect(issues[0]!.message).toContain("dead");
  });

  it("T2 豁免：非现役势力不检查关键人物", () => {
    const deck = anchoredDeck();
    // faction-archive 已解散，其关键人物 character-3 已死——不再构成 DEAD_LEADER。
    deck.factions[1]!.statusAtAnchor = "dissolved";
    deck.majorCharacters[2]!.statusAtAnchor = "dead";
    expect(collectTemporalIssues(deck)).toEqual([]);
  });

  it("T3 INACTIVE_FACTION_WITH_MEMBERS：已消亡势力的现任成员被逐一点名", () => {
    const deck = anchoredDeck();
    deck.factions[0]!.statusAtAnchor = "dissolved";
    deck.factions[0]!.anchorNote = "十年前于内战中解散";
    const issues = collectTemporalIssues(deck);
    // 六名 active 人物都保持对 faction-court 的现任成员关系。
    expect(issues).toHaveLength(6);
    expect(issues.every((issue) => issue.code === "INACTIVE_FACTION_WITH_MEMBERS")).toBe(true);
    expect(issues[0]!.message).toContain("(faction-court)");
    expect(issues[0]!.message).toContain("(character-1)");
    expect(issues[0]!.message).toContain("dissolved");
  });

  it("T3 豁免：memorial=true 的追念成员关系不报错", () => {
    const deck = anchoredDeck();
    deck.factions[0]!.statusAtAnchor = "dissolved";
    const view: TemporalConsistencyDeckView = {
      ...deck,
      majorCharacters: deck.majorCharacters.map((character) => ({
        ...character,
        factionMemberships: character.factionMemberships.map((membership) => ({
          ...membership,
          memorial: true,
        })),
      })),
    };
    expect(collectTemporalIssues(view)).toEqual([]);
  });

  it("T3 豁免：relationsAtAnchor 的追念关系（memorial=true）豁免对应的人物与势力", () => {
    const deck = PantheonWorldDeckSchema.parse({
      ...completeDeck(),
      temporalAnchor: ipTemporalAnchorCard(),
      relationsAtAnchor: [{
        sourceRef: "character-1",
        targetRef: "faction-court",
        status: "family" as const,
        publicDescription: "先王旧部之后",
        memorial: true,
      }],
    });
    deck.factions[0]!.statusAtAnchor = "dissolved";
    const issues = collectTemporalIssues(deck);
    // character-1 由锚点追念关系豁免；其余五名 active 成员仍被逐一点名。
    expect(issues).toHaveLength(5);
    expect(issues.every((issue) => issue.code === "INACTIVE_FACTION_WITH_MEMBERS")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("(character-1)"))).toBe(false);
  });

  it("T3 不豁免：memorial 缺省的锚点关系不构成追念", () => {
    const deck = PantheonWorldDeckSchema.parse({
      ...completeDeck(),
      temporalAnchor: ipTemporalAnchorCard(),
      relationsAtAnchor: [{
        sourceRef: "character-1",
        targetRef: "faction-court",
        status: "subordinate" as const,
        publicDescription: "仍以议会旧部自居",
      }],
    });
    deck.factions[0]!.statusAtAnchor = "dissolved";
    const issues = issuesOf(deck, "INACTIVE_FACTION_WITH_MEMBERS");
    expect(issues).toHaveLength(6);
  });

  it("T3 豁免：非 active 人物的成员关系视为历史记载（追念）", () => {
    const deck = anchoredDeck();
    deck.factions[0]!.statusAtAnchor = "historical";
    deck.factions[1]!.statusAtAnchor = "historical";
    for (const character of deck.majorCharacters) {
      character.statusAtAnchor = "historical";
    }
    // 人物全部只存在于历史记载，其成员关系随之豁免；同时 historical 势力也不再触发 T2。
    expect(collectTemporalIssues(deck)).toEqual([]);
  });

  it("T4 FUTURE_ABILITY_HELD：active 人物持有 timing=future 能力被点名", () => {
    const deck = anchoredDeck();
    deck.majorCharacters[0]!.abilities[0]!.timing = "future";
    const issues = collectTemporalIssues(deck);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("FUTURE_ABILITY_HELD");
    expect(issues[0]!.message).toContain("(character-1)");
    expect(issues[0]!.message).toContain("(ability-character-1-1)");
    expect(issues[0]!.message).toContain("timing=future");
  });

  it("T4 精确谓词：timing=lost 与先天覆写、玩家神同样命中", () => {
    const deck = anchoredDeck();
    deck.majorCharacters[0]!.abilities[0]!.timing = "lost";
    deck.majorCharacters[0]!.racialOverrides[0]!.timing = "future";
    deck.playerGod.abilities[0]!.timing = "future";
    const issues = issuesOf(deck, "FUTURE_ABILITY_HELD");
    expect(issues).toHaveLength(3);
    expect(issues.some((issue) => issue.message.includes("timing=lost"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("(ability-character-1-override)"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("玩家神") && issue.message.includes("(ability-player-1)"))).toBe(true);
  });

  it("T4 豁免：非 active 实体不检查能力时序", () => {
    const deck = anchoredDeck();
    // character-4 不是任何势力的关键人物，独立于 T2。
    deck.majorCharacters[3]!.statusAtAnchor = "missing";
    deck.majorCharacters[3]!.abilities[0]!.timing = "future";
    expect(collectTemporalIssues(deck)).toEqual([]);
  });

  it("T5 EVENT_ORDER_INVALID：future 事件 ordinal 不得小于等于 anchorOrdinal", () => {
    const base = anchoredDeck();
    const view: TemporalConsistencyDeckView = {
      ...base,
      temporalAnchor: { ...base.temporalAnchor!, anchorOrdinal: 2 },
      canonEvents: [{
        ref: "canon-early",
        title: "提前的将临之事",
        ordinal: 1,
        epoch: "future",
        participantRefs: ["character-1"],
      }],
    };
    const issues = collectTemporalIssues(view);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("EVENT_ORDER_INVALID");
    expect(issues[0]!.message).toContain("(canon-early)");
    expect(issues[0]!.message).toContain("必须大于锚点 anchorOrdinal 2");
  });

  it("T5 EVENT_ORDER_INVALID：past 事件 ordinal 不得大于等于 anchorOrdinal", () => {
    const base = anchoredDeck();
    const view: TemporalConsistencyDeckView = {
      ...base,
      canonEvents: [{
        ref: "canon-past-late",
        title: "越过锚点的过去",
        ordinal: 0,
        epoch: "past",
        participantRefs: [],
      }],
    };
    const issues = collectTemporalIssues(view);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("EVENT_ORDER_INVALID");
    expect(issues[0]!.message).toContain("(canon-past-late)");
    expect(issues[0]!.message).toContain("必须小于锚点 anchorOrdinal 0");
  });

  it("T5 EVENT_ORDER_INVALID：ordinal 重复被点名", () => {
    const base = anchoredDeck();
    const view: TemporalConsistencyDeckView = {
      ...base,
      canonEvents: [
        { ref: "canon-a", title: "甲", ordinal: 3, epoch: "future", participantRefs: [] },
        { ref: "canon-b", title: "乙", ordinal: 3, epoch: "future", participantRefs: [] },
      ],
    };
    const issues = collectTemporalIssues(view);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("EVENT_ORDER_INVALID");
    expect(issues[0]!.message).toContain("(canon-b)");
    expect(issues[0]!.message).toContain('"canon-a"');
    expect(issues[0]!.message).toContain("重复");
  });

  it("T5 按事件时点判定：past 事件的参与者在锚点尚不存在（unborn）是错误", () => {
    const base = anchoredDeck();
    base.majorCharacters[3]!.statusAtAnchor = "unborn";
    const view: TemporalConsistencyDeckView = {
      ...base,
      temporalAnchor: { ...base.temporalAnchor!, anchorOrdinal: 5 },
      canonEvents: [{
        ref: "canon-past",
        title: "开国之战",
        ordinal: 1,
        epoch: "past",
        participantRefs: ["character-4"],
      }],
    };
    const issues = collectTemporalIssues(view);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("EVENT_ORDER_INVALID");
    expect(issues[0]!.message).toContain("(character-4)");
    expect(issues[0]!.message).toContain("尚不存在");
  });

  it("T5 豁免：past 事件允许锚点已死的参与者", () => {
    const base = anchoredDeck();
    // character-4 独立于 T2/T3 路径；事发时其尚在世。
    base.majorCharacters[3]!.statusAtAnchor = "dead";
    const view: TemporalConsistencyDeckView = {
      ...base,
      temporalAnchor: { ...base.temporalAnchor!, anchorOrdinal: 5 },
      canonEvents: [{
        ref: "canon-past",
        title: "开国之战",
        ordinal: 1,
        epoch: "past",
        participantRefs: ["character-4"],
      }],
    };
    expect(collectTemporalIssues(view)).toEqual([]);
  });

  it("T5 豁免：future 事件允许锚点未生的参与者", () => {
    const base = anchoredDeck();
    base.majorCharacters[3]!.statusAtAnchor = "unborn";
    const view: TemporalConsistencyDeckView = {
      ...base,
      canonEvents: [{
        ref: "canon-future",
        title: "血月之子降临",
        ordinal: 6,
        epoch: "future",
        participantRefs: ["character-4"],
      }],
    };
    expect(collectTemporalIssues(view)).toEqual([]);
  });

  it("T6 TRADITION_NOT_YET_EXTANT：来源种族锚点 not_yet_emerged 的已习得传承被点名", () => {
    const deck = anchoredDeck();
    deck.races[0]!.statusAtAnchor = "not_yet_emerged";
    const issues = collectTemporalIssues(deck);
    // 六名人物都已习得 ability-human-ritual（race-human 的传承）。
    expect(issues).toHaveLength(6);
    expect(issues.every((issue) => issue.code === "TRADITION_NOT_YET_EXTANT")).toBe(true);
    expect(issues[0]!.message).toContain("(character-1)");
    expect(issues[0]!.message).toContain('"ability-human-ritual"');
    expect(issues[0]!.message).toContain("(race-human)");
    expect(issues[0]!.message).toContain("not_yet_emerged");
  });

  it("T6 豁免：种族仅衰落（declining）不构成传承时序矛盾", () => {
    const deck = anchoredDeck();
    deck.races[0]!.statusAtAnchor = "declining";
    expect(collectTemporalIssues(deck)).toEqual([]);
  });

  it("T7 DANGLING_TEMPORAL_REF：成员/关键人物/传承来源的悬空引用被逐一点名", () => {
    const deck = anchoredDeck();
    deck.majorCharacters[3]!.factionMemberships = [
      { factionRef: "faction-ghost", role: "成员", isPrimary: true },
    ];
    deck.factions[1]!.keyCharacterRefs = [{ ref: "character-ghost" }];
    deck.majorCharacters[4]!.learnedTraditionRefs = [{ sourceAbilityRef: "ability-ghost" }];
    const issues = collectTemporalIssues(deck);
    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.code === "DANGLING_TEMPORAL_REF")).toBe(true);
    expect(issues.some((issue) => issue.message.includes('"faction-ghost"'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('"character-ghost"'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('"ability-ghost"'))).toBe(true);
  });

  it("T7 DANGLING_TEMPORAL_REF：事件参与者与条件/后果引用的悬空 ref 被逐一点名", () => {
    const base = anchoredDeck();
    const view: TemporalConsistencyDeckView = {
      ...base,
      canonEvents: [{
        ref: "canon-x",
        title: "残缺之事",
        ordinal: 4,
        epoch: "future",
        participantRefs: ["ghost-entity"],
        prerequisites: [
          { kind: "prior_event_occurred", canonEventRef: "never-happened" },
        ],
        expectedConsequences: [
          { kind: "status_change", targetRef: "ghost-target" },
        ],
      }],
    };
    const issues = collectTemporalIssues(view);
    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.code === "DANGLING_TEMPORAL_REF")).toBe(true);
    expect(issues.some((issue) => issue.message.includes('"ghost-entity"'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('"never-happened"'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('"ghost-target"'))).toBe(true);
  });

  it("T7 DANGLING_TEMPORAL_REF：锚点关系主客体的悬空 ref 被逐一点名", () => {
    const base = anchoredDeck();
    const view: TemporalConsistencyDeckView = {
      ...base,
      relationsAtAnchor: [
        { sourceRef: "character-1", targetRef: "ghost-friend" },
        { sourceRef: "ghost-source", targetRef: "god-major-1", memorial: true },
      ],
    };
    const issues = collectTemporalIssues(view);
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.code === "DANGLING_TEMPORAL_REF")).toBe(true);
    expect(issues.some((issue) =>
      issue.message.includes("relationsAtAnchor[0]") && issue.message.includes('"ghost-friend"'),
    )).toBe(true);
    expect(issues.some((issue) =>
      issue.message.includes("relationsAtAnchor[1]") && issue.message.includes('"ghost-source"'),
    )).toBe(true);
  });
});

describe("validateTemporalConsistency", () => {
  it("发现问题时抛出聚合全部问题的 TemporalConsistencyError", () => {
    const deck = anchoredDeck();
    deck.majorCharacters[1]!.statusAtAnchor = "dead";
    deck.majorCharacters[0]!.abilities[0]!.timing = "future";
    let caught: unknown;
    try {
      validateTemporalConsistency(deck);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemporalConsistencyError);
    const error = caught as TemporalConsistencyError;
    expect(error.temporalIssues).toHaveLength(2);
    expect(error.message).toContain("时间一致性校验失败（共 2 处）");
    expect(error.message).toContain("[T2 DEAD_LEADER]");
    expect(error.message).toContain("[T4 FUTURE_ABILITY_HELD]");
  });
});
