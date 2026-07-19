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
