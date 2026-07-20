import { describe, expect, it } from "vitest";
import { resolveEffectiveAbilities } from "./resolver";

describe("resolveEffectiveAbilities", () => {
  it("默认继承种族先天能力，但不自动继承族群技艺", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        {
          id: "night-sight",
          kind: "racial_innate",
          name: "夜视",
          state: "normal",
          mastery: "adept",
        },
        {
          id: "shadow-step",
          kind: "racial_tradition",
          name: "影行",
          state: "normal",
          mastery: "adept",
        },
      ],
      characterAbilities: [],
    });

    expect(result.map((ability) => ability.name)).toEqual(["夜视"]);
  });
});
