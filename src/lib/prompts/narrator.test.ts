import { describe, expect, it } from "vitest";
import { splitMetaBlock } from "./narrator";

const meta = JSON.stringify({
  suggestions: ["追问"],
  operation: "continue",
  immediate_changes: [],
  world_actions: [],
  activity_entries: [],
  important_event_mutation: null,
  significant_event: false,
  settlement_reasons: [],
  ability_reveals: [],
});

describe("splitMetaBlock strict tail framing", () => {
  it("只解析末尾完整且标记独占一行的 META 块", () => {
    expect(splitMetaBlock(`正文\n<<<META\n${meta}\nMETA>>>`)).toMatchObject({
      prose: "正文",
      meta: { suggestions: ["追问"] },
    });
  });

  it("兼容模型偶发输出的单行尾部 META 块", () => {
    expect(splitMetaBlock(`正文\n<<<META ${meta} META>>>`)).toMatchObject({
      prose: "正文",
      meta: { suggestions: ["追问"] },
    });
  });

  it("旧字段失效时仍剥离 META，并保留其余有效控制数据", () => {
    const driftedMeta = JSON.stringify({
      suggestions: ["观察重塑世界"],
      operation: "continue",
      temporal_state: { era: "时空崩毁之纪元", time: "两百年重置中" },
      immediate_changes: [],
      world_actions: [],
      activity_entries: [{
        actorId: "god-dragon",
        action: "death",
        targetIds: [],
        consequence: "龙神死亡。",
      }],
      important_event_mutation: null,
      significant_event: true,
      settlement_reasons: ["important_death", "era_change"],
      revealed_event_ids: [],
      ability_reveals: [],
    });

    expect(splitMetaBlock(`正文\n<<<META ${driftedMeta} META>>>`)).toEqual({
      prose: "正文",
      meta: {
        suggestions: ["观察重塑世界"],
        operation: "continue",
        temporalState: { era: "时空崩毁之纪元", time: "两百年重置中" },
        immediateChanges: [],
        worldActions: [],
        activityEntries: [],
        significantEvent: true,
        settlementReasons: ["important_death", "era_change"],
        revealedEventIds: [],
      },
    });
  });

  it.each([
    `正文内联 <<<META\n${meta}\nMETA>>>`,
    `正文\n<<<META\n${meta}`,
    `正文\n<<<META trailing\n${meta}\nMETA>>>`,
    `正文\n<<<META\n${meta}\nMETA>>>\n后续正文`,
    `前段\n<<<META\n${meta}\nMETA>>>\n仍是正文\n`,
    `正文内联 <<<META ${meta} META>>>`,
    `正文\n<<<META ${meta} META>>>\n后续正文`,
  ])("不吞掉非完整尾部块：%s", (full) => {
    expect(splitMetaBlock(full)).toEqual({
      prose: full.trim(),
      meta: {
        suggestions: [],
        operation: "continue",
        immediateChanges: [],
        worldActions: [],
        activityEntries: [],
        significantEvent: false,
        settlementReasons: [],
      },
    });
  });
});

it.each([
  `<<<META\n${meta}\nMETA>>>`,
  `正文\r\n<<<META\r\n${meta}\r\nMETA>>>\r\n`,
])("接受 block-at-start 与 CRLF 尾块", (full) => {
  const result = splitMetaBlock(full);
  expect(result.meta.suggestions).toEqual(["追问"]);
  expect(result.prose).not.toContain("<<<META");
});

import {
  narratorGlobalSystem,
  narratorTurnSystem,
  narratorWorldSystem,
  openingDirective,
} from "./narrator";

describe("narrator quality contract", () => {
  it("protects player agency at natural decision points", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("PLAYER AGENCY BOUNDARY");
    expect(prompt).toContain("explicitly supplied words, actions and intent");
    expect(prompt).toContain("never invent a new consequential decision");
    expect(prompt).toContain("natural dramatic beat");
    expect(prompt).toContain("Do not announce that it is the player's turn");
  });

  it("requires grounded knowledge and ability provenance for every NPC", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("KNOWLEDGE BOUNDARY");
    expect(prompt).toContain("witnessed, was told, can reliably infer");
    expect(prompt).toContain("Narrator knowledge is not character knowledge");
    expect(prompt).toContain("AUTHOR-ONLY");
  });

  it("builds living characters from state instead of random traits", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("LIVING CHARACTER METHOD");
    expect(prompt).toContain("persona, present goal, known information, relationships, recent experience, abilities and limitations");
    expect(prompt).toContain("surprising but retrospectively explainable");
    expect(prompt).toContain("Never invent permanent personality traits merely to create variety");
  });

  it("keeps the July 24 living-character guidance without the later narrative checklist", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = narratorGlobalSystem(mode);
      expect(prompt).not.toContain("NARRATIVE DISCIPLINE");
      expect(prompt).not.toContain("present goal -> known information -> available means -> relationship pressure -> choice -> visible consequence");
      expect(prompt).not.toContain("Every spoken line must do at least one job");
    }
  });

  it("uses positive prose guidance and forbids visible planning", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("PROSE CRAFT");
    expect(prompt).toContain("Render personality through choices, timing, action and dialogue");
    expect(prompt).toContain("Use direct description for ordinary sensory facts");
    expect(prompt).toContain("SILENT PREFLIGHT");
    expect(prompt).toContain("Never output chain-of-thought");
    expect(prompt).toContain("End prose on an action, line of dialogue, image, consequence or unresolved tension");
  });

  it("keeps stable quality rules global and turn facts dynamic", () => {
    const global = narratorGlobalSystem("pantheon");
    const world = narratorWorldSystem({
      mode: "pantheon",
      worldName: "测试世界",
      styleCard: null,
      themeCard: null,
      cosmology: null,
      playerGod: null,
    });
    const turn = narratorTurnSystem({ mode: "pantheon", scale: "scene", omens: ["潮声倒流"] });
    expect(global).toContain("PLAYER AGENCY BOUNDARY");
    expect(global).not.toContain("潮声倒流");
    expect(world).toContain("测试世界");
    expect(world).not.toContain("CURRENT SCALE");
    expect(turn).toContain("CURRENT SCALE");
    expect(turn).toContain("潮声倒流");
    expect(turn).not.toContain("PLAYER AGENCY BOUNDARY");
  });

  it("limits suggestions to unresolved player choices without prewriting outcomes", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("Suggest only actions or attitudes the player god may choose");
    expect(prompt).toContain("never state the outcome as already achieved");
  });

  it("允许玩家明确要求本轮创造新技能，但不允许 Narrator 自行给 NPC 编造能力", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("explicit current player request");
    expect(prompt).toContain("successfully develops or first stably performs");
    expect(prompt).toContain("does not let the Narrator autonomously invent");
    expect(prompt).toContain("NPC");
    expect(prompt).toContain("Hidden chronicle entries, agendas and AUTHOR-ONLY abilities cannot leak through convenient intuition");
  });

  it("新能力在正文成立时要求 META 标记 ability_change 以触发同轮整理", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = narratorGlobalSystem(mode);
      expect(prompt).toContain("settlement_reasons");
      expect(prompt).toContain("ability_change");
      expect(prompt).toContain("成功研发");
      expect(prompt).toContain("首次稳定施展");
      expect(prompt).toContain("本轮");
    }
  });

  it("uses the same META for restrained autonomous world activity", () => {
    const prompt = narratorGlobalSystem("pantheon");

    expect(prompt).toContain("\"world_actions\":[]");
    expect(prompt).toContain("\"activity_entries\":[]");
    expect(prompt).toContain("\"important_event_mutation\":null");
    expect(prompt).toContain("same single META");
    expect(prompt).toContain("current prose, a supplied focused event, or recently supplied conflict");
    expect(prompt).toContain("consequence is narrative evidence only");
    expect(prompt).toContain("exact eventId supplied in the current context");
    expect(prompt).toContain("Never manufacture unrelated news");
  });

  it("parses world activity from the one Narrator META block", () => {
    const fullMeta = JSON.stringify({
      suggestions: [],
      operation: "continue",
      immediate_changes: [],
      world_actions: [{
        actorType: "god",
        actorId: "god-1",
        action: "封锁北港",
        targetIds: ["entity-1"],
        visibility: "public",
        consequence: "粮船滞留外海",
      }],
      activity_entries: [{
        kind: "conflict",
        text: "北港航道被封锁。",
        subjectIds: ["god-1", "entity-1"],
        visibility: "public",
        importance: "normal",
      }],
      important_event_mutation: null,
      significant_event: false,
      settlement_reasons: [],
    });

    expect(splitMetaBlock(`正文\n<<<META\n${fullMeta}\nMETA>>>`).meta).toMatchObject({
      worldActions: [{ actorId: "god-1" }],
      activityEntries: [{ kind: "conflict" }],
    });
  });
});


describe("July 24 narrator writing profile", () => {
  it("declares supplied context blocks as binding canon over the prose window", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("CODEX CARDS, CHRONICLE, LOREBOOK and ACTIVE REALITY STATE blocks are established canon");
    expect(prompt).toContain("when the prose window and a supplied card disagree, the card wins");
    expect(prompt).toContain("Invent freely only where canon is silent");
    expect(prompt).toContain("consistency with supplied codex and chronicle facts");
    expect(narratorGlobalSystem("creator")).toContain("consistency with supplied codex and chronicle facts");
  });

  it("does not turn the story window into a repetition or stock-phrase checklist", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).not.toContain("repetition ledger");
    expect(prompt).not.toContain("Enter each reply from a fresh angle");
    expect(prompt).not.toContain("Ration stock beats");
    expect(prompt).not.toContain("一丝/一抹/一缕");
    expect(prompt).not.toContain("眼中闪过/嘴角勾起/空气仿佛凝固");
  });

  it("keeps scale guidance without later fixed length quotas", () => {
    expect(narratorTurnSystem({ mode: "pantheon", scale: "moment" }))
      .not.toContain("Target 150-450 Chinese characters");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "scene" }))
      .not.toContain("Target 500-1200 Chinese characters");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "years" }))
      .not.toContain("with at most 2 close-up vignettes");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "era" }))
      .not.toContain("Target 800-1800 Chinese characters");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "epoch" }))
      .not.toContain("no scene-level dialogue except quoted historical fragments");
  });

  it("locks year labels to the established era format", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      temporal: { era: "潮汐纪元", time: "第七日" },
    });
    expect(prompt).toContain("exactly the established era format supplied above");
  });

  it("keeps positive style guidance without synonym-family policing", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("meaningfully different in kind (bold vs cautious, action vs inquiry, different targets)");
    expect(prompt).toContain("Follow the STYLE CARD while keeping Chinese prose concrete, fluid and human");
    expect(prompt).not.toContain("banning its close synonym family");
    expect(prompt).not.toContain("example sentences are tone anchors, never to be copied verbatim");
  });

  it("does not impose later deck-inventory or opening-length quotas", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const directive = openingDirective(mode);
      expect(directive).not.toContain("Do not inventory the world deck");
      expect(directive).not.toContain("naming at most three gods or factions");
      expect(directive).not.toContain("Target 800-1500 Chinese characters");
    }
  });
});

describe("creator unified narration contract", () => {
  it("treats the player as world-external while classifying every input in one channel", () => {
    const prompt = narratorGlobalSystem("creator");

    expect(prompt).toContain("world-external Creator");
    expect(prompt).toContain("UNIFIED CREATOR INTENT");
    expect(prompt).toContain("retroactive_rewrite");
    expect(prompt).toContain("already-established history");
    expect(prompt).toContain("Never invent a body, god-card, worship, rank, limitation, or in-world identity");
    expect(prompt).toContain("World-internal characters do not know the Creator exists");
    expect(prompt).not.toContain("The player IS a god of this world");
  });

  it("uses explicit time wording for one reply without changing the dial", () => {
    const prompt = narratorTurnSystem({
      mode: "creator",
      scale: "scene",
      playerInput: "百年之后再看这里",
      temporal: { era: "黑潮纪元", time: "帝历三百二十七年" },
    });

    expect(prompt).toContain("explicit time wording");
    expect(prompt).toContain("overrides the dial for this reply only");
    expect(prompt).toContain("must not change the dial");
    expect(prompt).toContain("百年之后再看这里");
  });

  it("offers observation choices rather than player-god actions and preserves reveal provenance", () => {
    const prompt = narratorGlobalSystem("creator");

    expect(prompt).toContain("observation, focus, viewpoint, ordinary world action, or time-advance choices");
    expect(prompt).not.toContain("actions or attitudes the player god may choose");
    expect(prompt).toContain("ability_reveals");
    expect(prompt).toContain("clearly witnessed");
  });

  it("opens creator worlds with the July 24 broad tableau", () => {
    const creator = openingDirective("creator");
    const pantheon = openingDirective("pantheon");

    expect(creator).toContain("present era");
    expect(creator).toContain("broad tableau");
    expect(creator).toContain("world-internal tension");
    expect(creator).toContain("offer observation/focus choices");
    expect(creator).not.toContain("specific place and time");
    expect(creator).not.toContain("unsupported deaths");
    expect(creator).not.toContain("Chapter One");
    expect(creator).toContain("no descent");
    expect(creator).not.toContain("player god's starting situation");
    expect(pantheon).toContain("genesis / descent set-piece");
    expect(pantheon).toContain("player god's starting situation");
    expect(pantheon).not.toContain("Do not inventory the world deck");
    expect(pantheon).not.toContain("Target 800-1500 Chinese characters");
  });

  it("keeps second person external in creator mode", () => {
    const world = narratorWorldSystem({
      mode: "creator",
      worldName: "观星界",
      styleCard: null,
      themeCard: null,
      cosmology: null,
      playerGod: null,
    });
    expect(world).toContain("CREATOR OBSERVER");
    expect(world).not.toContain("PLAYER GOD (the protagonist");
  });
});

describe("proactive divine event staging", () => {
  it("提供 proactiveEvent 时渲染正面登台块：点名神明并禁止降格为暗示", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      omens: ["潮声倒流"],
      proactiveEvent: { godName: "潮神", text: "潮神遣使者入梦" },
    });
    expect(prompt).toContain("== PROACTIVE DIVINE EVENT (stage this openly) ==");
    expect(prompt).toContain("潮神 moves toward the player god this very reply: 潮神遣使者入梦");
    expect(prompt).toContain("never as a passing hint");
    expect(prompt).toContain("never explained away as an omen or a system event");
    expect(prompt).toContain("Do not decide the player god's response");
  });

  it("未提供 proactiveEvent 时不出现登台块", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      omens: ["潮声倒流"],
    });
    expect(prompt).not.toContain("PROACTIVE DIVINE EVENT");
  });

  it("PENDING OMENS 织入指令保持原文（与登台块互为对立面）", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      omens: ["潮声倒流"],
      proactiveEvent: { godName: "潮神", text: "潮神遣使者入梦" },
    });
    expect(prompt).toContain("== PENDING OMENS (offstage divine actions' worldly echoes) ==");
    expect(prompt).toContain(
      "Weave AT MOST 1-2 of these into your reply as passing, unexplained details. NEVER flag or explain them:",
    );
  });
});

describe("META probe_attempted 自报契约与神权建议回流", () => {
  it("pantheon 版声明查探自报规则并要求建议锚定已列神赋能力", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("probe_attempted");
    expect(prompt).toContain("\"probe_attempted\":false");
    expect(prompt).toContain("arms adjudication for the next turn");
    expect(prompt).toContain("Never mention this flag in prose");
    expect(prompt).toContain("ground at least one option in a specific listed ability");
  });

  it("creator 版查探规则恒为 false 且不含 pantheon 版语句", () => {
    const prompt = narratorGlobalSystem("creator");
    expect(prompt).toContain("probe_attempted");
    expect(prompt).toContain("omniscient creator narration needs no probe adjudication");
    expect(prompt).not.toContain("arms adjudication for the next turn");
    expect(prompt).not.toContain("ground at least one option in a specific listed ability");
  });

  it("splitMetaBlock 仅在 probe_attempted === true 时收取，false/缺失/非布尔一律 undefined", () => {
    const withProbe = (value: unknown) => JSON.stringify({
      suggestions: [],
      operation: "continue",
      immediate_changes: [],
      world_actions: [],
      activity_entries: [],
      important_event_mutation: null,
      significant_event: false,
      settlement_reasons: [],
      probe_attempted: value,
    });

    expect(splitMetaBlock(`正文\n<<<META\n${withProbe(true)}\nMETA>>>`).meta.probeAttempted)
      .toBe(true);
    expect(splitMetaBlock(`正文\n<<<META\n${withProbe(false)}\nMETA>>>`).meta.probeAttempted)
      .toBeUndefined();
    expect(splitMetaBlock(`正文\n<<<META\n${withProbe("yes")}\nMETA>>>`).meta.probeAttempted)
      .toBeUndefined();
    expect(splitMetaBlock(`正文\n<<<META\n${meta}\nMETA>>>`).meta.probeAttempted)
      .toBeUndefined();
  });

  it("非布尔 probe_attempted 不破坏其余 META 字段的剥离", () => {
    const drifted = JSON.stringify({
      suggestions: ["追问"],
      operation: "continue",
      immediate_changes: [],
      world_actions: [],
      activity_entries: [],
      important_event_mutation: null,
      significant_event: false,
      settlement_reasons: [],
      probe_attempted: "yes",
    });
    expect(splitMetaBlock(`正文\n<<<META\n${drifted}\nMETA>>>`)).toMatchObject({
      prose: "正文",
      meta: { suggestions: ["追问"] },
    });
  });
});

describe("神谕结果申报 META 通道", () => {
  it("splitMetaBlock 保留合法 outcome", () => {
    const withOutcome = JSON.stringify({
      suggestions: ["追问"],
      operation: "continue",
      immediate_changes: [],
      world_actions: [],
      activity_entries: [],
      important_event_mutation: null,
      outcome: { result: "backfired", note: "潮水反噬了神的行宫" },
      significant_event: false,
      settlement_reasons: [],
    });
    expect(splitMetaBlock(`正文\n<<<META\n${withOutcome}\nMETA>>>`).meta.outcome)
      .toEqual({ result: "backfired", note: "潮水反噬了神的行宫" });
  });

  it("损坏的 outcome（字符串形态）静默丢弃，其余字段保留", () => {
    const drifted = JSON.stringify({
      suggestions: ["追问"],
      operation: "continue",
      immediate_changes: [],
      world_actions: [],
      activity_entries: [],
      important_event_mutation: null,
      outcome: "fulfilled",
      significant_event: false,
      settlement_reasons: [],
    });
    const result = splitMetaBlock(`正文\n<<<META\n${drifted}\nMETA>>>`);
    expect(result.meta.outcome).toBeUndefined();
    expect(result).toMatchObject({
      prose: "正文",
      meta: { suggestions: ["追问"] },
    });
  });

  it("outputContract 声明 outcome 字段与不得虚构裁定", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = narratorGlobalSystem(mode);
      expect(prompt).toContain("\"outcome\":null");
      expect(prompt).toContain("never fabricate an outcome");
    }
  });
});

describe("时间锚点回合头（CURRENT WORLD TIME 扩展，设计稿 §12）", () => {
  it("携带锚点数据时追加锚点事件、截止点与毯式规则", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      temporal: {
        era: "帝国历晚期",
        time: "帝国历 998 年冬",
        anchorEvent: "就在黑船叩港的前夜",
        canonCutoff: "主线大战爆发之前",
      },
    });
    expect(prompt).toContain("Era: 帝国历晚期");
    expect(prompt).toContain("Time: 帝国历 998 年冬");
    expect(prompt).toContain("Anchor event (this play began at this moment): 就在黑船叩港的前夜");
    expect(prompt).toContain("Canon cutoff (原作知识截止点): 主线大战爆发之前");
    expect(prompt).toContain("截止点之后的原作事件在本世界尚未发生，除非它已在本局中发生。");
  });

  it("原创降级档（无截止点）只追加锚点事件，不出现截止点与毯式规则", () => {
    const prompt = narratorTurnSystem({
      mode: "creator",
      scale: "scene",
      temporal: {
        era: "裂光纪",
        time: "裂光元年",
        anchorEvent: "巨龙坠落在王都上空的那个清晨",
      },
    });
    expect(prompt).toContain("Anchor event (this play began at this moment): 巨龙坠落在王都上空的那个清晨");
    expect(prompt).not.toContain("Canon cutoff");
    expect(prompt).not.toContain("截止点之后的原作事件在本世界尚未发生");
  });

  it("旧世界（无锚点数据）时间块形状逐字节不变", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      temporal: { era: "潮汐纪元", time: "第七日" },
    });
    expect(prompt).toContain(
      "== CURRENT WORLD TIME ==\nEra: 潮汐纪元\nTime: 第七日\nThe dial is the default span.",
    );
    expect(prompt).not.toContain("Anchor event");
    expect(prompt).not.toContain("截止点之后的原作事件在本世界尚未发生");
  });
});

describe("余烬低谷文体块（EMBER REGISTER）", () => {
  it("playerGodRank=ember 时注入低谷文体块与回燃线索", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      playerGodRank: "ember",
    });
    expect(prompt).toContain("EMBER REGISTER");
    expect(prompt).toContain("萤火视角");
    expect(prompt).toContain("rekindling");
    expect(prompt).not.toContain("陨灭");
  });

  it("playerGodRank=fallen 时以陨灭边缘收束", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      playerGodRank: "fallen",
    });
    expect(prompt).toContain("EMBER REGISTER");
    expect(prompt).toContain("陨灭");
    expect(prompt).not.toContain("rekindling");
  });

  it("未传 rank 或 rank=nascent 不出现低谷块", () => {
    expect(narratorTurnSystem({ mode: "pantheon", scale: "scene" }))
      .not.toContain("EMBER REGISTER");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "scene", playerGodRank: "nascent" }))
      .not.toContain("EMBER REGISTER");
  });
});
