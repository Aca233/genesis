import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import type { SlotName } from "@/lib/llm/types";
import {
  LoreClassificationResultSchema,
  TemporalHintsSchema,
  UNKNOWN_TEMPORAL_HINTS,
  normalizeLoreCategory,
  type LoreIndexRow,
} from "./schemas";

/**
 * 世界书条目批量分类器（时间一致设计稿 §11，T4a）。
 *
 * - 产地：素材导入/上传时的一次性后台批量调用（backstage 槽位），
 *   每批 ≤ 20 条，结果持久化到 lore_index_entries、跨创世复用；
 * - 幂等：sourceKey = 条目内容 SHA-256，已索引条目直接跳过；
 * - 失败语义：任何失败（网络、校验、落库）一律返回 null——调用方回退
 *   原始条目截取（st-import lorebookExcerpts），绝不阻断创世（§11）。
 */

/** 每次分类调用的条目上限（§11：N≤20） */
export const CLASSIFY_BATCH_SIZE = 20;
/** 单条输入内容送入分类 prompt 的字符上限（防超长条目撑爆输入） */
const CONTENT_CHARS_PER_ENTRY = 4000;
/** 摘录落库硬上限（提示词要求 ≤500 字，此处仅防御性截断） */
const LORE_EXCERPT_MAX_CHARS = 800;

export type ClassifiableLoreEntry = {
  keys: string[];
  content: string;
  enabled?: boolean;
};

/** 条目内容的稳定身份：SHA-256 十六进制。跨世界、跨创世稳定。 */
export function loreSourceKey(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const classificationJsonSchema = JSON.stringify(
  z.toJSONSchema(LoreClassificationResultSchema),
  null,
  2,
);

export const LORE_CLASSIFIER_SYSTEM = `You are the lore librarian of a god-roleplay narrative game. Classify SillyTavern lorebook entries into a persistent index used to select the right material for world generation.

Rules:
1. Return EXACTLY one result per input entry, matched by its #index. Never merge, drop or invent entries.
2. category is a closed set: world_rule / timeline / character / faction / place / ability / other. When one entry mixes several aspects, pick the dominant one.
3. temporalHints.relativeToMainline judges WHEN the content applies relative to the source work's mainline: before / during / after. Use "unknown" whenever the entry carries no temporal signal — never guess beyond evidence. eraGuess is a short Chinese era phrase for display only, or an empty string.
4. priority (0-100) measures how important the entry is for generating a faithful world snapshot: hard world laws, mainline timelines and core characters rank high; trivia ranks low.
5. excerpt is a dense Chinese digest (within 500 characters) preserving the entry's hard facts — names, places, numbers, causal links and temporal cues — with no commentary.
6. ALL user-facing string values must be written in Chinese. Keys stay English per schema.

Output ONLY a JSON object matching this JSON Schema. No commentary or markdown fence.

${classificationJsonSchema}`;

export function loreClassifierUserPrompt(batch: ClassifiableLoreEntry[]): string {
  const blocks = batch.map(
    (entry, index) =>
      `#${index} [keys: ${entry.keys.join(", ")}]\n${entry.content.slice(0, CONTENT_CHARS_PER_ENTRY)}`,
  );
  return `Classify each lorebook entry below. Return one result per entry, matched by index.\n\n${blocks.join("\n===\n")}`;
}

type PersistedLoreIndexRow = {
  sourceKey: string;
  title: string;
  keywords: string[];
  category: string;
  temporalHints: unknown;
  priority: number;
  excerpt: string;
};

/** Prisma 行 → 领域行：脏类别归 other、脏时间提示归 unknown，永不抛错。 */
function normalizeRow(row: PersistedLoreIndexRow): LoreIndexRow {
  const hints = TemporalHintsSchema.safeParse(row.temporalHints);
  return {
    sourceKey: row.sourceKey,
    title: row.title,
    keywords: row.keywords,
    category: normalizeLoreCategory(row.category),
    temporalHints: hints.success ? hints.data : UNKNOWN_TEMPORAL_HINTS,
    priority: row.priority,
    excerpt: row.excerpt,
  };
}

/**
 * 批量分类世界书条目并持久化索引行。
 *
 * 返回值：每个**唯一 sourceKey** 一行（输入内去重、已索引复用），顺序与
 * 输入首次出现顺序一致；任何失败返回 null，调用方回退原始条目。
 */
export async function classifyLoreEntries(
  entries: ClassifiableLoreEntry[],
  slot: SlotName = "backstage",
  opts: { userId: string },
): Promise<LoreIndexRow[] | null> {
  const { userId } = opts;
  try {
    const usable = entries.filter(
      (entry) => (entry.enabled ?? true) && entry.content.trim().length > 0,
    );
    if (!usable.length) return [];

    // 输入内去重：同内容（同 sourceKey）只分类一次，首次出现者代表全体
    const bySourceKey = new Map<string, ClassifiableLoreEntry>();
    for (const entry of usable) {
      const key = loreSourceKey(entry.content);
      if (!bySourceKey.has(key)) bySourceKey.set(key, entry);
    }
    const sourceKeys = [...bySourceKey.keys()];

    // 幂等：已索引的 sourceKey 直接复用既有行
    const existing = await prisma.loreIndexEntry.findMany({
      where: { userId, sourceKey: { in: sourceKeys } },
    });
    const existingByKey = new Map(existing.map((row) => [row.sourceKey, row]));
    const pendingKeys = sourceKeys.filter((key) => !existingByKey.has(key));

    const created = new Map<string, LoreIndexRow>();
    for (let offset = 0; offset < pendingKeys.length; offset += CLASSIFY_BATCH_SIZE) {
      const batchKeys = pendingKeys.slice(offset, offset + CLASSIFY_BATCH_SIZE);
      const batch: ClassifiableLoreEntry[] = [];
      for (const key of batchKeys) {
        const entry = bySourceKey.get(key);
        if (entry) batch.push(entry);
      }

      const result = await completeStructured(slot, {
        task: "extract",
        userId,
        system: LORE_CLASSIFIER_SYSTEM,
        user: loreClassifierUserPrompt(batch),
        schema: LoreClassificationResultSchema,
        temperature: 0.2,
        maxTokens: 16000,
      });

      // 结果必须与输入一一对应：缺条、多条、编号越界/重复 → 整体回退
      const seen = new Set<number>();
      const rows: LoreIndexRow[] = [];
      for (const item of result.entries) {
        if (item.index >= batch.length || seen.has(item.index)) return null;
        seen.add(item.index);
        rows.push({
          sourceKey: batchKeys[item.index],
          title: item.title,
          keywords: item.keywords,
          category: item.category,
          temporalHints: item.temporalHints,
          priority: item.priority,
          excerpt: item.excerpt.slice(0, LORE_EXCERPT_MAX_CHARS),
        });
      }
      if (rows.length !== batch.length) return null;

      // skipDuplicates：并发重复分类时后写者静默让位，幂等语义不破
      await prisma.loreIndexEntry.createMany({
        data: rows.map((row) => ({
          userId,
          sourceKey: row.sourceKey,
          title: row.title,
          keywords: row.keywords,
          category: row.category,
          temporalHints: row.temporalHints,
          priority: row.priority,
          excerpt: row.excerpt,
        })),
        skipDuplicates: true,
      });
      for (const row of rows) created.set(row.sourceKey, row);
    }

    const output: LoreIndexRow[] = [];
    for (const key of sourceKeys) {
      const existingRow = existingByKey.get(key);
      if (existingRow) {
        output.push(normalizeRow(existingRow));
        continue;
      }
      const createdRow = created.get(key);
      if (!createdRow) return null;
      output.push(createdRow);
    }
    return output;
  } catch {
    // §11：索引失败不阻断创世——调用方回退原始条目截取并在确认页警告
    return null;
  }
}
