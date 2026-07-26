import "server-only";
import { createRequire } from "node:module";
import { getIconData, iconToSVG, replaceIDs } from "@iconify/utils";
import type { SvgIconData } from "@/components/icons/WorldIcon";
import iconSubset from "./icon-subset.generated.json";
import { resolveIcon } from "./resolver";
import { parseWorldIconTheme } from "./theme";
import type { NavigationRole } from "./types";

type IconCollection = Parameters<typeof getIconData>[0];

/**
 * 各集合的全量 icons.json 入口。正常路径只读取构建期抽取的子集
 * (icon-subset.generated.json,由 pnpm build:icons 生成);全量文件仅在
 * 子集缺失请求的图标(目录漂移)时经 createRequire 按需加载,不会被
 * 打进路由包(已在 next.config.ts 的 serverExternalPackages 中外置)。
 */
const FULL_COLLECTION_FILES = {
  ph: "@iconify-json/ph/icons.json",
  tabler: "@iconify-json/tabler/icons.json",
  "icon-park-outline": "@iconify-json/icon-park-outline/icons.json",
  "game-icons": "@iconify-json/game-icons/icons.json",
} as const;

type CollectionPrefix = keyof typeof FULL_COLLECTION_FILES;

const subsetCollections = (iconSubset as unknown as {
  collections: Partial<Record<CollectionPrefix, IconCollection>>;
}).collections;

let fullCollections: Partial<Record<CollectionPrefix, IconCollection>> | null = null;

/**
 * 开发期兜底:catalog.ts 更新后若忘记重新运行 pnpm build:icons,子集会
 * 缺少新图标;此时一次性加载全量集合保证功能不断,并提示重新生成。
 */
function loadFullCollections(): Partial<Record<CollectionPrefix, IconCollection>> {
  if (!fullCollections) {
    console.warn(
      "[icons] icon-subset.generated.json 缺少目录请求的图标(catalog.ts 可能已更新),已回退加载完整 @iconify-json 集合;请运行 pnpm build:icons 重新生成子集。",
    );
    const requireFull = createRequire(import.meta.url);
    fullCollections = Object.fromEntries(
      Object.entries(FULL_COLLECTION_FILES).map(([prefix, file]) => [
        prefix,
        requireFull(file) as IconCollection,
      ]),
    ) as Partial<Record<CollectionPrefix, IconCollection>>;
  }
  return fullCollections;
}

function isCollectionPrefix(value: string): value is CollectionPrefix {
  return value in FULL_COLLECTION_FILES;
}

export function loadLocalIcon(id: string): SvgIconData | null {
  const [prefix = "", name = ""] = id.split(":");
  if (!name || !isCollectionPrefix(prefix)) return null;
  const subset = subsetCollections[prefix];
  let data = subset ? getIconData(subset, name) : null;
  if (!data) {
    const full = loadFullCollections()[prefix];
    data = full ? getIconData(full, name) : null;
  }
  if (!data) return null;
  const rendered = iconToSVG(data, { height: "auto" });
  return {
    body: replaceIDs(rendered.body),
    width: Number(rendered.attributes.width) || data.width || 24,
    height: Number(rendered.attributes.height) || data.height || 24,
  };
}

export function resolveNavigationIcons(value: unknown): {
  theme: ReturnType<typeof parseWorldIconTheme>;
  icons: Record<NavigationRole, SvgIconData | null>;
} {
  const theme = parseWorldIconTheme(value);
  const icons = Object.fromEntries(
    Object.entries(theme.assignments.navigation).map(([role, token]) => {
      const resolved = resolveIcon({
        theme,
        token,
        subjectType: "entity",
        subjectId: `navigation:${role}`,
      });
      return [role, loadLocalIcon(resolved.id)];
    }),
  ) as Record<NavigationRole, SvgIconData | null>;
  return { theme, icons };
}
