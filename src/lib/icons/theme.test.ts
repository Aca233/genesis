import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_ICON_THEME,
  WorldIconThemeSchema,
  buildWorldIconTheme,
  mergeLockedIconAssignments,
  parseWorldIconTheme,
} from "./theme";

describe("world icon theme", () => {
  it("builds a complete genre-sensitive theme for new worlds", () => {
    const cyber = buildWorldIconTheme({
      worldName: "霓虹矩阵",
      style: { prose: "赛博朋克、工业、冷峻" },
      cosmology: { summary: "人工智能与轨道都市" },
    });
    expect(cyber.source).toBe("generated");
    expect(cyber.primaryFamily).toBe("tabler");
    expect(Object.keys(cyber.assignments.navigation)).toHaveLength(8);
  });

  it("uses the in-code default for an old world without persisting anything", () => {
    expect(parseWorldIconTheme(null)).toEqual(DEFAULT_WORLD_ICON_THEME);
  });

  it("repairs illegal families and individual tokens locally", () => {
    const repaired = parseWorldIconTheme({
      ...DEFAULT_WORLD_ICON_THEME,
      primaryFamily: "illegal",
      assignments: {
        ...DEFAULT_WORLD_ICON_THEME.assignments,
        navigation: {
          ...DEFAULT_WORLD_ICON_THEME.assignments.navigation,
          realities: "illegal.token",
        },
      },
    });
    expect(repaired.primaryFamily).toBe("phosphor");
    expect(repaired.assignments.navigation.realities).toBe("reality.branch");
    expect(WorldIconThemeSchema.safeParse(repaired).success).toBe(true);
  });

  it("preserves valid world-level locks and drops illegal locked tokens", () => {
    const parsed = parseWorldIconTheme({
      ...DEFAULT_WORLD_ICON_THEME,
      lockedAssignments: {
        "navigation.activity": "event.discovery",
        "navigation.realities": "illegal.token",
      },
    });

    expect(parsed.lockedAssignments).toEqual({
      "navigation.activity": "event.discovery",
    });
  });

  it("merges current world-level locks into a newly forged candidate", () => {
    const candidate = buildWorldIconTheme({ style: "赛博都市" });
    const merged = mergeLockedIconAssignments(candidate, {
      ...DEFAULT_WORLD_ICON_THEME,
      lockedAssignments: { "navigation.activity": "event.discovery" },
    });

    expect(merged.primaryFamily).toBe("tabler");
    expect(merged.lockedAssignments).toEqual({
      "navigation.activity": "event.discovery",
    });
  });
});
