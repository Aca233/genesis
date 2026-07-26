import { describe, expect, it } from "vitest";
import {
  ChronicleSchema,
  IconConceptSchema,
  StrictExtractionSchema,
  extractorSystem,
} from "./extractor";

const baseExtraction = {
  newEntities: [],
  newGods: [],
  godUpdates: [],
  revealSections: [],
  majorCharacterPromotions: [],
  abilityChanges: [],
};

describe("icon concept extraction", () => {
  it.each([
    "time.reverse",
    "星辰与潮汐",
  ])("accepts a semantic token or short natural-language motif: %s", (concept) => {
    expect(IconConceptSchema.parse(concept)).toBe(concept);
  });

  it.each([
    "ph:star",
    "tabler:sword",
    "<svg viewBox=\"0 0 24 24\"></svg>",
    "x".repeat(81),
  ])("rejects raw icon data or an overlong concept", (concept) => {
    expect(IconConceptSchema.safeParse(concept).success).toBe(false);
  });

  it("accepts icon concepts on new narrative subjects", () => {
    const parsed = StrictExtractionSchema.parse({
      ...baseExtraction,
      newEntities: [{
        type: "artifact",
        name: "逆潮钟",
        aliases: [],
        summary: "能逆转潮汐的古钟。",
        sections: [],
        isChosen: false,
        iconConcept: "time.reverse",
      }],
      newGods: [{
        name: "潮母",
        aliases: [],
        tier: "minor",
        rank: "nascent",
        domains: ["潮汐"],
        faithScope: null,
        iconConcept: "星辰与潮汐",
      }],
      entityUpdates: [],
      abilityChanges: [{
        ownerName: "潮母",
        name: "逆熵祷告",
        kind: "divine",
        effect: "逆转一小片海域的潮序。",
        trigger: "完成祷告。",
        cost: "消耗神力。",
        limitations: "每个潮周期仅一次。",
        lockedFields: [],
        visibility: "known",
        type: "awakened",
        patch: {},
        evidenceMessageIndex: 0,
        evidence: "潮母第一次稳定施展逆熵祷告，整片海域随之逆流。",
        iconConcept: "time.reverse",
      }],
    });

    expect(parsed.newEntities[0]?.iconConcept).toBe("time.reverse");
    expect(parsed.newGods[0]?.iconConcept).toBe("星辰与潮汐");
    expect(parsed.abilityChanges[0]?.iconConcept).toBe("time.reverse");
  });

  it("tells the model to emit semantic concepts rather than icon payloads", () => {
    const system = extractorSystem();

    expect(system).toContain("iconConcept");
    expect(system).toContain("Iconify ID");
    expect(system).toContain("SVG");
  });
});

describe("character relation extraction", () => {
  it("accepts a directional relation change on a character update", () => {
    const parsed = StrictExtractionSchema.parse({
      ...baseExtraction,
      entityUpdates: [{
        name: "鲁迪",
        sectionDeltas: [],
        summary: null,
        newAliases: null,
        becameChosen: null,
        died: null,
        scenePresent: true,
        relationChanges: [{
          target: "保罗",
          label: "family",
          note: "正文明确两人重新承认父子关系。",
        }],
      }],
    });

    expect(parsed.entityUpdates[0]?.relationChanges).toEqual([{
      target: "保罗",
      label: "family",
      note: "正文明确两人重新承认父子关系。",
    }]);
  });

  it("rejects unsupported relation labels and extra relation fields", () => {
    const invalidLabel = StrictExtractionSchema.safeParse({
      ...baseExtraction,
      entityUpdates: [{
        name: "鲁迪",
        sectionDeltas: [],
        summary: null,
        newAliases: null,
        becameChosen: null,
        died: null,
        scenePresent: true,
        relationChanges: [{ target: "保罗", label: "master", note: "师徒" }],
      }],
    });
    const extraField = StrictExtractionSchema.safeParse({
      ...baseExtraction,
      entityUpdates: [{
        name: "鲁迪",
        sectionDeltas: [],
        summary: null,
        newAliases: null,
        becameChosen: null,
        died: null,
        scenePresent: true,
        relationChanges: [{
          target: "保罗",
          label: "family",
          note: "父子",
          reciprocal: true,
        }],
      }],
    });

    expect(invalidLabel.success).toBe(false);
    expect(extraField.success).toBe(false);
  });

  it("requires explicit prose changes for relations and full-section rewrites", () => {
    const system = extractorSystem();

    expect(system).toContain("character relation");
    expect(system).toContain("exact known character name or alias");
    expect(system).toContain("directional");
    expect(system).toContain("explicitly changes");
    expect(system).toContain("whole section");
    expect(system).toContain("Never invent");
  });
});

describe("chosen lifespan checks schema", () => {
  it("缺省 chosenLifespanChecks 时默认空数组（旧结算响应回归）", () => {
    const parsed = StrictExtractionSchema.parse({
      ...baseExtraction,
      entityUpdates: [],
    });

    expect(parsed.chosenLifespanChecks).toEqual([]);
  });

  it("接受对神选者的合法寿数表态", () => {
    const parsed = StrictExtractionSchema.parse({
      ...baseExtraction,
      entityUpdates: [],
      chosenLifespanChecks: [{
        name: "阿岚",
        verdict: "nearing_end",
        note: "山道上的白鸦成群北去，村中老人夜闻磬响。",
      }],
    });

    expect(parsed.chosenLifespanChecks).toEqual([{
      name: "阿岚",
      verdict: "nearing_end",
      note: "山道上的白鸦成群北去，村中老人夜闻磬响。",
    }]);
  });

  it("拒绝非法 verdict 与多余字段", () => {
    expect(StrictExtractionSchema.safeParse({
      ...baseExtraction,
      entityUpdates: [],
      chosenLifespanChecks: [{ name: "阿岚", verdict: "immortal", note: "非法裁决" }],
    }).success).toBe(false);
    expect(StrictExtractionSchema.safeParse({
      ...baseExtraction,
      entityUpdates: [],
      chosenLifespanChecks: [{ name: "阿岚", verdict: "unchanged", note: "无变化", omen: "多余字段" }],
    }).success).toBe(false);
  });
});

describe("chronicle era digest schema", () => {
  const baseChronicle = {
    entries: [{ yearLabel: "元年", text: "盐潮越过旧堤。", entityNames: [], godNames: [] }],
    epilogue: "潮声未止。",
    chapterTitle: "",
  };

  it("旧响应缺省 eraDigest 时照常解析", () => {
    const parsed = ChronicleSchema.safeParse(baseChronicle);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.eraDigest).toBeFalsy();
  });

  it("接受显式 null 的 eraDigest", () => {
    expect(ChronicleSchema.safeParse({ ...baseChronicle, eraDigest: null }).success).toBe(true);
  });

  it("接受并保留合法 eraDigest 内容", () => {
    const parsed = ChronicleSchema.parse({
      ...baseChronicle,
      eraDigest: { closedEra: "破晓纪", text: "破晓纪以盐潮之战开端，以旧港沉没告终。" },
    });

    expect(parsed.eraDigest).toEqual({
      closedEra: "破晓纪",
      text: "破晓纪以盐潮之战开端，以旧港沉没告终。",
    });
  });
});
