import type { PrismaClient } from "@prisma/client";
import {
  RealityNotFoundError,
  loadRealityTree,
  type RealityNodeDto,
} from "./tree";

/** 对照请求不合法（既非父子、亦非同父兄弟） */
export class RealityCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealityCompareError";
  }
}

export type CompareRelationship =
  | { kind: "parent-child"; parentId: string; childId: string }
  | { kind: "siblings" };

type CompareNode = { id: string; parentId: string | null; forkChapter: number | null };

/** U+0000 分隔符：拼接复合键时避免「纪年/正文」「类型/名称」边界歧义 */
const KEY_SEPARATOR = String.fromCharCode(0);

/**
 * 仅允许父子或同父兄弟两界对照。
 * 纯函数：客户端在发起请求前可直接用现实树节点做同一校验。
 */
export function resolveCompareRelationship(
  nodes: readonly CompareNode[],
  leftId: string,
  rightId: string,
): CompareRelationship {
  const left = nodes.find((node) => node.id === leftId);
  const right = nodes.find((node) => node.id === rightId);
  if (left === undefined || right === undefined || leftId === rightId) {
    throw new RealityCompareError("仅支持父子或同父兄弟现实对照");
  }
  if (right.parentId === left.id) {
    return { kind: "parent-child", parentId: left.id, childId: right.id };
  }
  if (left.parentId === right.id) {
    return { kind: "parent-child", parentId: right.id, childId: left.id };
  }
  if (left.parentId !== null && left.parentId === right.parentId) {
    return { kind: "siblings" };
  }
  throw new RealityCompareError("仅支持父子或同父兄弟现实对照");
}

export type ChronicleDiffEntry = {
  id: string;
  chapterIndex: number;
  yearLabel: string;
  text: string;
  source: string;
  revealed: boolean;
};

export type ChronicleDiff = {
  commonCount: number;
  leftOnly: ChronicleDiffEntry[];
  rightOnly: ChronicleDiffEntry[];
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byChapterThenId(left: ChronicleDiffEntry, right: ChronicleDiffEntry): number {
  return left.chapterIndex - right.chapterIndex || compareStrings(left.id, right.id);
}

function chronicleKey(row: ChronicleDiffEntry): string {
  return row.yearLabel + KEY_SEPARATOR + row.text;
}

function countByKey(rows: readonly ChronicleDiffEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = chronicleKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * 编年史多重集对照：克隆共享的历史逐字相同，按「纪年+正文」自动折叠；
 * 被敕令改写的条目会以一条 leftOnly + 一条 rightOnly 成对浮现——那正是分歧信号。
 */
export function diffChronicles(
  left: readonly ChronicleDiffEntry[],
  right: readonly ChronicleDiffEntry[],
): ChronicleDiff {
  const leftSorted = [...left].sort(byChapterThenId);
  const rightSorted = [...right].sort(byChapterThenId);

  let commonCount = 0;
  const leftOnly: ChronicleDiffEntry[] = [];
  const rightRemaining = countByKey(rightSorted);
  for (const row of leftSorted) {
    const key = chronicleKey(row);
    const remaining = rightRemaining.get(key) ?? 0;
    if (remaining > 0) {
      rightRemaining.set(key, remaining - 1);
      commonCount += 1;
    } else {
      leftOnly.push(row);
    }
  }

  const rightOnly: ChronicleDiffEntry[] = [];
  const leftRemaining = countByKey(leftSorted);
  for (const row of rightSorted) {
    const key = chronicleKey(row);
    const remaining = leftRemaining.get(key) ?? 0;
    if (remaining > 0) {
      leftRemaining.set(key, remaining - 1);
    } else {
      rightOnly.push(row);
    }
  }

  return { commonCount, leftOnly, rightOnly };
}

export type EntityDiffInput = {
  name: string;
  type: string;
  summary: string;
  sections: Array<{ key: string; content: unknown; revealed: boolean }>;
};

export type EntitySectionDiff = { key: string; left: string | null; right: string | null };

export type EntityDiff = {
  name: string;
  type: string;
  presence: "both" | "left-only" | "right-only";
  summaryDiff: { left: string; right: string } | null;
  sectionDiffs: EntitySectionDiff[];
};

const SECTION_CLIP_CHARS = 400;
const ENTITY_DIFF_CAP = 40;

function sectionText(content: unknown): string {
  if (typeof content === "string") return content;
  if (
    content !== null
    && content !== undefined
    && typeof content === "object"
    && !Array.isArray(content)
    && typeof (content as { text?: unknown }).text === "string"
  ) {
    return (content as { text: string }).text;
  }
  return JSON.stringify(content ?? null);
}

function clip(value: string): string {
  return Array.from(value).slice(0, SECTION_CLIP_CHARS).join("");
}

function entityKey(entity: EntityDiffInput): string {
  return entity.type + KEY_SEPARATOR + entity.name;
}

function firstByKey(entities: readonly EntityDiffInput[]): Map<string, EntityDiffInput> {
  const byKey = new Map<string, EntityDiffInput>();
  for (const entity of entities) {
    const key = entityKey(entity);
    if (!byKey.has(key)) byKey.set(key, entity);
  }
  return byKey;
}

function buildSectionDiffs(left: EntityDiffInput, right: EntityDiffInput): EntitySectionDiff[] {
  const leftByKey = new Map(left.sections.map((section) => [section.key, section]));
  const rightByKey = new Map(right.sections.map((section) => [section.key, section]));
  const keys = [...new Set([...leftByKey.keys(), ...rightByKey.keys()])].sort(compareStrings);
  const diffs: EntitySectionDiff[] = [];
  for (const key of keys) {
    const leftSection = leftByKey.get(key);
    const rightSection = rightByKey.get(key);
    const leftText = leftSection === undefined ? null : clip(sectionText(leftSection.content));
    const rightText = rightSection === undefined ? null : clip(sectionText(rightSection.content));
    if (leftText !== rightText) diffs.push({ key, left: leftText, right: rightText });
  }
  return diffs;
}

/**
 * 众生对照：按「类型+名称」配对，仅输出有分歧的实体（存在性分歧优先、名称序次之），
 * 上限 40 条；摘要与栏目文本各截取前 400 字。
 */
export function diffEntities(
  left: readonly EntityDiffInput[],
  right: readonly EntityDiffInput[],
): EntityDiff[] {
  const leftByKey = firstByKey(left);
  const rightByKey = firstByKey(right);
  const keys = new Set([...leftByKey.keys(), ...rightByKey.keys()]);

  const diffs: EntityDiff[] = [];
  for (const key of keys) {
    const leftEntity = leftByKey.get(key);
    const rightEntity = rightByKey.get(key);
    if (leftEntity !== undefined && rightEntity !== undefined) {
      const summaryDiff = leftEntity.summary !== rightEntity.summary
        ? { left: clip(leftEntity.summary), right: clip(rightEntity.summary) }
        : null;
      const sectionDiffs = buildSectionDiffs(leftEntity, rightEntity);
      if (summaryDiff === null && sectionDiffs.length === 0) continue;
      diffs.push({
        name: leftEntity.name,
        type: leftEntity.type,
        presence: "both",
        summaryDiff,
        sectionDiffs,
      });
    } else {
      const entity = leftEntity ?? rightEntity;
      if (entity === undefined) continue;
      diffs.push({
        name: entity.name,
        type: entity.type,
        presence: leftEntity !== undefined ? "left-only" : "right-only",
        summaryDiff: null,
        sectionDiffs: [],
      });
    }
  }

  diffs.sort((a, b) => {
    const presenceRank = (diff: EntityDiff) => (diff.presence === "both" ? 1 : 0);
    return presenceRank(a) - presenceRank(b)
      || compareStrings(a.name, b.name)
      || compareStrings(a.type, b.type);
  });
  return diffs.slice(0, ENTITY_DIFF_CAP);
}

export type RealityComparisonDto = {
  left: RealityNodeDto;
  right: RealityNodeDto;
  relationship: CompareRelationship;
  divergenceLabel: string;
  chronicle: ChronicleDiff;
  entities: EntityDiff[];
};

type CompareReader = Pick<
  PrismaClient,
  "world" | "timeline" | "realityRewrite" | "chronicleEntry" | "entity"
>;

function forkLabel(node: RealityNodeDto): string {
  return node.forkTimeLabel ?? `第${node.forkChapter}卷`;
}

/**
 * 只读比较两个父子/同父兄弟现实的编年史与众生分歧。
 * omniscient=false（万神殿观者）时在查询结果映射处过滤暗记与未揭示栏目，
 * 纯对照函数保持与观者无关。
 */
export async function loadRealityComparison(
  db: CompareReader,
  worldId: string,
  leftId: string,
  rightId: string,
  options: { omniscient: boolean } = { omniscient: true },
): Promise<RealityComparisonDto> {
  const tree = await loadRealityTree(db, worldId);
  const leftNode = tree.nodes.find((node) => node.id === leftId);
  const rightNode = tree.nodes.find((node) => node.id === rightId);
  if (leftNode === undefined || rightNode === undefined) {
    throw new RealityNotFoundError("对照现实不存在");
  }
  const relationship = resolveCompareRelationship(tree.nodes, leftId, rightId);

  const [chronicleRows, entityRows] = await Promise.all([
    db.chronicleEntry.findMany({
      where: { timelineId: { in: [leftId, rightId] } },
      orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        timelineId: true,
        chapterIndex: true,
        yearLabel: true,
        text: true,
        source: true,
        revealed: true,
      },
    }),
    db.entity.findMany({
      where: { timelineId: { in: [leftId, rightId] } },
      select: {
        name: true,
        type: true,
        timelineId: true,
        summary: true,
        sections: { select: { key: true, content: true, revealed: true } },
      },
    }),
  ]);

  const visibleChronicles = options.omniscient
    ? chronicleRows
    : chronicleRows.filter((row) => row.revealed);
  const visibleEntities = entityRows.map((row) => ({
    ...row,
    sections: options.omniscient
      ? row.sections
      : row.sections.filter((section) => section.revealed),
  }));

  const chronicleFor = (timelineId: string) =>
    visibleChronicles.filter((row) => row.timelineId === timelineId);
  const entitiesFor = (timelineId: string) =>
    visibleEntities.filter((row) => row.timelineId === timelineId);

  const divergenceLabel = relationship.kind === "parent-child"
    ? forkLabel(relationship.childId === leftId ? leftNode : rightNode)
    : `${forkLabel(leftNode)} / ${forkLabel(rightNode)}`;

  return {
    left: leftNode,
    right: rightNode,
    relationship,
    divergenceLabel,
    chronicle: diffChronicles(chronicleFor(leftId), chronicleFor(rightId)),
    entities: diffEntities(entitiesFor(leftId), entitiesFor(rightId)),
  };
}
