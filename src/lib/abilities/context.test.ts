import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    god: { findMany: vi.fn() },
    entity: { findMany: vi.fn() },
    ability: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { buildAbilityContext } from "./context";

function ability(
  id: string,
  name: string,
  visibility: "known" | "rumored" | "hidden",
  sourceAbility: { id: string; name: string; visibility?: "known" | "rumored" | "hidden" } | null = null,
) {
  return {
    id,
    name,
    kind: id.startsWith("divine") ? "divine" : "personal",
    effect: `${name}的效果`,
    trigger: `${name}的触发`,
    cost: `${name}的代价`,
    limitations: `${name}的限制`,
    mastery: "adept",
    state: "normal",
    visibility,
    rumorText: visibility === "rumored" ? `关于${name}的传闻` : null,
    bloodlineJustification: null,
    sourceAbilityId: sourceAbility?.id ?? null,
    sourceAbility: sourceAbility
      ? { ...sourceAbility, visibility: sourceAbility.visibility ?? "known" }
      : null,
    lockedFields: [],
    version: 1,
  };
}

const playerGod = {
  id: "god-player",
  name: "曦神",
  isPlayer: true,
  abilities: [
    ability("divine-player-known", "昼临", "known"),
    ability("divine-player-hidden", "秘日", "hidden"),
  ],
};
const actingGod = {
  id: "god-acting",
  name: "潮神",
  isPlayer: false,
  abilities: [
    ability("divine-acting-known", "引潮", "known"),
    ability("divine-acting-hidden", "沉海", "hidden"),
  ],
};
const unrelatedGod = {
  id: "god-unrelated",
  name: "灰神",
  isPlayer: false,
  abilities: [ability("divine-unrelated-hidden", "灰烬密仪", "hidden")],
};

const race = {
  id: "race-dawn",
  type: "race",
  name: "晨裔",
  aliases: ["逐光者"],
  scenePresence: false,
  raceId: null,
  abilities: [
    ability("race-known", "晨光目", "known"),
    ability("race-hidden", "日蚀血脉", "hidden"),
  ],
  race: null,
};
const character = {
  id: "character-lin",
  type: "character",
  name: "林霁",
  aliases: [],
  scenePresence: true,
  raceId: race.id,
  abilities: [
    ability("character-known", "逐风步", "known", {
      id: "tradition-source",
      name: "风行古艺",
    }),
    ability("character-hidden", "无声誓", "hidden"),
  ],
  race: { id: race.id, name: race.name, abilities: race.abilities },
};
const unrelatedCharacter = {
  id: "character-far",
  type: "character",
  name: "远客",
  aliases: [],
  scenePresence: false,
  raceId: null,
  abilities: [ability("unrelated-known", "远方技艺", "known")],
  race: null,
};

function owned(owner: { id: string; abilities: ReturnType<typeof ability>[] }, key: "godId" | "entityId") {
  return owner.abilities.map((item) => ({
    ...item,
    godId: null,
    entityId: null,
    [key]: owner.id,
  }));
}


describe("buildAbilityContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.god.findMany.mockResolvedValue([
      playerGod,
      actingGod,
      unrelatedGod,
    ]);
    mocks.prisma.entity.findMany.mockResolvedValue([
      race,
      character,
      unrelatedCharacter,
    ]);
    mocks.prisma.ability.findMany.mockResolvedValue([
      ...owned(playerGod, "godId"),
      ...owned(actingGod, "godId"),
      ...owned(unrelatedGod, "godId"),
      ...owned(race, "entityId"),
      ...owned(character, "entityId"),
      ...owned(unrelatedCharacter, "entityId"),
    ]);
  });

  it("玩家块包含玩家神全部神权及相关种族/人物已知能力，不泄露隐藏项", async () => {
    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "player",
      searchText: "林霁看向逐光者",
    });

    expect(context).toContain("== KNOWN ABILITIES ==");
    expect(context).toContain("== AUTHOR-ONLY HIDDEN ABILITIES ==");
    expect(context).toContain("昼临");
    expect(context).toContain("秘日");
    expect(context).toContain("晨光目");
    expect(context).toContain("逐风步");
    expect(context).toContain("effect: 逐风步的效果");
    expect(context).toContain("trigger: 逐风步的触发");
    expect(context).toContain("cost: 逐风步的代价");
    expect(context).toContain("limitations: 逐风步的限制");
    expect(context).toContain("state: normal");
    expect(context).toContain("mastery: adept");
    expect(context).toContain("source: 风行古艺 [tradition-source]");
    expect(context).not.toContain("日蚀血脉");
    expect(context).not.toContain("无声誓");
    expect(context).not.toContain("灰烬密仪");
    expect(context).not.toContain("远方技艺");
  });


  it("人物上下文经有效能力解析，应用覆写并排除不可用能力", async () => {
    const innate = {
      ...ability("race-innate", "祖传夜视", "known"),
      kind: "racial_innate",
    };
    const overridden = {
      ...ability("character-override", "受损夜视", "known", {
        id: innate.id,
        name: innate.name,
      }),
      kind: "racial_innate",
      state: "impaired",
    };
    const sealed = {
      ...ability("character-sealed", "封印剑术", "known"),
      state: "sealed",
    };
    const unawakened = {
      ...ability("character-unawakened", "未觉灵感", "known"),
      mastery: "unawakened",
    };
    const lost = {
      ...ability("character-lost", "遗失秘技", "known"),
      state: "lost",
    };
    const deprecated = {
      ...ability("character-deprecated", "废弃旧术", "known"),
      state: "deprecated",
    };
    mocks.prisma.entity.findMany.mockResolvedValue([
      { ...race, abilities: [innate] },
      { ...character, abilities: [overridden, sealed, unawakened, lost, deprecated] },
    ]);
    mocks.prisma.ability.findMany.mockResolvedValue([
      ...owned({ ...race, abilities: [innate] }, "entityId"),
      ...owned({ ...character, abilities: [overridden, sealed, unawakened, lost, deprecated] }, "entityId"),
      ...owned(playerGod, "godId"),
    ]);

    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "player",
      searchText: "林霁",
    });

    const characterEntry = context.slice(context.indexOf("受损夜视"));
    expect(context).toContain("受损夜视");
    expect(characterEntry).toContain("source: 祖传夜视 [race-innate]");
    expect(context).not.toContain("owner: 林霁 [character-lin] (character)\n  kind: racial_innate\n  effect: 祖传夜视的效果");
    expect(context).not.toContain("封印剑术");
    expect(context).not.toContain("未觉灵感");
    expect(context).not.toContain("遗失秘技");
    expect(context).not.toContain("废弃旧术");
  });

  it("人物继承的有效先天能力使用种族模板作为安全来源", async () => {
    const innate = {
      ...ability("race-inherited", "星瞳", "known"),
      kind: "racial_innate",
    };
    mocks.prisma.entity.findMany.mockResolvedValue([
      { ...race, abilities: [innate] },
      { ...character, abilities: [] },
    ]);
    mocks.prisma.ability.findMany.mockResolvedValue([
      ...owned({ ...race, abilities: [innate] }, "entityId"),
      ...owned(playerGod, "godId"),
    ]);

    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "player",
      searchText: "林霁",
    });

    const characterBlock = context.slice(context.lastIndexOf("[race-inherited] 星瞳"));
    expect(characterBlock).toContain("owner: 林霁 [character-lin] (character)");
    expect(characterBlock).toContain("source: 星瞳 [race-inherited]");
  });

  it("传闻能力仅注入安全字段，并可向 Narrator 提供升级用 ability id", async () => {
    const rumoredRace = {
      ...ability("race-rumored", "月下蜕形", "rumored", {
        id: "safe-source",
        name: "古老月契",
      }),
      kind: "racial_innate",
      state: "impaired",
      mastery: "master",
    };
    const rumoredGod = ability("divine-acting-rumored", "潮底低语", "rumored");
    mocks.prisma.god.findMany.mockResolvedValue([
      playerGod,
      { ...actingGod, abilities: [rumoredGod] },
    ]);
    mocks.prisma.entity.findMany.mockResolvedValue([
      { ...race, abilities: [rumoredRace] },
    ]);
    mocks.prisma.ability.findMany.mockResolvedValue([
      ...owned(playerGod, "godId"),
      ...owned({ ...actingGod, abilities: [rumoredGod] }, "godId"),
      ...owned({ ...race, abilities: [rumoredRace] }, "entityId"),
    ]);

    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "player",
      searchText: "逐光者与潮神",
    });

    expect(context).toContain("[race-rumored] 月下蜕形");
    expect(context).toContain("kind: racial_innate");
    expect(context).toContain("rumor: 关于月下蜕形的传闻");
    expect(context).toContain("source: 古老月契 [safe-source]");
    expect(context).toContain("[divine-acting-rumored] 潮底低语");
    expect(context).toContain("rumor: 关于潮底低语的传闻");
    expect(context).not.toContain("月下蜕形的效果");
    expect(context).not.toContain("月下蜕形的触发");
    expect(context).not.toContain("月下蜕形的代价");
    expect(context).not.toContain("月下蜕形的限制");
    expect(context).not.toContain("state: impaired");
    expect(context).not.toContain("mastery: master");
    expect(context).not.toContain("潮底低语的效果");
  });



  it("先筛选相关 owner，再仅查询这些 owner 的能力且不嵌套重复种族能力", async () => {
    mocks.prisma.god.findMany.mockResolvedValue([
      { id: "god-player", name: "曦神", aliases: [], isPlayer: true },
      { id: "god-acting", name: "潮神", aliases: [], isPlayer: false },
      { id: "god-far", name: "远神", aliases: [], isPlayer: false },
    ]);
    mocks.prisma.entity.findMany.mockResolvedValue([
      { id: race.id, type: "race", name: race.name, aliases: race.aliases, scenePresence: false, raceId: null },
      { id: character.id, type: "character", name: character.name, aliases: [], scenePresence: true, raceId: race.id },
      { id: "far-race", type: "race", name: "远族", aliases: [], scenePresence: false, raceId: null },
    ]);
    mocks.prisma.ability.findMany.mockResolvedValue([]);

    await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "player",
      searchText: "潮神与林霁",
    });

    expect(mocks.prisma.ability.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        timelineId: "timeline-1",
        OR: [
          { godId: { in: ["god-player", "god-acting"] } },
          { entityId: { in: [race.id, character.id] } },
        ],
      },
    }));
    expect(mocks.prisma.entity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ race: expect.anything() }),
    }));
  });

  it("后台行动神获得自身 rumored 神权完整机制，非行动神仍仅见安全传闻", async () => {
    const subjectRumor = ability(
      "divine-acting-rumored",
      "潮底低语",
      "rumored",
    );
    const otherRumor = ability(
      "divine-unrelated-rumored",
      "灰烬回声",
      "rumored",
    );
    mocks.prisma.god.findMany.mockResolvedValue([
      { ...actingGod, abilities: [subjectRumor] },
      { ...unrelatedGod, abilities: [otherRumor] },
    ]);
    mocks.prisma.ability.findMany.mockResolvedValue([
      ...owned({ ...actingGod, abilities: [subjectRumor] }, "godId"),
      ...owned({ ...unrelatedGod, abilities: [otherRumor] }, "godId"),
      ...owned(race, "entityId"),
      ...owned(character, "entityId"),
    ]);

    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "backstage",
      subjectGodId: "god-acting",
      searchText: "潮神与灰神",
    });

    const [knownBlock, authorOnly = ""] = context.split(
      "== AUTHOR-ONLY HIDDEN ABILITIES ==",
    );
    expect(authorOnly).toContain("[divine-acting-rumored] 潮底低语");
    expect(authorOnly).toContain("effect: 潮底低语的效果");
    expect(authorOnly).toContain("trigger: 潮底低语的触发");
    expect(authorOnly).toContain("cost: 潮底低语的代价");
    expect(authorOnly).toContain("limitations: 潮底低语的限制");
    expect(authorOnly).toContain("mastery: adept");

    expect(knownBlock).toContain("[divine-unrelated-rumored] 灰烬回声");
    expect(knownBlock).toContain("rumor: 关于灰烬回声的传闻");
    expect(context).not.toContain("灰烬回声的效果");
    expect(context).not.toContain("灰烬回声的触发");
    expect(context).not.toContain("灰烬回声的代价");
    expect(context).not.toContain("灰烬回声的限制");
  });

  it("后台块只额外加入当前行动主神自己的隐藏神权", async () => {
    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "backstage",
      subjectGodId: "god-acting",
      searchText: "林霁",
    });

    const [, authorOnly = ""] = context.split(
      "== AUTHOR-ONLY HIDDEN ABILITIES ==",
    );
    expect(context).toContain("引潮");
    expect(context).not.toContain("秘日");
    expect(authorOnly).toContain("沉海");
    expect(authorOnly).toContain("effect: 沉海的效果");
    expect(authorOnly).not.toContain("秘日");
    expect(authorOnly).not.toContain("灰烬密仪");
    expect(authorOnly).not.toContain("无声誓");
  });


  it("Creator author viewer receives every persisted ability in full without search-based filtering", async () => {
    const sealed = { ...ability("character-sealed-author", "封印秘术", "hidden"), state: "sealed" };
    mocks.prisma.ability.findMany.mockResolvedValue([
      ...owned(playerGod, "godId"),
      ...owned(actingGod, "godId"),
      ...owned(unrelatedGod, "godId"),
      ...owned(race, "entityId"),
      ...owned({ ...character, abilities: [...character.abilities, sealed] }, "entityId"),
      ...owned(unrelatedCharacter, "entityId"),
    ]);
    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "creator_author",
      searchText: "",
    });

    expect(context).toContain("昼临的效果");
    expect(context).toContain("秘日的效果");
    expect(context).toContain("沉海的效果");
    expect(context).toContain("灰烬密仪的效果");
    expect(context).toContain("日蚀血脉的效果");
    expect(context).toContain("无声誓的效果");
    expect(context).toContain("远方技艺的效果");
    expect(context).toContain("封印秘术的效果");
    expect(context).toContain("state: sealed");
    expect(context).toContain("AUTHOR-ONLY");
  });

  it("Narrator 仅获得被点名 NPC、种族与非玩家神的隐藏能力完整机制", async () => {
    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "narrator",
      searchText: "林霁循着逐光者古道，请潮神现身",
    });

    const [, authorOnly = ""] = context.split("== AUTHOR-ONLY HIDDEN ABILITIES ==");
    const [known = ""] = context.split("== AUTHOR-ONLY HIDDEN ABILITIES ==");
    expect(known).toContain("[divine-player-known] 昼临");
    expect(known).toContain("[divine-player-hidden] 秘日");
    expect(authorOnly).toContain("[character-hidden] 无声誓");
    expect(authorOnly).toContain("effect: 无声誓的效果");
    expect(authorOnly).toContain("trigger: 无声誓的触发");
    expect(authorOnly).toContain("[race-hidden] 日蚀血脉");
    expect(authorOnly.match(/\[race-hidden\] 日蚀血脉/g)).toHaveLength(1);
    expect(authorOnly).toContain("[divine-acting-hidden] 沉海");
    expect(authorOnly).toContain("effect: 沉海的效果");
    expect(authorOnly).not.toContain("[divine-unrelated-hidden] 灰烬密仪");
    expect(authorOnly).not.toContain("[divine-player-hidden] 秘日");
  });

  it("Narrator 不因 scenePresence 向 AUTHOR-ONLY 加入未被检索文本提及的秘密", async () => {
    const context = await buildAbilityContext({
      timelineId: "timeline-1",
      viewer: "narrator",
      searchText: "潮神掀起浪潮",
    });

    const [, authorOnly = ""] = context.split("== AUTHOR-ONLY HIDDEN ABILITIES ==");
    expect(authorOnly).toContain("沉海");
    expect(authorOnly).not.toContain("无声誓");
    expect(authorOnly).not.toContain("日蚀血脉");
    expect(authorOnly).not.toContain("灰烬密仪");
  });
});

import { splitMetaBlock } from "@/lib/prompts/narrator";

describe("ability reveal META", () => {
  it("解析合法 ability_reveals 并逐条过滤非法项", () => {
    const { prose, meta } = splitMetaBlock(`潮声里显出沉海神权。\n<<<META\n${JSON.stringify({
      suggestions: ["追问潮神"],
      chapterBreakHint: false,
      ability_reveals: [
        { abilityId: "divine-acting-hidden", visibility: "known", evidence: "潮神当众令海床沉降" },
        { abilityId: "bad", visibility: "hidden", evidence: "非法可见性" },
      ],
    })}\nMETA>>>`);

    expect(prose).toBe("潮声里显出沉海神权。");
    expect(meta.abilityReveals).toEqual([
      {
        abilityId: "divine-acting-hidden",
        visibility: "known",
        evidence: "潮神当众令海床沉降",
      },
    ]);
  });
});
