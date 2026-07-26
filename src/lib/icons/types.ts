export const ICON_FAMILIES = ["phosphor", "tabler", "iconPark", "gameIcons"] as const;
export type IconFamily = (typeof ICON_FAMILIES)[number];

export type IconRole = "interface" | "narrative" | "emblem";

export type AttributionRecord = {
  collection: string;
  icon: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
};

export type IconCatalogEntry = {
  token: string;
  label: string;
  role: IconRole;
  concepts: string[];
  families: Partial<Record<IconFamily, string>>;
  licenses: Partial<Record<IconFamily, string>>;
  genres: string[];
  tones: string[];
  attribution?: AttributionRecord;
};

export type NavigationRole =
  | "activity"
  | "starmap"
  | "chronicle"
  | "god"
  | "creator"
  | "realities"
  | "lore"
  | "codex";

export type WorldIconTheme = {
  version: 1;
  catalogVersion: 1;
  source: "generated" | "default";
  primaryFamily: "phosphor" | "tabler" | "iconPark";
  emblemFamily: "gameIcons" | "phosphor" | "iconPark";
  visualTone: string[];
  motifTags: string[];
  assignments: {
    navigation: Record<NavigationRole, string>;
    entityTypes: Record<string, string>;
    abilityKinds: Record<string, string>;
    eventKinds: Record<string, string>;
    materialTypes: Record<string, string>;
    genesisCards: Record<string, string>;
    narrativeStates: Record<string, string>;
  };
  lockedAssignments: Record<string, string>;
};

export type IconAssignmentValue = {
  token: string;
  source: "generated" | "derived" | "player";
  playerLocked: boolean;
};

export type ResolvedIcon = {
  id: string;
  token: string;
  family: IconFamily;
  license: string;
  attribution?: AttributionRecord;
};
