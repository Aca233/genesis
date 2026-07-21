export type MaterialVersionListItem = {
  id: string;
  version: number;
  name: string;
  isInitial: boolean;
  createdAt: string;
};

export type MaterialListItem = {
  id: string;
  kind: string;
  name: string;
  summary: string;
  favorite: boolean;
  hidden: boolean;
  sourceWorldId: string | null;
  sourceWorldName: string;
  lastUsedAt: string | null;
  updatedAt: string;
  versions: MaterialVersionListItem[];
};

export type MaterialVisibility = "visible" | "hidden" | "all";
export type MaterialVersionFilter = "all" | "initial-only" | "has-edits";
export type MaterialFilters = {
  visibility: MaterialVisibility;
  favoriteOnly: boolean;
  kind: string | null;
  source: string | null;
  version: MaterialVersionFilter;
  query: string;
};

export type MaterialSourceOption = {
  value: string;
  label: string;
  deleted: boolean;
};

export function materialSourceKey(item: Pick<MaterialListItem, "sourceWorldId" | "sourceWorldName">) {
  return item.sourceWorldId
    ? `world:${item.sourceWorldId}`
    : `deleted:${encodeURIComponent(item.sourceWorldName)}`;
}

export function getMaterialFilterOptions(items: MaterialListItem[]) {
  const sourcesByValue = new Map<string, MaterialSourceOption>();

  for (const item of items) {
    const value = materialSourceKey(item);
    if (!sourcesByValue.has(value)) {
      sourcesByValue.set(value, {
        value,
        label: item.sourceWorldName,
        deleted: item.sourceWorldId === null,
      });
    }
  }

  const sources = [...sourcesByValue.values()].sort((a, b) =>
    Number(a.deleted) - Number(b.deleted)
      || a.label.localeCompare(b.label, "zh-CN")
      || a.value.localeCompare(b.value),
  );

  return { sources };
}

export function filterMaterials(items: MaterialListItem[], filters: MaterialFilters) {
  const terms = filters.query
    .trim()
    .toLocaleLowerCase("zh-CN")
    .split(/\s+/u)
    .filter(Boolean);

  return items.filter((item) => {
    const matchesVisibility = filters.visibility === "all"
      || (filters.visibility === "hidden" ? item.hidden : !item.hidden);
    const hasEditedVersion = item.versions.some((version) => !version.isInitial);
    const matchesVersion = filters.version === "all"
      || (filters.version === "has-edits" ? hasEditedVersion : !hasEditedVersion);
    const searchText = [
      item.name,
      item.summary,
      item.sourceWorldName,
      ...item.versions.map((version) => version.name),
    ].join("\n").toLocaleLowerCase("zh-CN");

    return matchesVisibility
      && (!filters.favoriteOnly || item.favorite)
      && (!filters.kind || item.kind === filters.kind)
      && (!filters.source || materialSourceKey(item) === filters.source)
      && matchesVersion
      && terms.every((term) => searchText.includes(term));
  });
}

export function sortMaterials(items: MaterialListItem[]) {
  return [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite)
    || Date.parse(b.lastUsedAt ?? b.updatedAt) - Date.parse(a.lastUsedAt ?? a.updatedAt));
}
