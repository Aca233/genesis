import "server-only";
import { icons as phosphorIcons } from "@iconify-json/ph";
import { icons as tablerIcons } from "@iconify-json/tabler";
import { icons as iconParkIcons } from "@iconify-json/icon-park-outline";
import { icons as gameIcons } from "@iconify-json/game-icons";
import { getIconData, iconToSVG, replaceIDs } from "@iconify/utils";
import type { SvgIconData } from "@/components/icons/WorldIcon";
import { resolveIcon } from "./resolver";
import { parseWorldIconTheme } from "./theme";
import type { NavigationRole } from "./types";

const collections = {
  ph: phosphorIcons,
  tabler: tablerIcons,
  "icon-park-outline": iconParkIcons,
  "game-icons": gameIcons,
} as const;

export function loadLocalIcon(id: string): SvgIconData | null {
  const [prefix, name] = id.split(":");
  const collection = collections[prefix as keyof typeof collections];
  if (!collection || !name) return null;
  const data = getIconData(collection, name);
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
