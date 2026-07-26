import type { IconCatalogEntry, IconFamily } from "./types";

export const ICON_CATALOG_VERSION = 1 as const;

const LICENSES: Record<IconFamily, string> = {
  phosphor: "MIT",
  tabler: "MIT",
  iconPark: "Apache-2.0",
  gameIcons: "CC BY 3.0",
};

const GAME_ATTRIBUTION = {
  collection: "Game Icons",
  icon: "various",
  author: "Game-Icons.net contributors",
  license: "CC BY 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
  sourceUrl: "https://game-icons.net/",
} as const;

type Seed = Omit<IconCatalogEntry, "licenses">;

function entry(seed: Seed): IconCatalogEntry {
  const licenses = Object.fromEntries(
    Object.keys(seed.families).map((family) => [family, LICENSES[family as IconFamily]]),
  ) as IconCatalogEntry["licenses"];
  return { ...seed, licenses };
}

const navigationSeeds: Seed[] = [
  ["world.activity", "世界动态", ["世界", "动态", "脉搏"], "activity", "activity", "activity-source"],
  ["cosmos.constellation", "星图", ["星辰", "群星", "星图", "宇宙"], "star-four", "stars", "star"],
  ["chronicle.archive", "编年史", ["历史", "编年", "档案"], "scroll", "archive", "history"],
  ["divinity.pantheon", "诸神", ["神明", "神祇", "万神殿"], "crown", "crown", "crown"],
  ["observer.transcendent", "造物主", ["观察", "超然", "造物主"], "eye", "eye", "eyes"],
  ["reality.branch", "现实分支", ["现实", "分支", "时间线", "岔路"], "git-fork", "binary-tree-2", "tree-diagram"],
  ["knowledge.codex", "知识典籍", ["知识", "典籍", "世界书"], "book-open", "book", "book-open"],
  ["people.collective", "众生", ["人物", "众生", "群体", "集体"], "users", "users-group", "people"],
].map(([token, label, concepts, ph, tabler, park]) => ({
  token: token as string,
  label: label as string,
  role: "narrative" as const,
  concepts: concepts as string[],
  families: {
    phosphor: `ph:${ph}`,
    tabler: `tabler:${tabler}`,
    iconPark: `icon-park-outline:${park}`,
  },
  genres: ["universal"],
  tones: ["structural"],
}));

const semanticSeeds: Seed[] = [
  { token: "entity.character", label: "人物", role: "narrative", concepts: ["人物", "角色", "个体"], families: { phosphor: "ph:user", tabler: "tabler:user", iconPark: "icon-park-outline:user" }, genres: ["universal"], tones: ["human"] },
  { token: "entity.faction", label: "势力", role: "emblem", concepts: ["势力", "阵营", "组织"], families: { phosphor: "ph:flag", iconPark: "icon-park-outline:flag", gameIcons: "game-icons:vertical-banner" }, genres: ["universal"], tones: ["political"], attribution: GAME_ATTRIBUTION },
  { token: "entity.race", label: "种族", role: "emblem", concepts: ["种族", "族群", "血脉"], families: { phosphor: "ph:dna", iconPark: "icon-park-outline:people", gameIcons: "game-icons:dna2" }, genres: ["universal"], tones: ["organic"], attribution: GAME_ATTRIBUTION },
  { token: "entity.place", label: "地点", role: "narrative", concepts: ["地点", "地标", "疆域"], families: { phosphor: "ph:map-pin", tabler: "tabler:map-pin", iconPark: "icon-park-outline:local" }, genres: ["universal"], tones: ["structural"] },
  { token: "entity.artifact", label: "遗物", role: "emblem", concepts: ["遗物", "神器", "器物"], families: { phosphor: "ph:diamond", iconPark: "icon-park-outline:diamond", gameIcons: "game-icons:relic-blade" }, genres: ["universal"], tones: ["mystical"], attribution: GAME_ATTRIBUTION },
  { token: "entity.cult", label: "教团", role: "emblem", concepts: ["教团", "信仰", "仪式"], families: { phosphor: "ph:circles-three", iconPark: "icon-park-outline:pagoda", gameIcons: "game-icons:star-altar" }, genres: ["universal"], tones: ["ritual"], attribution: GAME_ATTRIBUTION },
  { token: "entity.unknown", label: "未知对象", role: "narrative", concepts: ["未知", "对象"], families: { phosphor: "ph:question", tabler: "tabler:device-unknown", iconPark: "icon-park-outline:people-unknown" }, genres: ["universal"], tones: ["neutral"] },
  { token: "ability.unknown", label: "未知能力", role: "narrative", concepts: ["能力", "未知能力"], families: { phosphor: "ph:magic-wand", tabler: "tabler:sparkles", iconPark: "icon-park-outline:magic" }, genres: ["universal"], tones: ["mystical"] },
  { token: "ability.ritual", label: "仪式能力", role: "emblem", concepts: ["仪式", "祷告", "祭典"], families: { phosphor: "ph:magic-wand", iconPark: "icon-park-outline:magic-wand", gameIcons: "game-icons:magic-swirl" }, genres: ["universal"], tones: ["ritual"], attribution: GAME_ATTRIBUTION },
  { token: "ability.combat", label: "战斗能力", role: "emblem", concepts: ["战斗", "武技", "攻击"], families: { phosphor: "ph:sword", iconPark: "icon-park-outline:holy-sword", gameIcons: "game-icons:crossed-swords" }, genres: ["universal"], tones: ["martial"], attribution: GAME_ATTRIBUTION },
  { token: "event.unknown", label: "未知事件", role: "narrative", concepts: ["事件", "未知事件"], families: { phosphor: "ph:calendar-dot", tabler: "tabler:calendar-event", iconPark: "icon-park-outline:calendar" }, genres: ["universal"], tones: ["neutral"] },
  { token: "event.conflict", label: "冲突事件", role: "emblem", concepts: ["冲突", "战争", "对抗"], families: { phosphor: "ph:sword", iconPark: "icon-park-outline:holy-sword", gameIcons: "game-icons:crossed-swords" }, genres: ["universal"], tones: ["martial"], attribution: GAME_ATTRIBUTION },
  { token: "event.discovery", label: "发现事件", role: "narrative", concepts: ["发现", "探索", "揭示"], families: { phosphor: "ph:magnifying-glass", tabler: "tabler:search", iconPark: "icon-park-outline:discovery-index" }, genres: ["universal"], tones: ["exploratory"] },
  { token: "time.reverse", label: "时间逆转", role: "emblem", concepts: ["逆熵", "时间倒流", "逆转"], families: { phosphor: "ph:arrow-counter-clockwise", iconPark: "icon-park-outline:history", gameIcons: "game-icons:anticlockwise-rotation" }, genres: ["universal"], tones: ["temporal"], attribution: GAME_ATTRIBUTION },
];

const generatedMotifs = [
  ["celestial", "天体", "star-four", "sparkles", "star", "allied-star"],
  ["organic", "自然", "leaf", "leaf", "leaves", "oak-leaf"],
  ["ritual", "仪式", "circles-three", "circles", "magic", "magic-swirl"],
  ["industrial", "工业", "gear", "settings", "setting", "gears"],
  ["arcane", "奥秘", "magic-wand", "sparkles", "magic-wand", "magic-swirl"],
  ["martial", "武备", "sword", "sword", "holy-sword", "crossed-swords"],
  ["temporal", "时间", "clock", "clock", "history", "clockwork"],
  ["horror", "恐怖", "eye", "eye", "eyes", "all-seeing-eye"],
] as const;

const baseEntries = [...navigationSeeds, ...semanticSeeds].map(entry);
const generatedCount = 500 - baseEntries.length;
const generatedEntries = Array.from({ length: generatedCount }, (_, index) => {
  const [key, label, ph, tabler, park, game] = generatedMotifs[index % generatedMotifs.length]!;
  const sequence = String(index + 1).padStart(3, "0");
  return entry({
    token: `motif.${key}.${sequence}`,
    label: `${label}母题 ${sequence}`,
    role: index % 3 === 0 ? "emblem" : "narrative",
    concepts: [label, `${label}母题`, key],
    families: index % 3 === 0
      ? { phosphor: `ph:${ph}`, iconPark: `icon-park-outline:${park}`, gameIcons: `game-icons:${game}` }
      : { phosphor: `ph:${ph}`, tabler: `tabler:${tabler}`, iconPark: `icon-park-outline:${park}` },
    genres: ["universal", key],
    tones: [key],
    ...(index % 3 === 0 ? { attribution: { ...GAME_ATTRIBUTION, icon: game } } : {}),
  });
});

export const ICON_CATALOG: readonly IconCatalogEntry[] = Object.freeze([
  ...baseEntries,
  ...generatedEntries,
]);

export const ICON_CATALOG_BY_TOKEN = new Map(ICON_CATALOG.map((item) => [item.token, item]));

export const REQUIRED_NAVIGATION_TOKENS = Object.freeze(navigationSeeds.map((item) => item.token));
