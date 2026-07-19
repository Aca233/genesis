import { z } from "zod";

/**
 * SillyTavern worldbook 导入解析（docs/03 §5）。
 * 兼容 v2 格式（entries 为对象或数组均可），未识别字段全存 stExtra 保证导出不丢。
 */

const StEntrySchema = z.looseObject({
  uid: z.union([z.number(), z.string()]).optional(),
  key: z.array(z.string()).optional(),
  keys: z.array(z.string()).optional(), // 某些导出用 keys
  keysecondary: z.array(z.string()).optional(),
  content: z.string().default(""),
  comment: z.string().optional(),
  disable: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const StWorldbookSchema = z.looseObject({
  entries: z.union([
    z.record(z.string(), StEntrySchema),
    z.array(StEntrySchema),
  ]),
});

export type ParsedLorebookEntry = {
  keys: string[];
  content: string;
  enabled: boolean;
  stExtra: Record<string, unknown>;
};

export function parseStWorldbook(json: unknown): ParsedLorebookEntry[] {
  const parsed = StWorldbookSchema.parse(json);
  const list = Array.isArray(parsed.entries)
    ? parsed.entries
    : Object.values(parsed.entries);

  return list
    .map((e) => {
      const { key, keys, content, disable, enabled, ...rest } = e;
      return {
        keys: [...new Set([...(key ?? []), ...(keys ?? [])])].filter(Boolean),
        content: content ?? "",
        enabled: enabled ?? !disable,
        stExtra: rest as Record<string, unknown>,
      };
    })
    .filter((e) => e.content.trim().length > 0);
}

/** 供 Genesis 使用的语料摘录（预算裁剪：总量约 8k 字符） */
export function lorebookExcerpts(
  entries: ParsedLorebookEntry[],
  budgetChars = 8000,
): string {
  let used = 0;
  const parts: string[] = [];
  for (const e of entries.filter((e) => e.enabled)) {
    const block = `[keys: ${e.keys.join(", ")}]\n${e.content}`;
    if (used + block.length > budgetChars) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n---\n");
}
