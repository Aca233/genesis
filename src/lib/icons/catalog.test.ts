import { describe, expect, it } from "vitest";
import { icons as phosphorIcons } from "@iconify-json/ph";
import { icons as tablerIcons } from "@iconify-json/tabler";
import { icons as iconParkIcons } from "@iconify-json/icon-park-outline";
import { icons as gameIcons } from "@iconify-json/game-icons";
import {
  ICON_CATALOG,
  ICON_CATALOG_VERSION,
  REQUIRED_NAVIGATION_TOKENS,
} from "./catalog";

describe("world icon catalog", () => {
  it("publishes a stable curated catalog with 500 unique semantic tokens", () => {
    expect(ICON_CATALOG_VERSION).toBe(1);
    expect(ICON_CATALOG).toHaveLength(500);
    expect(new Set(ICON_CATALOG.map((entry) => entry.token)).size).toBe(500);
  });

  it("records licensing for every concrete mapping", () => {
    const collections = {
      ph: phosphorIcons,
      tabler: tablerIcons,
      "icon-park-outline": iconParkIcons,
      "game-icons": gameIcons,
    } as const;
    for (const entry of ICON_CATALOG) {
      for (const [family, icon] of Object.entries(entry.families)) {
        expect(icon, `${entry.token}:${family}`).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
        expect(entry.licenses[family as keyof typeof entry.licenses]).toBeTruthy();
        const [prefix, name] = icon.split(":") as [keyof typeof collections, string];
        expect(collections[prefix].icons[name], `${entry.token}:${icon}`).toBeTruthy();
      }
    }
  });

  it("keeps CC BY mappings attributable to a concrete author and source", () => {
    for (const entry of ICON_CATALOG) {
      if (!entry.families.gameIcons) continue;
      expect(entry.attribution?.author, entry.token).toBeTruthy();
      expect(entry.attribution?.license, entry.token).toBe("CC BY 3.0");
      expect(entry.attribution?.sourceUrl, entry.token).toMatch(/^https:\/\//);
    }
  });

  it("covers every navigation token in every allowed primary family", () => {
    for (const token of REQUIRED_NAVIGATION_TOKENS) {
      const entry = ICON_CATALOG.find((candidate) => candidate.token === token);
      expect(entry, token).toBeTruthy();
      expect(entry?.families.phosphor, token).toBeTruthy();
      expect(entry?.families.tabler, token).toBeTruthy();
      expect(entry?.families.iconPark, token).toBeTruthy();
    }
  });
});
