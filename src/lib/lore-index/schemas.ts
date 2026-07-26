import { z } from "zod";

/**
 * 资料索引地基（时间一致设计稿 §11，阶段 4 / T4a）。
 *
 * LoreIndexEntry 是 LorebookEntry 之上的持久化分类索引层：导入/上传时一次性
 * 后台批量分类，结果按 sourceKey（条目内容 SHA-256）跨创世复用。索引只是
 * 附加层，不替换 lorebook_entries（SillyTavern 往返导出不受影响）。
 *
 * 时间提示（temporalHints）刻意收敛为一个自由字符串 + 一个闭合枚举：
 * eraGuess 仅作展示与审计线索，绝不参与任何确定性比较（§5.3 序数时间轴
 * 才是唯一可机器校验的时间）。
 */

// ───────────────────────── 类别与时间提示 ─────────────────────────

export const LoreCategorySchema = z.enum([
  "world_rule",
  "timeline",
  "character",
  "faction",
  "place",
  "ability",
  "other",
]);
export type LoreCategory = z.infer<typeof LoreCategorySchema>;

/** 未知/脏类别一律归入 other，绝不抛错（§11 索引层任何问题不阻断创世）。 */
export function normalizeLoreCategory(value: string): LoreCategory {
  const parsed = LoreCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : "other";
}

export const RelativeToMainlineSchema = z.enum(["before", "during", "after", "unknown"]);
export type RelativeToMainline = z.infer<typeof RelativeToMainlineSchema>;

export const TemporalHintsSchema = z.object({
  eraGuess: z
    .string()
    .describe("时代猜测（中文短语，如「主线开篇前的动荡年代」）；无法判断则为空字符串。仅作展示与审计线索，不参与确定性时间比较"),
  relativeToMainline: RelativeToMainlineSchema.describe(
    "内容适用时段相对原作主线的位置：before=主线之前｜during=主线进行中｜after=主线之后｜unknown=条目无时间信号，不得臆测",
  ),
});
export type TemporalHints = z.infer<typeof TemporalHintsSchema>;

export const UNKNOWN_TEMPORAL_HINTS: TemporalHints = {
  eraGuess: "",
  relativeToMainline: "unknown",
};

// ───────────────────────── 分类结果（LLM 结构化输出） ─────────────────────────

/**
 * 单条分类结果。字段 description 是提示词表面（z.toJSONSchema 直接进入
 * 分类 prompt）：中文、精确，改动即改动提示词。
 */
export const ClassifiedLoreEntrySchema = z.object({
  index: z.number().int().min(0).describe("对应输入条目的编号（#N，从 0 起）；每条输入必须恰好返回一条结果"),
  title: z.string().min(1).describe("条目标题（中文，一句话点明主体）"),
  keywords: z.array(z.string().min(1)).min(1).max(8).describe("检索关键词（含专名与常用别名），1-8 个"),
  category: LoreCategorySchema.describe(
    "类别（闭合集）：world_rule=世界法则/体系设定｜timeline=时间线/编年史/大事记｜character=人物｜faction=势力/组织｜place=地点/地理｜ability=能力/功法/魔法体系｜other=其他",
  ),
  temporalHints: TemporalHintsSchema,
  priority: z.number().int().min(0).max(100).describe("创世重要度 0-100：硬性世界法则、主线时间线、核心人物取高值；边角轶闻取低值"),
  excerpt: z
    .string()
    .min(1)
    .describe("浓缩摘录（中文，500 字以内）：逐条保留硬事实——人名、地名、数字、因果与时间线索；不加评论，不复述套话"),
});
export type ClassifiedLoreEntry = z.infer<typeof ClassifiedLoreEntrySchema>;

export const LoreClassificationResultSchema = z.object({
  entries: z.array(ClassifiedLoreEntrySchema).describe("与输入条目一一对应的分类结果"),
});
export type LoreClassificationResult = z.infer<typeof LoreClassificationResultSchema>;

// ───────────────────────── 索引行与证据用量 ─────────────────────────

/** 索引行的领域形状（Prisma 行归一化后 / 新分类行共用）。 */
export type LoreIndexRow = {
  sourceKey: string;
  title: string;
  keywords: string[];
  category: LoreCategory;
  temporalHints: TemporalHints;
  priority: number;
  excerpt: string;
};

/**
 * EvidenceUsage：系统在注入时记录哪条索引进了哪段生成上下文（§11）。
 * 由选择器（selection.ts）产出，不要求模型自报引用。
 */
export const EvidenceUsageSchema = z.object({
  sourceKey: z.string(),
  title: z.string(),
  category: LoreCategorySchema,
  priority: z.number().int(),
  /** 实际注入的字符数（含条目头，不含分隔符） */
  chars: z.number().int().min(0),
  /** 摘录因预算被截断注入 */
  truncated: z.boolean(),
});
export type EvidenceUsage = z.infer<typeof EvidenceUsageSchema>;
