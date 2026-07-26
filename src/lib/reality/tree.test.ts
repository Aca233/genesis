import { describe, expect, it, vi } from "vitest";
import {
  RealityConflictError,
  RealityTreeValidationError,
  buildRealityTree,
  parseRealityBranchName,
  switchReality,
  undoReality,
  type RealityTreeInput,
} from "./tree";

const updatedAt = new Date("2026-07-22T08:00:00.000Z");

function input(overrides: Partial<RealityTreeInput> = {}): RealityTreeInput {
  return {
    worldId: "world-1",
    activeTimelineId: "child",
    timelines: [
      {
        id: "root",
        worldId: "world-1",
        parentId: null,
        branchName: "原初现实",
        branchSummary: "最初的世界",
        forkChapter: null,
        forkTimeLabel: null,
        forkRewriteId: null,
        updatedAt,
      },
      {
        id: "child",
        worldId: "world-1",
        parentId: "root",
        branchName: "双月现实",
        branchSummary: "天空有两轮月亮",
        forkChapter: 3,
        forkTimeLabel: "星历三年",
        forkRewriteId: "rewrite-1",
        updatedAt,
      },
    ],
    rewrites: [
      {
        id: "rewrite-1",
        worldId: "world-1",
        sourceTimelineId: "root",
        resultTimelineId: "child",
        decree: "令天空自古便有双月",
      },
    ],
    ...overrides,
  };
}

describe("buildRealityTree", () => {
  it("returns the stable DTO with child counts, rewrite data, and active marker", () => {
    expect(buildRealityTree(input())).toEqual({
      activeId: "child",
      nodes: [
        {
          id: "root",
          parentId: null,
          branchName: "原初现实",
          branchSummary: "最初的世界",
          forkChapter: null,
          forkTimeLabel: null,
          rewriteId: null,
          rewriteDecree: null,
          childCount: 1,
          isActive: false,
          updatedAt: updatedAt.toISOString(),
        },
        {
          id: "child",
          parentId: "root",
          branchName: "双月现实",
          branchSummary: "天空有两轮月亮",
          forkChapter: 3,
          forkTimeLabel: "星历三年",
          rewriteId: "rewrite-1",
          rewriteDecree: "令天空自古便有双月",
          childCount: 0,
          isActive: true,
          updatedAt: updatedAt.toISOString(),
        },
      ],
    });
  });

  it("requires exactly one root", () => {
    expect(() => buildRealityTree(input({
      timelines: input().timelines.map((node) => ({ ...node, parentId: null })),
    }))).toThrowError(/根节点.*唯一/);
  });

  it("rejects cycles", () => {
    expect(() => buildRealityTree(input({
      timelines: input().timelines.map((node) => node.id === "root"
        ? { ...node, parentId: "child" }
        : node),
    }))).toThrowError(RealityTreeValidationError);
  });

  it("rejects cross-world nodes and missing/cross-world parents", () => {
    expect(() => buildRealityTree(input({
      timelines: input().timelines.map((node) => node.id === "child"
        ? { ...node, worldId: "world-2" }
        : node),
    }))).toThrowError(/同一世界/);
    expect(() => buildRealityTree(input({
      timelines: input().timelines.map((node) => node.id === "child"
        ? { ...node, parentId: "foreign-root" }
        : node),
    }))).toThrowError(/父节点/);
  });

  it("requires the active timeline to exist in the tree", () => {
    expect(() => buildRealityTree(input({ activeTimelineId: "missing" }))).toThrowError(/活动现实/);
  });

  it("validates rewrite world, source, result, and child linkage consistently", () => {
    for (const rewrite of [
      { ...input().rewrites[0], worldId: "world-2" },
      { ...input().rewrites[0], sourceTimelineId: "child" },
      { ...input().rewrites[0], resultTimelineId: "root" },
    ]) {
      expect(() => buildRealityTree(input({ rewrites: [rewrite] }))).toThrowError(/现实改写/);
    }
    expect(() => buildRealityTree(input({
      timelines: input().timelines.map((node) => node.id === "child"
        ? { ...node, forkRewriteId: "missing" }
        : node),
    }))).toThrowError(/现实改写/);
  });
});

describe("reality tree mutations", () => {
  it("accepts trimmed branch names of 1–80 Unicode characters only", () => {
    expect(parseRealityBranchName("  新现实  ")).toBe("新现实");
    expect(parseRealityBranchName("界".repeat(80))).toHaveLength(80);
    expect(() => parseRealityBranchName("   ")).toThrowError(/1–80/);
    expect(() => parseRealityBranchName("界".repeat(81))).toThrowError(/1–80/);
  });

  it("claims and releases the Task 8 switch lease and applies expectedActiveId CAS", async () => {
    const db = operationDb();

    await expect(switchReality(db.client as unknown as Parameters<typeof switchReality>[0], {
      worldId: "world-1",
      targetTimelineId: "child",
      expectedActiveId: "root",
      token: "switch-token",
    })).resolves.toEqual({ activeId: "child" });

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: "world-1", activeTimelineId: "root" },
      data: { activeTimelineId: "child" },
    });
    expect(db.worldUpdateMany.mock.invocationCallOrder[0])
      .toBeLessThan(db.timelineFindFirst.mock.invocationCallOrder[0]);
    expect(db.leaseUpdates[0]).toMatchObject({
      data: { operationKind: "switch", operationToken: "switch-token" },
    });
    expect(db.leaseUpdates.at(-1)).toMatchObject({
      where: { id: "world-1", operationKind: "switch", operationToken: "switch-token" },
      data: { operationKind: null, operationToken: null, operationLeaseExpiresAt: null },
    });
  });

  it("rejects a stale expected active ID and still releases the lease", async () => {
    const db = operationDb({ casCount: 0 });

    await expect(switchReality(db.client as unknown as Parameters<typeof switchReality>[0], {
      worldId: "world-1",
      targetTimelineId: "child",
      expectedActiveId: "stale",
      token: "switch-token",
    })).rejects.toBeInstanceOf(RealityConflictError);
    expect(db.leaseUpdates.at(-1)?.data).toMatchObject({ operationKind: null });
  });

  it("undo switches to the active node parent through the same leased CAS", async () => {
    const db = operationDb({ activeTimelineId: "child", parentId: "root" });

    await expect(undoReality(db.client as unknown as Parameters<typeof undoReality>[0], {
      worldId: "world-1",
      expectedActiveId: "child",
      token: "undo-token",
    })).resolves.toEqual({ activeId: "root" });
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: "world-1", activeTimelineId: "child" },
      data: { activeTimelineId: "root" },
    });
  });
});

function operationDb(options: {
  casCount?: number;
  activeTimelineId?: string;
  parentId?: string | null;
} = {}) {
  let lease: { operationKind: string | null; operationToken: string | null; operationLeaseExpiresAt: Date | null } = {
    operationKind: null,
    operationToken: null,
    operationLeaseExpiresAt: null,
  };
  const leaseUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const updateMany = vi.fn(async (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    void args;
    return { count: options.casCount ?? 1 };
  });
  const timelineFindFirst = vi.fn(async ({ where }: {
    where: { id: string; worldId: string };
  }) => where.id === "missing" ? null : {
    id: where.id,
    worldId: where.worldId,
    parentId: where.id === (options.activeTimelineId ?? "child")
      ? (options.parentId ?? "root")
      : null,
  });
  const worldUpdateMany = vi.fn(async (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => {
    if ("activeTimelineId" in args.data) return updateMany(args);
    leaseUpdates.push(args);
    if (args.data.operationKind === null || args.where.operationLeaseExpiresAt !== undefined || "OR" in args.where) {
      lease = { ...lease, ...args.data } as typeof lease;
      return { count: 1 };
    }
    return { count: 0 };
  });
  const client = {
    world: {
      findUnique: vi.fn(async (args: { select?: { activeTimelineId?: true } }) =>
        args.select?.activeTimelineId
          ? { activeTimelineId: options.activeTimelineId ?? "root" }
          : { ...lease }),
      updateMany: worldUpdateMany,
    },
    generationRequest: { count: vi.fn(async () => 0) },
    chapter: { count: vi.fn(async () => 0) },
    timeline: { findFirst: timelineFindFirst },
  };
  return { client, updateMany, leaseUpdates, timelineFindFirst, worldUpdateMany };
}
