import { describe, expect, it } from "vitest";
import {
  filterMaterials,
  getMaterialFilterOptions,
  materialSourceKey,
  sortMaterials,
  type MaterialListItem,
} from "./material-library-state";

const base: MaterialListItem = {
  id: "a",
  kind: "character",
  name: "阿岚",
  summary: "山民",
  favorite: false,
  hidden: false,
  sourceWorldId: "w-old",
  sourceWorldName: "旧界",
  lastUsedAt: null,
  updatedAt: "2026-01-01",
  versions: [
    {
      id: "v1",
      version: 1,
      name: "初始版 · 创世时",
      isInitial: true,
      createdAt: "2026-01-01",
    },
  ],
};

const defaultFilters = {
  visibility: "visible" as const,
  favoriteOnly: false,
  kind: null,
  source: null,
  version: "all" as const,
  query: "",
};

describe("material library state", () => {
  it("sorts favorites first and hides hidden cards by default", () => {
    const favorite = { ...base, id: "b", favorite: true };
    const hidden = { ...base, id: "c", hidden: true };

    expect(sortMaterials([base, favorite]).map((item) => item.id)).toEqual(["b", "a"]);
    expect(filterMaterials([base, hidden], defaultFilters)).toEqual([base]);
  });

  it("can show only hidden materials instead of mixing them with visible materials", () => {
    const hidden = { ...base, id: "hidden", hidden: true };

    expect(filterMaterials([base, hidden], { ...defaultFilters, visibility: "hidden" })).toEqual([hidden]);
    expect(filterMaterials([base, hidden], { ...defaultFilters, visibility: "all" })).toEqual([base, hidden]);
  });

  it("filters by source world and keeps deleted sources selectable", () => {
    const anotherWorld = { ...base, id: "another", sourceWorldId: "w-new", sourceWorldName: "新界" };
    const deletedSource = { ...base, id: "deleted", sourceWorldId: null, sourceWorldName: "失落之界" };

    expect(filterMaterials([base, anotherWorld, deletedSource], {
      ...defaultFilters,
      source: materialSourceKey(deletedSource),
    })).toEqual([deletedSource]);

    expect(getMaterialFilterOptions([anotherWorld, deletedSource, base]).sources).toEqual([
      { value: materialSourceKey(base), label: "旧界", deleted: false },
      { value: materialSourceKey(anotherWorld), label: "新界", deleted: false },
      { value: materialSourceKey(deletedSource), label: "失落之界", deleted: true },
    ]);
  });

  it("filters initial-only and edited materials by their version history", () => {
    const edited = {
      ...base,
      id: "edited",
      versions: [
        { id: "v2", version: 2, name: "第二纪元", isInitial: false, createdAt: "2026-02-01" },
        ...base.versions,
      ],
    };

    expect(filterMaterials([base, edited], { ...defaultFilters, version: "initial-only" })).toEqual([base]);
    expect(filterMaterials([base, edited], { ...defaultFilters, version: "has-edits" })).toEqual([edited]);
  });

  it("matches every search term across names, summaries, sources, and version names", () => {
    const edited = {
      ...base,
      versions: [
        { id: "v2", version: 2, name: "霜火重铸", isInitial: false, createdAt: "2026-02-01" },
        ...base.versions,
      ],
    };

    expect(filterMaterials([edited], { ...defaultFilters, query: "旧界 霜火" })).toEqual([edited]);
    expect(filterMaterials([edited], { ...defaultFilters, query: "旧界 海民" })).toEqual([]);
  });
});
