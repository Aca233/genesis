import { afterEach, describe, expect, it, vi } from "vitest";
import { ICON_CATALOG } from "./catalog";
import iconSubset from "./icon-subset.generated.json";
import { loadLocalIcon, resolveNavigationIcons } from "./svg.server";

const subsetPhNames = Object.keys(
  (iconSubset as unknown as { collections: { ph: { icons: Record<string, unknown> } } })
    .collections.ph.icons,
);

describe("svg.server icon subset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves every catalog icon id and the resolver fallback from the generated subset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ids = new Set<string>(["ph:question"]);
    for (const entry of ICON_CATALOG) {
      for (const id of Object.values(entry.families)) ids.add(id);
    }
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      const icon = loadLocalIcon(id);
      expect(icon?.body, id).toBeTruthy();
      expect(icon?.width, id).toBeGreaterThan(0);
      expect(icon?.height, id).toBeGreaterThan(0);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolves all navigation icons for the default theme without fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { icons } = resolveNavigationIcons(null);
    for (const [role, icon] of Object.entries(icons)) {
      expect(icon?.body, role).toBeTruthy();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns null for unknown prefixes and malformed ids", () => {
    expect(loadLocalIcon("nope:question")).toBeNull();
    expect(loadLocalIcon("ph:")).toBeNull();
    expect(loadLocalIcon("just-a-name")).toBeNull();
  });

  it("falls back to the full collection with a single warning when the subset misses an id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(subsetPhNames).not.toContain("acorn");
    expect(subsetPhNames).not.toContain("alarm");
    const first = loadLocalIcon("ph:acorn");
    expect(first?.body).toBeTruthy();
    const second = loadLocalIcon("ph:alarm");
    expect(second?.body).toBeTruthy();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("build:icons");
  });
});
