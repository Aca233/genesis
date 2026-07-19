import { z } from "zod";

/**
 * 世界卡组 Schema —— 全项目的数据契约锚点（docs/01 §2.2）。
 * Genesis 生成、卡片编辑器、Narrator 上下文、百科种子全部引用此文件。
 * 所有面向玩家的文本一律中文。
 */

// ───────────────────────── 基础 ─────────────────────────

/** 神力位阶内部枚举（主题卡负责世界观措辞映射） */
export const RANKS = [
  "fallen",     // 陨灭
  "ember",      // 余烬
  "slumbering", // 沉睡
  "nascent",    // 微末
  "ascended",   // 成神
  "exalted",    // 显赫
  "sovereign",  // 主宰
] as const;
export const RankSchema = z.enum(RANKS);

export const StanceSchema = z.enum([
  "hostility",   // 敌意
  "rivalry",     // 竞争
  "neutral",     // 中立
  "cooperation", // 合作
  "dependence",  // 依附
]);

export const RelationLabelSchema = z.enum([
  "enemy",    // 敌对
  "rival",    // 竞争
  "neutral",  // 中立
  "ally",     // 盟友
  "vassal",   // 隶属
  "unknown",  // 未知（星图不画线）
]);

/** 叙事尺度五档：瞬息/场景/数载/年代/纪元 */
export const ScaleSchema = z.enum(["moment", "scene", "years", "era", "epoch"]);
export type Scale = z.infer<typeof ScaleSchema>;

// ───────────────────────── 单卡 ─────────────────────────

export const CosmologyCardSchema = z.object({
  origin: z.string().describe("世界起源"),
  powerSystem: z.string().describe("力量体系"),
  laws: z.string().describe("天道/物理法则"),
  divinity: z.string().describe("神之存在方式：位格来源、信仰依赖等"),
});

export const FusionAxiomCardSchema = z.object({
  sourceIps: z.array(z.string()).min(2).describe("融合的IP列表"),
  axioms: z.array(z.string()).min(1).describe("缝合公理，逐条"),
  powerMapping: z.string().describe("力量对标表"),
  conflictRule: z.string().describe("设定冲突时以谁为准"),
});

export const GodVoiceSchema = z.object({
  verbalTics: z.array(z.string()).describe("语癖"),
  address: z.string().describe("称呼习惯"),
  catchphrases: z.array(z.string()).describe("口头禅"),
  neverSays: z.array(z.string()).describe("绝不会说的话"),
});

export const GodAgendaSchema = z.object({
  longTermGoal: z.string(),
  shortTermGoals: z.array(z.string()),
  methods: z.string().describe("手段偏好"),
  stanceToPlayer: z.object({
    level: StanceSchema,
    motive: z.string().describe("一句话动机"),
  }),
  schemes: z.array(z.string()).describe("进行中的密谋"),
});

export const MajorGodCardSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).describe("别名与称号"),
  domains: z.array(z.string()).describe("领域"),
  rank: RankSchema,
  persona: z.string().describe("性情与外显形象"),
  voice: GodVoiceSchema,
  agenda: GodAgendaSchema.describe("对玩家默认隐藏"),
  initialRelationToPlayer: z.object({
    label: RelationLabelSchema,
    note: z.string(),
  }),
  faithScope: z.string().describe("信仰范围一句话"),
});

export const MinorGodSchema = z.object({
  name: z.string(),
  brief: z.string().describe("一句话设定"),
});

export const PlayerGodCardSchema = z.object({
  name: z.string(),
  origin: z.string().describe("出身：新神/既有神/转生神/篡位者等，从玩家输入推断"),
  domains: z.array(z.string()),
  rank: RankSchema,
  faithBase: z.string().describe("初始信仰势力"),
  situation: z.string().describe("开局处境与钩子"),
});

export const FactionCardSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  kind: z.string().describe("国家/宗门/教团/军团等"),
  overview: z.string(),
  territory: z.string(),
  faith: z.string().describe("信仰归属与浓度"),
  keyFigures: z.array(z.string()).describe("关键人物名"),
});

export const RaceCardSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  traits: z.string(),
  lifespan: z.string(),
  distribution: z.string(),
  divineTies: z.string().describe("与诸神的渊源"),
});

export const PlaceCardSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  kind: z.string().describe("大陆/城市/秘境/圣地"),
  overview: z.string(),
  allegiance: z.string().describe("归属"),
});

export const EpochConflictCardSchema = z.object({
  epochName: z.string().describe("当前纪元名"),
  yearLabel: z.string().describe("当前纪年"),
  overtConflicts: z.array(z.string()).describe("公开的时代矛盾"),
  hiddenCurrents: z.array(z.string()).describe("暗流（对玩家隐藏，作为诸神议程种子）"),
});

export const StyleCardSchema = z.object({
  preset: z.enum(["epic", "webnovel", "grimdark", "lightnovel", "canon"]),
  presetName: z.string().describe("预设中文名"),
  toneNotes: z.string().describe("文风细则"),
});

export const ThemeCardSchema = z.object({
  eraSystem: z.string().describe("纪年体系名，如「帝国历」「天元纪」"),
  rankNames: z
    .record(RankSchema, z.string())
    .describe("位阶的世界观措辞映射，如 nascent→散仙"),
  addressStyle: z.string().describe("称谓习惯"),
});

// ───────────────────────── 卡组 ─────────────────────────

export const WorldDeckSchema = z.object({
  worldName: z.string(),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable().describe("仅多IP融合时非空"),
  playerGod: PlayerGodCardSchema,
  majorGods: z.array(MajorGodCardSchema).min(4).max(10),
  minorGods: z.array(MinorGodSchema),
  factions: z.array(FactionCardSchema).min(2).max(8),
  races: z.array(RaceCardSchema),
  places: z.array(PlaceCardSchema),
  epochConflict: EpochConflictCardSchema,
  style: StyleCardSchema,
  theme: ThemeCardSchema,
});

export type WorldDeck = z.infer<typeof WorldDeckSchema>;
export type MajorGodCard = z.infer<typeof MajorGodCardSchema>;
export type PlayerGodCard = z.infer<typeof PlayerGodCardSchema>;

/** 卡片键（重掷粒度） */
export const DECK_CARD_KEYS = [
  "cosmology",
  "fusionAxiom",
  "playerGod",
  "majorGods",
  "minorGods",
  "factions",
  "races",
  "places",
  "epochConflict",
  "style",
  "theme",
] as const;
export type DeckCardKey = (typeof DECK_CARD_KEYS)[number];
