import { ICON_CATALOG } from "./catalog";
import type { IconFamily, IconRole, WorldIconTheme } from "./types";

export type IconPickerLibrary = "primary" | "emblem";

export type IconPickerItem = {
  token: string;
  label: string;
  role: IconRole;
  family: IconFamily;
  id: string;
  concepts: string[];
};

export function searchIconCatalog(input: {
  theme: WorldIconTheme;
  library: IconPickerLibrary;
  query: string;
  page: number;
  pageSize: number;
}) {
  const family = input.library === "primary"
    ? input.theme.primaryFamily
    : input.theme.emblemFamily;
  const role = input.library === "primary" ? "narrative" : "emblem";
  const query = input.query.trim().toLocaleLowerCase("zh-CN");
  const pageSize = Math.min(24, Math.max(1, Math.trunc(input.pageSize) || 24));
  const candidates = ICON_CATALOG
    .filter((item) => item.role === role && typeof item.families[family] === "string")
    .filter((item) => {
      if (!query) return true;
      return [item.token, item.label, ...item.concepts]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    })
    .map<IconPickerItem>((item) => ({
      token: item.token,
      label: item.label,
      role: item.role,
      family,
      id: item.families[family]!,
      concepts: item.concepts,
    }));
  const pages = Math.max(1, Math.ceil(candidates.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.trunc(input.page) || 1));
  const start = (page - 1) * pageSize;
  return {
    items: candidates.slice(start, start + pageSize),
    total: candidates.length,
    page,
    pageSize,
    pages,
  };
}
