import type { WorldIconTheme } from "./types";
import { z } from "zod";
import { ICON_CATALOG_BY_TOKEN } from "./catalog";

const NavigationSchema = z.object({
  activity: z.string(),
  starmap: z.string(),
  chronicle: z.string(),
  god: z.string(),
  creator: z.string(),
  realities: z.string(),
  lore: z.string(),
  codex: z.string(),
});

const AssignmentSchema = z.object({
  navigation: NavigationSchema,
  entityTypes: z.record(z.string(), z.string()),
  abilityKinds: z.record(z.string(), z.string()),
  eventKinds: z.record(z.string(), z.string()),
  materialTypes: z.record(z.string(), z.string()),
  genesisCards: z.record(z.string(), z.string()),
  narrativeStates: z.record(z.string(), z.string()),
});

export const WorldIconThemeSchema = z.object({
  version: z.literal(1),
  catalogVersion: z.literal(1),
  source: z.enum(["generated", "default"]),
  primaryFamily: z.enum(["phosphor", "tabler", "iconPark"]),
  emblemFamily: z.enum(["gameIcons", "phosphor", "iconPark"]),
  visualTone: z.array(z.string()).max(12),
  motifTags: z.array(z.string()).max(12),
  assignments: AssignmentSchema,
  lockedAssignments: z.record(z.string(), z.string()),
});

export const DEFAULT_WORLD_ICON_THEME: WorldIconTheme = Object.freeze({
  version: 1,
  catalogVersion: 1,
  source: "default",
  primaryFamily: "phosphor",
  emblemFamily: "gameIcons",
  visualTone: ["structural", "mystical"],
  motifTags: ["星轨", "编年", "现实"],
  assignments: {
    navigation: {
      activity: "world.activity",
      starmap: "cosmos.constellation",
      chronicle: "chronicle.archive",
      god: "divinity.pantheon",
      creator: "observer.transcendent",
      realities: "reality.branch",
      lore: "knowledge.codex",
      codex: "people.collective",
    },
    entityTypes: {
      character: "entity.character",
      faction: "entity.faction",
      race: "entity.race",
      place: "entity.place",
      artifact: "entity.artifact",
      cult: "entity.cult",
    },
    abilityKinds: { ritual: "ability.ritual", combat: "ability.combat" },
    eventKinds: { conflict: "event.conflict", discovery: "event.discovery" },
    materialTypes: {},
    genesisCards: {},
    narrativeStates: {},
  },
  lockedAssignments: {},
});

function knownToken(token: unknown, fallback: string): string {
  return typeof token === "string" && ICON_CATALOG_BY_TOKEN.has(token) ? token : fallback;
}

function knownLockedAssignments(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && ICON_CATALOG_BY_TOKEN.has(entry[1])),
  );
}

export function parseWorldIconTheme(value: unknown): WorldIconTheme {
  const source = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const sourceAssignments = typeof source.assignments === "object" && source.assignments !== null
    ? source.assignments as Record<string, unknown>
    : {};
  const sourceNavigation = typeof sourceAssignments.navigation === "object"
    && sourceAssignments.navigation !== null
    ? sourceAssignments.navigation as Record<string, unknown>
    : {};
  const repaired: WorldIconTheme = {
    ...DEFAULT_WORLD_ICON_THEME,
    source: source.source === "generated" ? "generated" : "default",
    primaryFamily: ["phosphor", "tabler", "iconPark"].includes(String(source.primaryFamily))
      ? source.primaryFamily as WorldIconTheme["primaryFamily"]
      : "phosphor",
    emblemFamily: ["gameIcons", "phosphor", "iconPark"].includes(String(source.emblemFamily))
      ? source.emblemFamily as WorldIconTheme["emblemFamily"]
      : "gameIcons",
    visualTone: Array.isArray(source.visualTone)
      ? source.visualTone.filter((item): item is string => typeof item === "string").slice(0, 12)
      : [...DEFAULT_WORLD_ICON_THEME.visualTone],
    motifTags: Array.isArray(source.motifTags)
      ? source.motifTags.filter((item): item is string => typeof item === "string").slice(0, 12)
      : [...DEFAULT_WORLD_ICON_THEME.motifTags],
    assignments: {
      ...DEFAULT_WORLD_ICON_THEME.assignments,
      navigation: Object.fromEntries(
        Object.entries(DEFAULT_WORLD_ICON_THEME.assignments.navigation)
          .map(([key, fallback]) => [key, knownToken(sourceNavigation[key], fallback)]),
      ) as WorldIconTheme["assignments"]["navigation"],
    },
    lockedAssignments: knownLockedAssignments(source.lockedAssignments),
  };
  return WorldIconThemeSchema.parse(repaired);
}

export function mergeLockedIconAssignments(
  candidate: WorldIconTheme,
  current: unknown,
): WorldIconTheme {
  const parsedCandidate = parseWorldIconTheme(candidate);
  const parsedCurrent = parseWorldIconTheme(current);
  return WorldIconThemeSchema.parse({
    ...parsedCandidate,
    lockedAssignments: parsedCurrent.lockedAssignments,
  });
}

export function buildWorldIconTheme(deck: unknown): WorldIconTheme {
  const serialized = JSON.stringify(deck).toLocaleLowerCase("zh-CN");
  const isTechnical = /(赛博|科技|工业|机械|太空|星舰|都市|cyber|space)/u.test(serialized);
  const isEastern = /(仙侠|东方|宗门|道|灵气|古风)/u.test(serialized);
  return {
    ...DEFAULT_WORLD_ICON_THEME,
    source: "generated",
    primaryFamily: isTechnical ? "tabler" : isEastern ? "iconPark" : "phosphor",
    emblemFamily: "gameIcons",
    visualTone: isTechnical
      ? ["structural", "industrial", "precise"]
      : isEastern
        ? ["ritual", "organic", "delicate"]
        : ["structural", "mystical"],
    motifTags: isTechnical ? ["星轨", "机械", "矩阵"] : isEastern ? ["云纹", "星轨", "山水"] : ["星轨", "编年", "现实"],
  };
}
