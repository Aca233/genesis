import type { ThemeCard } from "./types";

/**
 * 古卷措辞映射：位阶与关系的中文化。
 * 位阶优先用主题卡 rankNames 的世界观措辞，缺省回退默认谱系（docs/01 §7.1）。
 */

export const RANK_FALLBACK: Record<string, string> = {
  fallen: "陨灭",
  ember: "余烬",
  slumbering: "沉睡",
  nascent: "微末",
  ascended: "成神",
  exalted: "显赫",
  sovereign: "主宰",
};

export function rankName(theme: ThemeCard | null | undefined, rank: string): string {
  return theme?.rankNames?.[rank] ?? RANK_FALLBACK[rank] ?? rank;
}

/** 与玩家神关系的中文化（docs schemas RelationLabel） */
export const RELATION_LABELS: Record<string, string> = {
  enemy: "敌对",
  rival: "竞争",
  neutral: "中立",
  ally: "盟友",
  vassal: "隶属",
  unknown: "未知",
};

export function relationName(label: string | undefined): string {
  if (!label) return "未知";
  return RELATION_LABELS[label] ?? label;
}

/** 关系徽章配色（敌对朱红 / 盟友烫金 / 其余淡墨） */
export function relationTone(label: string | undefined): string {
  if (label === "enemy") return "border-cinnabar/50 text-cinnabar";
  if (label === "ally") return "border-gilt/50 text-gilt";
  return "border-line text-ink-faint";
}

/** 实体六类的通用回退名（主题卡 typeNames 缺省时用） */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  faction: "势力",
  character: "人物",
  race: "种族",
  place: "地域",
  artifact: "神物",
  cult: "教派",
};

/** 优先主题卡的世界观措辞（修仙界「宗门势力」/ 哥特帝国「军团诸侯」…） */
export function entityTypeName(
  theme: ThemeCard | null | undefined,
  type: string,
): string {
  return theme?.typeNames?.[type] ?? ENTITY_TYPE_LABELS[type] ?? type;
}

/** 众生录分组展示顺序 */
export const ENTITY_TYPE_ORDER = [
  "faction",
  "character",
  "race",
  "place",
  "artifact",
  "cult",
] as const;

/** 实体栏目键 → 通用回退标题（史官生成的 content.title 优先） */
export const SECTION_LABELS: Record<string, string> = {
  overview: "总览",
  territory: "疆域",
  polity: "政体",
  faith: "信仰",
  keyFigures: "要人",
  military: "武力",
  identity: "身份",
  affiliation: "所属",
  lifespan: "寿数",
  personality: "性情",
  faithHistory: "信史",
  relationToPlayer: "与本尊之缘",
  distribution: "分布",
  divineTies: "神缘",
  innerFactions: "内争",
  kind: "类属",
  allegiance: "归属",
  geography: "山川形胜",
  majorEvents: "大事",
  holder: "持有者",
  powers: "神异",
  origin: "来历",
  whereabouts: "下落",
  deity: "所奉之神",
  doctrine: "教义",
  holySites: "圣地",
  structure: "教阶",
  heresies: "异端",
  secularTies: "俗世牵连",
};

export function sectionName(key: string): string {
  return SECTION_LABELS[key] ?? key;
}

/** 事件阶段的中文化（世界动态 EventCard 用） */
export const EVENT_PHASE_LABELS: Record<string, string> = {
  emerging: "萌动",
  developing: "酝酿",
  escalating: "激化",
  resolved: "已了",
};

export function eventPhaseName(phase: string): string {
  return EVENT_PHASE_LABELS[phase] ?? phase;
}
