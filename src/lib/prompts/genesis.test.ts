import { describe, expect, it } from "vitest";
import {
  genesisRepairPrompt,
  genesisSystem,
  genesisUserPrompt,
  rerollReferenceRepairPrompt,
  rerollUserPrompt,
} from "./genesis";

describe("genesis mode prompts", () => {
  it("pantheon 保留 7 月 24 日的玩家神规则", () => {
    const prompt = genesisSystem("pantheon");
    expect(prompt).toContain("PLAYER GOD");
    expect(prompt).toContain("Guilliman");
    expect(prompt).toContain("overflow becomes one-line minorGods");
    expect(prompt).toContain("epochConflict.hiddenCurrents");
    expect(prompt).toContain("NEVER cast the player as a mortal");
    expect(prompt).toContain('mode="pantheon"');
    expect(prompt).toMatch(/mode, worldName/);
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

  it("不注入 7 月 24 日之后新增的时间、快照与写作纪律", () => {
    for (const mode of ["pantheon", "creator"] as const) {
      const prompt = genesisSystem(mode);
      expect(prompt).not.toContain("TEMPORAL ANCHOR FIRST");
      expect(prompt).not.toContain("CURRENT STATE ONLY");
      expect(prompt).not.toContain("ANCHOR SNAPSHOTS");
      expect(prompt).not.toContain("BOUNDED RELATIONS");
      expect(prompt).not.toContain("PROVENANCE (IP worlds only)");
      expect(prompt).not.toContain("ANTI-CLICHÉ");
      expect(prompt).not.toContain("META-LANGUAGE BOUNDARY");
    }
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
    expect(repair).not.toContain("temporal-consistency");
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

  it("兼容现有调用参数但不向提示词注入冻结意图契约", () => {
    const prompts = [
      genesisUserPrompt({ mode: "pantheon", decree: "创世", intentContract: "预序列化契约" }),
      genesisRepairPrompt({
        mode: "pantheon",
        decree: "创世",
        invalidOutput: "{}",
        validationError: "缺字段",
        intentContract: "预序列化契约",
      }),
      rerollUserPrompt({
        mode: "pantheon",
        decree: "创世",
        cardKey: "majorGods",
        currentDeckJson: "{}",
        intentContract: "预序列化契约",
      }),
      rerollReferenceRepairPrompt({
        mode: "pantheon",
        decree: "创世",
        currentDeckJson: "{}",
        referenceIssue: "引用无效",
        intentContract: "预序列化契约",
      }),
    ];

    for (const prompt of prompts) {
      expect(prompt).not.toContain("FROZEN GENESIS INTENT CONTRACT");
      expect(prompt).not.toContain("预序列化契约");
    }
  });
});
