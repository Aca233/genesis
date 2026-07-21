import { describe, expect, it } from "vitest";
import { MaterialVersionContentSchema, parseMaterialVersionContent } from "./schemas";

const validAbility = {
  ref: "ability-star", name: "星火", kind: "divine", effect: "点燃星火", trigger: "祈祷",
  cost: "信仰", limitations: "仅夜空", mastery: "adept", state: "normal",
  visibility: "hidden", rumorText: null, lockedFields: [],
};

describe("material content schemas", () => {
  it("accepts standalone abilities with their original owner", () => {
    expect(MaterialVersionContentSchema.safeParse({
      schemaVersion: 1, origin: "deck", kind: "ability", card: validAbility,
      owner: { kind: "god", sourceRef: "god-star" },
    }).success).toBe(true);
  });
  it("rejects unknown future schema versions without mutating history", () => {
    expect(() => parseMaterialVersionContent({ schemaVersion: 2, kind: "theme" })).toThrow(/不支持/);
  });
});
