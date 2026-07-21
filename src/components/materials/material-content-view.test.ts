import { describe, expect, it } from "vitest";
import { buildMaterialContentView } from "./material-content-view";

describe("material content view", () => {
  it("turns a deck character into readable Chinese sections without internal fields", () => {
    const view = buildMaterialContentView({
      schemaVersion: 1,
      origin: "deck",
      kind: "character",
      card: {
        ref: "character-alan",
        name: "阿岚",
        aliases: ["岚姑娘"],
        identity: "北境游侠",
        ageStage: "青年",
        raceRef: "race-human",
        factionMemberships: [{ factionRef: "faction-watch", role: "斥候", isPrimary: true }],
        personality: "沉静而坚韧",
        goals: "守住故乡",
        situation: "独自追查霜灾",
        divineTies: "被冬神注视",
        conflictTies: "霜灾的幸存者",
        learnedTraditionRefs: [],
        racialOverrides: [],
        abilities: [{
          ref: "ability-frost-step",
          name: "踏霜",
          kind: "personal",
          effect: "在冰雪上疾行",
          trigger: "主动",
          cost: "消耗体力",
          limitations: "离开冰雪后失效",
          mastery: "adept",
          state: "normal",
          visibility: "known",
          rumorText: null,
          lockedFields: [],
        }],
      },
    });

    expect(view.title).toBe("阿岚");
    expect(view.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "身份", text: "北境游侠" }),
      expect.objectContaining({ title: "性格", text: "沉静而坚韧" }),
      expect.objectContaining({ title: "能力", items: [expect.objectContaining({ title: "踏霜" })] }),
    ]));
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("character-alan");
    expect(serialized).not.toContain("race-human");
    expect(serialized).not.toContain("faction-watch");
    expect(serialized).not.toContain("lockedFields");
  });

  it("renders runtime entity sections and nested abilities as readable content", () => {
    const view = buildMaterialContentView({
      schemaVersion: 1,
      origin: "runtime",
      kind: "character",
      card: {
        id: "entity-1",
        name: "阿岚",
        summary: "守望北境的游侠",
        aliases: ["岚姑娘"],
        sections: [
          { key: "appearance", title: "外貌", content: "银发灰眸", visibility: "known" },
          { key: "secret", title: "秘密", content: "身负古老誓约", visibility: "hidden" },
        ],
        abilities: [{ id: "a1", name: "踏霜", effect: "在冰雪上疾行", trigger: "主动" }],
        lockedPaths: ["summary"],
      },
    });

    expect(view.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "简介", text: "守望北境的游侠" }),
      expect.objectContaining({ title: "外貌", text: "银发灰眸" }),
      expect.objectContaining({ title: "秘密", text: "身负古老誓约", private: true }),
      expect.objectContaining({ title: "能力", items: [expect.objectContaining({ title: "踏霜" })] }),
    ]));
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("entity-1");
    expect(serialized).not.toContain("lockedPaths");
    expect(serialized).not.toContain("appearance");
    expect(serialized).not.toContain("known");
    expect(serialized).not.toContain("hidden");
  });

  it("translates every supported internal enum value", () => {
    const view = buildMaterialContentView({
      schemaVersion: 1,
      origin: "runtime",
      kind: "ability",
      card: {
        name: "星火",
        kind: "divine",
        mastery: "unawakened",
        state: "enhanced",
        visibility: "rumored",
        rank: "sovereign",
        scale: "epoch",
        stance: "cooperation",
        relatedType: "artifact",
      },
    });

    const serialized = JSON.stringify(view);
    expect(serialized).toContain("神权");
    expect(serialized).toContain("尚未觉醒");
    expect(serialized).toContain("强化");
    expect(serialized).toContain("传闻");
    expect(serialized).toContain("主宰");
    expect(serialized).toContain("纪元");
    expect(serialized).toContain("合作");
    expect(serialized).toContain("器物");
    expect(serialized).not.toMatch(/divine|unawakened|enhanced|rumored|sovereign|epoch|cooperation|artifact/);
    expect(serialized).not.toMatch(/Scale|Stance|Related Type/);
  });

  it("falls back to translated readable fields for edited custom content", () => {
    const view = buildMaterialContentView({
      schemaVersion: 1,
      origin: "edited",
      kind: "theme",
      card: {
        name: "寒夜主题",
        addressStyle: "以古称相称",
        customLore: "星火终会重燃",
        secretSeeds: ["失落王冠", "无名守墓人"],
        internalId: "do-not-show",
      },
    });

    expect(view.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "称谓风格", text: "以古称相称" }),
      expect.objectContaining({ title: "补充设定", text: "星火终会重燃" }),
      expect.objectContaining({ title: "秘密线索", values: ["失落王冠", "无名守墓人"] }),
    ]));
    expect(JSON.stringify(view)).not.toContain("do-not-show");
  });
});
