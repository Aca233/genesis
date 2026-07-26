import { describe, expect, it, vi } from "vitest";
import {
  RealityCompareError,
  diffChronicles,
  diffEntities,
  loadRealityComparison,
  resolveCompareRelationship,
  type ChronicleDiffEntry,
  type EntityDiffInput,
} from "./compare";
import { RealityNotFoundError } from "./tree";

const nodes = [
  { id: "t-root", parentId: null, forkChapter: null },
  { id: "t-child-a", parentId: "t-root", forkChapter: 2 },
  { id: "t-child-b", parentId: "t-root", forkChapter: 3 },
  { id: "t-grand", parentId: "t-child-a", forkChapter: 4 },
];

function chronicleRow(overrides: Partial<ChronicleDiffEntry>): ChronicleDiffEntry {
  return {
    id: "row-1",
    chapterIndex: 1,
    yearLabel: "冕历元年",
    text: "初火燃起",
    source: "narrative",
    revealed: true,
    ...overrides,
  };
}

function entityInput(overrides: Partial<EntityDiffInput>): EntityDiffInput {
  return {
    name: "临渊",
    type: "character",
    summary: "山中来客",
    sections: [],
    ...overrides,
  };
}

describe("resolveCompareRelationship", () => {
  it("resolves parent-child in both directions", () => {
    expect(resolveCompareRelationship(nodes, "t-root", "t-child-a")).toEqual({
      kind: "parent-child",
      parentId: "t-root",
      childId: "t-child-a",
    });
    expect(resolveCompareRelationship(nodes, "t-child-a", "t-root")).toEqual({
      kind: "parent-child",
      parentId: "t-root",
      childId: "t-child-a",
    });
  });

  it("resolves same-parent siblings", () => {
    expect(resolveCompareRelationship(nodes, "t-child-a", "t-child-b")).toEqual({
      kind: "siblings",
    });
  });

  it("rejects cousins, grandparents and self-comparison", () => {
    expect(() => resolveCompareRelationship(nodes, "t-child-b", "t-grand"))
      .toThrow(RealityCompareError);
    expect(() => resolveCompareRelationship(nodes, "t-root", "t-grand"))
      .toThrow("仅支持父子或同父兄弟现实对照");
    expect(() => resolveCompareRelationship(nodes, "t-child-a", "t-child-a"))
      .toThrow(RealityCompareError);
    expect(() => resolveCompareRelationship(nodes, "t-root", "missing"))
      .toThrow(RealityCompareError);
  });
});

describe("diffChronicles", () => {
  it("folds the textually identical shared prefix and surfaces the tail", () => {
    const shared = [
      chronicleRow({ id: "l-1" }),
      chronicleRow({ id: "l-2", chapterIndex: 2, yearLabel: "冕历二年", text: "立国" }),
    ];
    const tail = chronicleRow({ id: "l-3", chapterIndex: 3, yearLabel: "冕历三年", text: "北征" });
    const result = diffChronicles(
      [...shared, tail],
      [chronicleRow({ id: "r-1" }), chronicleRow({ id: "r-2", chapterIndex: 2, yearLabel: "冕历二年", text: "立国" })],
    );
    expect(result.commonCount).toBe(2);
    expect(result.leftOnly).toEqual([tail]);
    expect(result.rightOnly).toEqual([]);
  });

  it("surfaces a rewrite-edited entry as a leftOnly + rightOnly pair", () => {
    const left = chronicleRow({ id: "l-1", chapterIndex: 2, text: "王死于毒酒" });
    const right = chronicleRow({ id: "r-1", chapterIndex: 2, text: "王活了下来", source: "rewrite" });
    const result = diffChronicles([left], [right]);
    expect(result.commonCount).toBe(0);
    expect(result.leftOnly).toEqual([left]);
    expect(result.rightOnly).toEqual([right]);
  });

  it("folds duplicate identical texts pairwise", () => {
    const result = diffChronicles(
      [chronicleRow({ id: "l-1" }), chronicleRow({ id: "l-2" })],
      [chronicleRow({ id: "r-1" })],
    );
    expect(result.commonCount).toBe(1);
    expect(result.leftOnly).toHaveLength(1);
    expect(result.rightOnly).toEqual([]);
  });

  it("sorts each side by chapterIndex then id", () => {
    const result = diffChronicles(
      [
        chronicleRow({ id: "l-b", chapterIndex: 2, text: "乙事" }),
        chronicleRow({ id: "l-a", chapterIndex: 2, text: "甲事" }),
        chronicleRow({ id: "l-c", chapterIndex: 1, text: "丙事" }),
      ],
      [],
    );
    expect(result.leftOnly.map((row) => row.id)).toEqual(["l-c", "l-a", "l-b"]);
  });
});

describe("diffEntities", () => {
  it("omits identical entities entirely", () => {
    const same = entityInput({ sections: [{ key: "origin", content: "山中来", revealed: true }] });
    expect(diffEntities([same], [entityInput({ sections: [...same.sections] })])).toEqual([]);
  });

  it("reports presence differences without summary or section diffs", () => {
    const only = entityInput({ name: "孤存者" });
    expect(diffEntities([only], [])).toEqual([{
      name: "孤存者",
      type: "character",
      presence: "left-only",
      summaryDiff: null,
      sectionDiffs: [],
    }]);
    expect(diffEntities([], [only])[0].presence).toBe("right-only");
  });

  it("diffs summaries and the union of section keys", () => {
    const result = diffEntities(
      [entityInput({
        summary: "旧我",
        sections: [
          { key: "creed", content: "守誓", revealed: true },
          { key: "origin", content: { text: "山中来" }, revealed: true },
        ],
      })],
      [entityInput({
        summary: "新我",
        sections: [
          { key: "origin", content: "山中来", revealed: true },
          { key: "secret", content: "弑君者", revealed: false },
        ],
      })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].presence).toBe("both");
    expect(result[0].summaryDiff).toEqual({ left: "旧我", right: "新我" });
    // origin 两侧文本一致（字符串与 {text} 归一为同一文本）不出现；creed 右侧缺、secret 左侧缺
    expect(result[0].sectionDiffs).toEqual([
      { key: "creed", left: "守誓", right: null },
      { key: "secret", left: null, right: "弑君者" },
    ]);
  });

  it("clips summaries and section texts at 400 characters", () => {
    const long = "甲".repeat(450);
    const result = diffEntities(
      [entityInput({ summary: long, sections: [{ key: "origin", content: long, revealed: true }] })],
      [entityInput({ summary: "乙", sections: [{ key: "origin", content: "乙", revealed: true }] })],
    );
    expect(Array.from(result[0].summaryDiff!.left)).toHaveLength(400);
    expect(Array.from(result[0].sectionDiffs[0].left!)).toHaveLength(400);
  });

  it("caps output at 40 with presence differences first, then by name", () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      entityInput({ name: `众甲${String(index).padStart(2, "0")}`, summary: "左貌" }));
    const rightMany = many.map((entity) => ({ ...entity, summary: "右貌" }));
    const presenceOnly = entityInput({ name: "唯此界有" });
    const result = diffEntities([...many, presenceOnly], rightMany);
    expect(result).toHaveLength(40);
    expect(result[0]).toMatchObject({ name: "唯此界有", presence: "left-only" });
    const rest = result.slice(1).map((diff) => diff.name);
    expect(rest).toEqual([...rest].sort());
  });
});

describe("loadRealityComparison", () => {
  const labelRows = [
    { timelineId: "t-root", chapterIndex: 2, yearLabel: "冕历三年" },
  ];
  const compareRows = [
    { id: "c-1", timelineId: "t-root", chapterIndex: 1, yearLabel: "冕历元年", text: "初火燃起", source: "narrative", revealed: true },
    { id: "c-2", timelineId: "t-child", chapterIndex: 1, yearLabel: "冕历元年", text: "初火燃起", source: "narrative", revealed: true },
    { id: "c-3", timelineId: "t-root", chapterIndex: 3, yearLabel: "冕历四年", text: "王城陷落", source: "narrative", revealed: true },
    { id: "c-4", timelineId: "t-root", chapterIndex: 3, yearLabel: "冕历四年", text: "神暗中拨弄", source: "pantheon", revealed: false },
  ];
  const entityRows = [
    {
      name: "临渊", type: "character", timelineId: "t-root", summary: "旧我",
      sections: [
        { key: "origin", content: "山中来", revealed: true },
        { key: "secret", content: "弑君者", revealed: false },
      ],
    },
    {
      name: "临渊", type: "character", timelineId: "t-child", summary: "新我",
      sections: [
        { key: "origin", content: "山中来", revealed: true },
        { key: "secret", content: "无辜者", revealed: false },
      ],
    },
  ];

  function makeDb() {
    return {
      world: { findUnique: vi.fn(async () => ({ activeTimelineId: "t-root" })) },
      timeline: {
        findMany: vi.fn(async () => [
          { id: "t-root", worldId: "world-1", parentId: null, branchName: "元初", branchSummary: null, forkChapter: null, forkRewriteId: null, updatedAt: new Date("2026-07-01T00:00:00Z") },
          { id: "t-child", worldId: "world-1", parentId: "t-root", branchName: "回溯之界", branchSummary: null, forkChapter: 2, forkRewriteId: "rw-1", updatedAt: new Date("2026-07-02T00:00:00Z") },
          { id: "t-child-2", worldId: "world-1", parentId: "t-root", branchName: "他途", branchSummary: null, forkChapter: 3, forkRewriteId: "rw-2", updatedAt: new Date("2026-07-03T00:00:00Z") },
        ]),
      },
      realityRewrite: {
        findMany: vi.fn(async () => [
          { id: "rw-1", worldId: "world-1", sourceTimelineId: "t-root", resultTimelineId: "t-child", decree: "回到第二卷" },
          { id: "rw-2", worldId: "world-1", sourceTimelineId: "t-root", resultTimelineId: "t-child-2", decree: "另开一途" },
        ]),
      },
      chronicleEntry: {
        findMany: vi.fn(async (args: { where?: Record<string, unknown> }) =>
          args.where !== undefined && "timelineId" in args.where ? compareRows : labelRows),
      },
      entity: { findMany: vi.fn(async () => entityRows) },
    };
  }
  type CompareDb = Parameters<typeof loadRealityComparison>[0];

  it("compares parent and child omnisciently, labeling divergence by the fork chapter", async () => {
    const db = makeDb();
    const result = await loadRealityComparison(
      db as unknown as CompareDb, "world-1", "t-root", "t-child", { omniscient: true },
    );
    expect(result.relationship).toEqual({ kind: "parent-child", parentId: "t-root", childId: "t-child" });
    expect(result.divergenceLabel).toBe("冕历三年");
    expect(result.left.branchName).toBe("元初");
    expect(result.right.isActive).toBe(false);
    expect(result.chronicle.commonCount).toBe(1);
    expect(result.chronicle.leftOnly.map((row) => row.id)).toEqual(["c-3", "c-4"]);
    expect(result.chronicle.rightOnly).toEqual([]);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].summaryDiff).toEqual({ left: "旧我", right: "新我" });
    expect(result.entities[0].sectionDiffs).toEqual([
      { key: "secret", left: "弑君者", right: "无辜者" },
    ]);
  });

  it("sanitizes hidden chronicle rows and unrevealed sections for non-omniscient viewers", async () => {
    const db = makeDb();
    const result = await loadRealityComparison(
      db as unknown as CompareDb, "world-1", "t-root", "t-child", { omniscient: false },
    );
    expect(result.chronicle.leftOnly.map((row) => row.id)).toEqual(["c-3"]);
    expect(result.entities[0].sectionDiffs).toEqual([]);
    expect(result.entities[0].summaryDiff).toEqual({ left: "旧我", right: "新我" });
  });

  it("labels sibling divergence with both fork labels", async () => {
    const db = makeDb();
    const result = await loadRealityComparison(
      db as unknown as CompareDb, "world-1", "t-child", "t-child-2",
    );
    expect(result.relationship).toEqual({ kind: "siblings" });
    expect(result.divergenceLabel).toBe("冕历三年 / 第3卷");
  });

  it("throws RealityNotFoundError for ids outside the tree", async () => {
    const db = makeDb();
    await expect(loadRealityComparison(db as unknown as CompareDb, "world-1", "t-root", "missing"))
      .rejects.toThrow(RealityNotFoundError);
    await expect(loadRealityComparison(db as unknown as CompareDb, "world-1", "t-root", "missing"))
      .rejects.toThrow("对照现实不存在");
  });
});
