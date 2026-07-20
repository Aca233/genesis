import type { WorldDeck, MajorGodCard, DeckCardKey } from "@/lib/cards/schemas";
import { RANKS } from "@/lib/cards/schemas";

/** 卡片编辑器共用工具：路径读写、枚举中文映射、升格模板 */

export type Rank = (typeof RANKS)[number];

/** 位阶内部枚举 → 中文标签（编辑器用；游玩界面由主题卡措辞映射） */
export const RANK_LABELS: Record<Rank, string> = {
  fallen: "陨灭",
  ember: "余烬",
  slumbering: "沉睡",
  nascent: "微末",
  ascended: "成神",
  exalted: "显赫",
  sovereign: "主宰",
};

export const STANCE_LABELS: Record<string, string> = {
  hostility: "敌意",
  rivalry: "竞争",
  neutral: "中立",
  cooperation: "合作",
  dependence: "依附",
};

export const RELATION_LABELS: Record<string, string> = {
  enemy: "敌对",
  rival: "竞争",
  neutral: "中立",
  ally: "盟友",
  vassal: "隶属",
  unknown: "未知",
};

export const STYLE_PRESET_LABELS: Record<string, string> = {
  epic: "史诗",
  webnovel: "网文",
  grimdark: "黑暗低语",
  lightnovel: "轻小说",
  canon: "原著贴合",
};

/** 重掷组的中文名（提示文案用） */
export const CARD_KEY_LABELS: Record<DeckCardKey, string> = {
  cosmology: "宇宙论",
  fusionAxiom: "融合公理",
  playerGod: "玩家神",
  majorGods: "神谱主神",
  minorGods: "次要神",
  factions: "势力",
  races: "种族",
  majorCharacters: "主要人物",
  places: "地理",
  epochConflict: "纪元冲突",
  style: "叙事风格",
  theme: "主题措辞",
};

/** 按点分路径读值（"majorGods.2.persona"） */
export function getPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

/** 按点分路径写值——沿路径浅拷贝，返回新对象（不改动原值） */
export function setPathClone<T>(root: T, path: string, value: unknown): T {
  const keys = path.split(".");
  function rec(node: unknown, i: number): unknown {
    if (i === keys.length) return value;
    const key = keys[i];
    if (Array.isArray(node)) {
      const copy = node.slice();
      copy[Number(key)] = rec(node[Number(key)], i + 1);
      return copy;
    }
    const obj = (node && typeof node === "object" ? node : {}) as Record<
      string,
      unknown
    >;
    return { ...obj, [key]: rec(obj[key], i + 1) };
  }
  return rec(root, 0) as T;
}

/** 某路径（或其祖先）是否已被玩家手改上锁 */
export function isPathLocked(lockedPaths: string[], path: string): boolean {
  return lockedPaths.some((p) => p === path || path.startsWith(`${p}.`));
}

/** 某基路径下锁定字段计数（卡片墙角标用） */
export function countLockedUnder(lockedPaths: string[], base: string): number {
  return lockedPaths.filter((p) => p === base || p.startsWith(`${base}.`))
    .length;
}

const PLACEHOLDER = "（待补：可用重掷或手改完善）";

/** 次要神升格为主神——占位模板确保过 WorldDeckSchema 校验 */
export function promoteMinorGod(
  minor: WorldDeck["minorGods"][number],
): MajorGodCard {
  const ref = `god-${minor.name}`;
  return {
    ref,
    name: minor.name,
    aliases: [],
    domains: [PLACEHOLDER],
    rank: "nascent",
    persona: minor.brief || PLACEHOLDER,
    voice: {
      verbalTics: [],
      address: PLACEHOLDER,
      catchphrases: [],
      neverSays: [],
    },
    agenda: {
      longTermGoal: PLACEHOLDER,
      shortTermGoals: [],
      methods: PLACEHOLDER,
      stanceToPlayer: { level: "neutral", motive: PLACEHOLDER },
      schemes: [],
    },
    initialRelationToPlayer: { label: "unknown", note: PLACEHOLDER },
    faithScope: PLACEHOLDER,
    abilities: Array.from({ length: 3 }, (_, index) => ({
      ref: `${ref}-ability-${index + 1}`,
      name: `神权${index + 1}`,
      kind: "divine" as const,
      effect: PLACEHOLDER,
      trigger: PLACEHOLDER,
      cost: "无",
      limitations: PLACEHOLDER,
      mastery: "novice" as const,
      state: "normal" as const,
      visibility: "known" as const,
      rumorText: null,
      lockedFields: [],
    })),
  };
}

/** 截取摘要行 */
export function clip(text: string, max = 56): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
