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


describe("narrator discipline pack", () => {
  it("declares supplied context blocks as binding canon over the prose window", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("CODEX CARDS, CHRONICLE, LOREBOOK and ACTIVE REALITY STATE blocks are established canon");
    expect(prompt).toContain("when the prose window and a supplied card disagree, the card wins");
    expect(prompt).toContain("Invent freely only where canon is silent");
    expect(prompt).toContain("consistency with supplied codex and chronicle facts");
    expect(narratorGlobalSystem("creator")).toContain("consistency with supplied codex and chronicle facts");
  });

  it("uses the story-so-far window as a repetition ledger and rations stock beats", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("repetition ledger");
    expect(prompt).toContain("Enter each reply from a fresh angle");
    expect(prompt).toContain("Ration stock beats");
    expect(prompt).toContain("一丝/一抹/一缕");
    expect(prompt).toContain("眼中闪过/嘴角勾起/空气仿佛凝固");
    expect(prompt).toContain("write its physical consequence, not a sound-effect line");
  });

  it("gives every scale an explicit length band", () => {
    expect(narratorTurnSystem({ mode: "pantheon", scale: "moment" }))
      .toContain("Target 150-450 Chinese characters");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "scene" }))
      .toContain("Target 500-1200 Chinese characters; at most one --- divider");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "years" }))
      .toContain("with at most 2 close-up vignettes");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "era" }))
      .toContain("Target 800-1800 Chinese characters");
    expect(narratorTurnSystem({ mode: "pantheon", scale: "epoch" }))
      .toContain("no scene-level dialogue except quoted historical fragments");
  });

  it("locks year labels to the established era format", () => {
    const prompt = narratorTurnSystem({
      mode: "pantheon",
      scale: "scene",
      temporal: { era: "潮汐纪元", time: "第七日" },
    });
    expect(prompt).toContain("exactly the established era format supplied above");
  });

  it("demands suggestion diversity and binds every style-card field", () => {
    const prompt = narratorGlobalSystem("pantheon");
    expect(prompt).toContain("meaningfully different in kind (bold vs cautious, action vs inquiry, different targets)");
    expect(prompt).toContain("Follow every field of the STYLE CARD");
    expect(prompt).toContain("example sentences are tone anchors, never to be copied verbatim");
  });

  it("keeps openings scenic instead of deck inventories in both modes", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const directive = openingDirective(mode);
      expect(directive).toContain("Do not inventory the world deck");
      expect(directive).toContain("naming at most three gods or factions");
      expect(directive).toContain("Target 800-1500 Chinese characters");
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

  it("uses a world tableau opening without descent or a fabricated player-god hook", () => {
    const creator = openingDirective("creator");
    const pantheon = openingDirective("pantheon");

    expect(creator).toContain("present era");
    expect(creator).toContain("world-internal tension");
    expect(creator).not.toContain("Chapter One");
    expect(creator).toContain("no descent");
    expect(creator).not.toContain("player god's starting situation");
    expect(pantheon).toContain("genesis / descent set-piece");
    expect(pantheon).toContain("player god's starting situation");
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
