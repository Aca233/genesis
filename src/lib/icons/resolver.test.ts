import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD_ICON_THEME } from "./theme";
import { matchIconConcept, resolveIcon } from "./resolver";

describe("world icon resolver", () => {
  it("uses reality player lock before automatic, world lock, and category assignment", () => {
    const result = resolveIcon({
      theme: {
        ...DEFAULT_WORLD_ICON_THEME,
        lockedAssignments: { "entity.character": "people.collective" },
      },
      token: "entity.character",
      subjectType: "entity",
      subjectId: "entity-1",
      override: {
        token: "cosmos.constellation",
        source: "player",
        playerLocked: true,
      },
    });

    expect(result.token).toBe("cosmos.constellation");
    expect(result.family).toBe(DEFAULT_WORLD_ICON_THEME.primaryFamily);
  });

  it("falls back locally for an unknown token", () => {
    const result = resolveIcon({
      theme: DEFAULT_WORLD_ICON_THEME,
      token: "not.a.real.token",
      subjectType: "ability",
      subjectId: "ability-1",
    });
    expect(result.token).toBe("ability.unknown");
    expect(result.id).toMatch(/^ph:/);
  });

  it("matches natural language concepts and chooses deterministically otherwise", () => {
    expect(matchIconConcept("星辰与群星", "entity", "world-1", "entity-1")).toBe(
      "cosmos.constellation",
    );
    const first = matchIconConcept("无法识别的新母题", "event", "world-1", "event-1");
    const second = matchIconConcept("无法识别的新母题", "event", "world-1", "event-1");
    expect(first).toBe(second);
  });
});
