import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    god: { findMany: vi.fn() },
    entity: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { buildAbilityContext } from "./context";

function ability(
  id: string,
  name: string,
  visibility: "known" | "rumored" | "hidden",
  sourceAbility: { id: string; name: string } | null = null,
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
    sourceAbilityId: sourceAbility?.id ?? null,
    sourceAbility,
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
