import {
  normalizeLoreCategory,
  type EvidenceUsage,
  type LoreCategory,
} from "./schemas";

/**
 * 创世资料选择器（时间一致设计稿 §11，T4a）。
 *
 * 废除「按上传顺序截取」：按类别字符预算 + 优先级选择索引摘录。
 * 纯函数、零 IO——T4b/创世管线只需喂入索引行与预算。
 *
 * 预算落地（§11 百分比按字符预算落地）：
 *   timeline 30% / world_rule 20% / character 20% / faction 15% / place 10% / other 5%
 * ability 无独立份额，并入 other 桶参与竞争。
 *
 * 两遍算法：
 *   1. 保底份额——每个类别桶按份额预留字符预算，桶内按 priority 降序
 *      （同分按输入序）整块收纳；首个装不下的条目若剩余空间 ≥ 200 字符
 *      则截断收纳，随后该桶关闭（低优先级条目不得在保底份额内插队）；
 *   2. 剩余回填——未选条目按全局 priority 降序整块回填剩余预算，
 *      装不下的跳过（first-fit），总量绝不超过 budgetChars。
 * 每块成本 = 块长 + 分隔符长（保守计费），因此最终摘录总长 ≤ budgetChars。
 *
 * EvidenceUsage 由本函数在注入时记录（系统侧，§11），顺序即注入顺序。
 */

/** 参与预算竞争的桶（ability 并入 other） */
export type LoreBudgetBucket = Exclude<LoreCategory, "ability">;

/** §11 类别字符预算份额（百分比），总和 100 */
export const CATEGORY_BUDGET_SHARES: Record<LoreBudgetBucket, number> = {
  timeline: 30,
  world_rule: 20,
  character: 20,
  faction: 15,
  place: 10,
  other: 5,
};

/** 注入顺序：时间线最先（先定时间，再生世界） */
const BUCKET_ORDER: LoreBudgetBucket[] = [
  "timeline",
  "world_rule",
  "character",
  "faction",
  "place",
  "other",
];

/** 默认创世预算：与被替代的 lorebookExcerpts 原始截取预算一致 */
export const LORE_GENESIS_BUDGET_CHARS = 8000;
/** 截断收纳的最小有效字符数：低于此值的残段没有信息价值，不注入 */
const MIN_TRUNCATED_CHARS = 200;
const SEPARATOR = "\n---\n";

function bucketOf(category: LoreCategory): LoreBudgetBucket {
  return category === "ability" ? "other" : category;
}

/** 选择器输入行：容忍 Prisma 原始行（category 为 string，脏值归 other） */
export type SelectableLoreRow = {
  sourceKey: string;
  title: string;
  category: string;
  priority: number;
  excerpt: string;
};

export type LoreSelection = {
  excerpt: string;
  usage: EvidenceUsage[];
};

function blockHeader(row: SelectableLoreRow): string {
  return `[${normalizeLoreCategory(row.category)}|${row.title}]`;
}

function renderBlock(row: SelectableLoreRow): string {
  return `${blockHeader(row)}\n${row.excerpt}`;
}

export function selectLoreForGenesis(
  indexRows: SelectableLoreRow[],
  budgetChars = LORE_GENESIS_BUDGET_CHARS,
): LoreSelection {
  if (budgetChars <= 0 || indexRows.length === 0) return { excerpt: "", usage: [] };

  // 去重：同 sourceKey 首行生效；order 记录输入序作为同优先级次序
  type WorkRow = { row: SelectableLoreRow; order: number; bucket: LoreBudgetBucket };
  const rows: WorkRow[] = [];
  const seenKeys = new Set<string>();
  indexRows.forEach((row, order) => {
    if (seenKeys.has(row.sourceKey)) return;
    seenKeys.add(row.sourceKey);
    rows.push({ row, order, bucket: bucketOf(normalizeLoreCategory(row.category)) });
  });

  const byPriority = (a: WorkRow, b: WorkRow) =>
    b.row.priority - a.row.priority || a.order - b.order;

  type Selected = { row: SelectableLoreRow; text: string; truncated: boolean };
  const selected: Selected[] = [];
  const selectedKeys = new Set<string>();
  let totalUsed = 0;

  // ── 第一遍：各类别保底份额 ──
  for (const bucket of BUCKET_ORDER) {
    let remaining = Math.floor((budgetChars * CATEGORY_BUDGET_SHARES[bucket]) / 100);
    const bucketRows = rows.filter((r) => r.bucket === bucket).sort(byPriority);
    for (const work of bucketRows) {
      const block = renderBlock(work.row);
      const cost = block.length + SEPARATOR.length;
      if (cost <= remaining) {
        selected.push({ row: work.row, text: block, truncated: false });
        selectedKeys.add(work.row.sourceKey);
        remaining -= cost;
        totalUsed += cost;
        continue;
      }
      const header = blockHeader(work.row);
      const room = remaining - SEPARATOR.length - header.length - 1;
      if (room >= MIN_TRUNCATED_CHARS) {
        const text = `${header}\n${work.row.excerpt.slice(0, room)}`;
        selected.push({ row: work.row, text, truncated: true });
        selectedKeys.add(work.row.sourceKey);
        totalUsed += text.length + SEPARATOR.length;
      }
      break; // 桶预算耗尽：低优先级条目不得在保底份额内插队
    }
  }

  // ── 第二遍：剩余预算按全局优先级回填（只收整块，first-fit） ──
  const leftovers = rows.filter((r) => !selectedKeys.has(r.row.sourceKey)).sort(byPriority);
  for (const work of leftovers) {
    const block = renderBlock(work.row);
    const cost = block.length + SEPARATOR.length;
    if (totalUsed + cost > budgetChars) continue;
    selected.push({ row: work.row, text: block, truncated: false });
    selectedKeys.add(work.row.sourceKey);
    totalUsed += cost;
  }

  return {
    excerpt: selected.map((s) => s.text).join(SEPARATOR),
    usage: selected.map((s) => ({
      sourceKey: s.row.sourceKey,
      title: s.row.title,
      category: normalizeLoreCategory(s.row.category),
      priority: s.row.priority,
      chars: s.text.length,
      truncated: s.truncated,
    })),
  };
}
