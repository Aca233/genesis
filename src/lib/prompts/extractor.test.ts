import { describe, expect, it } from "vitest";
import {
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
