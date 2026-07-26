import { ICON_CATALOG, ICON_CATALOG_BY_TOKEN } from "./catalog";
import type {
  IconAssignmentValue,
  IconCatalogEntry,
  IconFamily,
  ResolvedIcon,
  WorldIconTheme,
} from "./types";

type SubjectType = "entity" | "god" | "ability" | "event";

const DEFAULT_TOKEN: Record<SubjectType, string> = {
  entity: "entity.unknown",
  god: "divinity.pantheon",
  ability: "ability.unknown",
  event: "event.unknown",
};

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function categoryToken(theme: WorldIconTheme, token: string, subjectType: SubjectType): string {
  const key = token.split(".").at(-1) ?? token;
  if (subjectType === "entity") return theme.assignments.entityTypes[key] ?? token;
  if (subjectType === "ability") return theme.assignments.abilityKinds[key] ?? token;
  if (subjectType === "event") return theme.assignments.eventKinds[key] ?? token;
  return token;
}

function familyFor(theme: WorldIconTheme, item: IconCatalogEntry): IconFamily {
  return item.role === "emblem" ? theme.emblemFamily : theme.primaryFamily;
}

export function resolveIcon(input: {
  theme: WorldIconTheme;
  token: string;
  subjectType: SubjectType;
  subjectId: string;
  override?: IconAssignmentValue | null;
}): ResolvedIcon {
  const worldLocked = input.theme.lockedAssignments[`${input.subjectType}.${input.subjectId}`]
    ?? input.theme.lockedAssignments[input.token];
  const requested = input.override?.token
    ?? worldLocked
    ?? categoryToken(input.theme, input.token, input.subjectType);
  const fallbackToken = DEFAULT_TOKEN[input.subjectType];
  const item = ICON_CATALOG_BY_TOKEN.get(requested) ?? ICON_CATALOG_BY_TOKEN.get(fallbackToken)!;
  const preferredFamily = familyFor(input.theme, item);
  const id = item.families[preferredFamily] ?? item.families.phosphor;
  if (id) {
    const family = item.families[preferredFamily] ? preferredFamily : "phosphor";
    return {
      id,
      token: item.token,
      family,
      license: item.licenses[family] ?? "MIT",
      ...(family === "gameIcons" && item.attribution ? { attribution: item.attribution } : {}),
    };
  }
  return { id: "ph:question", token: fallbackToken, family: "phosphor", license: "MIT" };
}

export function matchIconConcept(
  concept: string | undefined,
  subjectType: SubjectType,
  worldId: string,
  subjectId: string,
): string {
  const normalized = concept?.trim().toLocaleLowerCase("zh-CN") ?? "";
  if (ICON_CATALOG_BY_TOKEN.has(normalized)) return normalized;
  if (normalized) {
    const matched = ICON_CATALOG.find((item) =>
      item.concepts.some((candidate) => normalized.includes(candidate.toLocaleLowerCase("zh-CN"))),
    );
    if (matched) return matched.token;
  }
  const prefix = subjectType === "god" ? "entity" : subjectType;
  const candidates = ICON_CATALOG.filter((item) =>
    item.token.startsWith(`${prefix}.`) || item.token.startsWith("motif."),
  );
  if (candidates.length === 0) return DEFAULT_TOKEN[subjectType];
  return candidates[stableIndex(`${worldId}:${subjectType}:${subjectId}`, candidates.length)]!.token;
}
