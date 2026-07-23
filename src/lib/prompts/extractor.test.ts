import { describe, expect, it } from "vitest";
import {
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
