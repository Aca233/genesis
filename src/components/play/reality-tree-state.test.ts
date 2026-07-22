import { describe, expect, it } from "vitest";
import {
  buildRealityTreeRows,
  creatorDrawerTabs,
  getUndoTarget,
  isRealityNavigationDisabled,
  pantheonDrawerTabs,
  type RealityNodeView,
} from "./reality-tree-state";

const nodes: RealityNodeView[] = [
  {
    id: "root",
    parentId: null,
    branchName: "原初现实",
    branchSummary: null,
    forkChapter: null,
    rewriteId: null,
    rewriteDecree: null,
    childCount: 2,
    isActive: false,
    updatedAt: "2026-07-21T00:00:00.000Z",
  },
  {
    id: "branch-b",
    parentId: "root",
    branchName: "赤月现实",
    branchSummary: "赤月升起",
    forkChapter: 2,
    rewriteId: "rewrite-b",
    rewriteDecree: "令赤月永悬",
    childCount: 0,
    isActive: false,
    updatedAt: "2026-07-21T02:00:00.000Z",
  },
  {
    id: "branch-a",
    parentId: "root",
    branchName: "倒悬星河",
    branchSummary: "群星倒悬",
    forkChapter: 1,
    rewriteId: "rewrite-a",
    rewriteDecree: "令群星倒悬",
    childCount: 1,
    isActive: false,
    updatedAt: "2026-07-21T01:00:00.000Z",
  },
  {
    id: "leaf",
    parentId: "branch-a",
    branchName: "无王之世",
    branchSummary: null,
    forkChapter: 3,
    rewriteId: "rewrite-leaf",
    rewriteDecree: "令王座空悬",
    childCount: 0,
    isActive: true,
    updatedAt: "2026-07-21T03:00:00.000Z",
  },
];

describe("reality tree state", () => {
  it("builds stable depth-first rows and chooses the active node parent for undo", () => {
    expect(buildRealityTreeRows(nodes).map(({ node, depth }) => [node.id, depth])).toEqual([
      ["root", 0],
      ["branch-a", 1],
      ["leaf", 2],
      ["branch-b", 1],
    ]);
    expect(getUndoTarget(nodes, "leaf")).toBe("branch-a");
    expect(getUndoTarget(nodes, "root")).toBeNull();
  });

  it("disables switching and undo while chat, settlement or rewrite is busy", () => {
    expect(isRealityNavigationDisabled({ chat: true, settlement: false, rewrite: false })).toBe(true);
    expect(isRealityNavigationDisabled({ chat: false, settlement: true, rewrite: false })).toBe(true);
    expect(isRealityNavigationDisabled({ chat: false, settlement: false, rewrite: true })).toBe(true);
    expect(isRealityNavigationDisabled({ chat: false, settlement: false, rewrite: false })).toBe(false);
  });

  it("uses creator tabs without 本尊神格 while keeping pantheon tabs unchanged", () => {
    expect(creatorDrawerTabs.map((tab) => [tab.tab, tab.label])).toEqual([
      ["starmap", "星图"],
      ["chronicle", "编年史"],
      ["creator", "天外视界"],
      ["realities", "现实树"],
      ["lore", "设定集"],
      ["codex", "众生录"],
    ]);
    expect(creatorDrawerTabs.some((tab) => tab.label.includes("本尊神格"))).toBe(false);
    expect(pantheonDrawerTabs.map((tab) => [tab.tab, tab.label])).toEqual([
      ["starmap", "星图"],
      ["chronicle", "年表"],
      ["god", "神格"],
      ["lore", "设定集"],
      ["codex", "众生录"],
    ]);
  });
});

it("renders an accessible reality tree with current reality and busy-disabled navigation", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RealityTreePanel } = await import("./RealityTreePanel");
  const html = renderToStaticMarkup(
    createElement(RealityTreePanel, {
      worldId: "world-1",
      activeTimelineId: "leaf",
      busy: { chat: true, settlement: false, rewrite: false },
      onTimelineChanged: async () => undefined,
    }),
  );
  expect(html).toContain('role="tree"');
  expect(html).toContain("现实树");
  expect(html).toContain("叙事、结算或改写进行中时不可切换现实");
});

it("RuneRail exposes the exact creator labels and the unchanged pantheon labels", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { RuneRail } = await import("./RuneRail");
  const creator = renderToStaticMarkup(createElement(RuneRail, { mode: "creator", active: null, onOpen: () => undefined }));
  const pantheon = renderToStaticMarkup(createElement(RuneRail, { mode: "pantheon", active: null, onOpen: () => undefined }));
  for (const label of ["星图", "编年史", "天外视界", "现实树", "设定集", "众生录"]) {
    expect(creator).toContain(`aria-label="${label}"`);
  }
  expect(creator).not.toContain("本尊神格");
  for (const label of ["星图", "年表", "神格", "设定集", "众生录"]) {
    expect(pantheon).toContain(`aria-label="${label}"`);
  }
});
