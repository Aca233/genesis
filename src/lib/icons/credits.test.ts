import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD_ICON_THEME } from "./theme";
import { collectIconCredits, renderIconCreditsMarkdown } from "./credits";

describe("icon credits", () => {
  it("collects only actually resolved icons and deduplicates shared real IDs", () => {
    const credits = collectIconCredits({
      theme: DEFAULT_WORLD_ICON_THEME,
      assignments: [
        { subjectType: "ability", subjectId: "ability-1", token: "ability.combat" },
        { subjectType: "event", subjectId: "event-1", token: "event.conflict" },
        { subjectType: "event", subjectId: "event-2", token: "event.conflict" },
      ],
    });

    expect(new Set(credits.map((credit) => credit.id)).size).toBe(credits.length);
    expect(credits.some((credit) => credit.id.includes("crossed-swords"))).toBe(true);
    expect(credits.length).toBeLessThan(30);
  });

  it("renders concrete CC BY author and source links", () => {
    const markdown = renderIconCreditsMarkdown(collectIconCredits({
      theme: DEFAULT_WORLD_ICON_THEME,
      assignments: [{ subjectType: "event", subjectId: "event-1", token: "event.conflict" }],
    }));

    expect(markdown).toContain("# Icon Credits");
    expect(markdown).toContain("CC BY 3.0");
    expect(markdown).toContain("Game Icons");
    expect(markdown).toMatch(/https:\/\//u);
  });
});
