import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD_ICON_THEME } from "./theme";
import { searchIconCatalog } from "./picker";

describe("icon catalog picker", () => {
  it("returns at most one requested page from the selected world family", () => {
    const result = searchIconCatalog({
      theme: { ...DEFAULT_WORLD_ICON_THEME, primaryFamily: "tabler" },
      library: "primary",
      page: 1,
      pageSize: 24,
      query: "",
    });

    expect(result.items.length).toBeLessThanOrEqual(24);
    expect(result.items.every((item) => item.family === "tabler")).toBe(true);
    expect(result.total).toBeGreaterThan(result.items.length);
  });

  it("searches token, Chinese label and concepts without returning another family", () => {
    const result = searchIconCatalog({
      theme: { ...DEFAULT_WORLD_ICON_THEME, emblemFamily: "gameIcons" },
      library: "emblem",
      page: 1,
      pageSize: 12,
      query: "战争",
    });

    expect(result.items).toContainEqual(expect.objectContaining({
      token: "event.conflict",
      family: "gameIcons",
    }));
    expect(result.items.every((item) => item.role === "emblem")).toBe(true);
  });

  it("clamps page size and reports stable pagination", () => {
    const first = searchIconCatalog({
      theme: DEFAULT_WORLD_ICON_THEME,
      library: "primary",
      page: 0,
      pageSize: 500,
      query: "",
    });
    const again = searchIconCatalog({
      theme: DEFAULT_WORLD_ICON_THEME,
      library: "primary",
      page: 1,
      pageSize: 24,
      query: "",
    });

    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(24);
    expect(first.items).toEqual(again.items);
  });
});
