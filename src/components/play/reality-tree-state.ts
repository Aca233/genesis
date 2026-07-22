export type RealityNodeView = {
  id: string;
  parentId: string | null;
  branchName: string;
  branchSummary: string | null;
  forkChapter: number | null;
  rewriteId: string | null;
  rewriteDecree: string | null;
  childCount: number;
  isActive: boolean;
  updatedAt: string;
};

export type RealityTreeView = {
  nodes: RealityNodeView[];
  activeId: string;
};

export type RealityTreeRow = {
  node: RealityNodeView;
  depth: number;
};

export type BusyKinds = {
  chat: boolean;
  settlement: boolean;
  rewrite: boolean;
};

export type ModeDrawerTab = "starmap" | "chronicle" | "god" | "creator" | "realities" | "lore" | "codex";
export type DrawerTabDefinition = {
  tab: ModeDrawerTab;
  glyph: string;
  label: string;
  title: string;
};

export const pantheonDrawerTabs: readonly DrawerTabDefinition[] = [
  { tab: "starmap", glyph: "✦", label: "星图", title: "✦ 星图" },
  { tab: "chronicle", glyph: "📜", label: "年表", title: "📜 编年史" },
  { tab: "god", glyph: "◈", label: "神格", title: "◈ 本尊神格" },
  { tab: "lore", glyph: "📖", label: "设定集", title: "📖 世界设定集" },
  { tab: "codex", glyph: "👥", label: "众生录", title: "👥 众生录" },
] as const;

export const creatorDrawerTabs: readonly DrawerTabDefinition[] = [
  { tab: "starmap", glyph: "✦", label: "星图", title: "✦ 星图" },
  { tab: "chronicle", glyph: "📜", label: "编年史", title: "📜 编年史" },
  { tab: "creator", glyph: "◉", label: "天外视界", title: "◉ 天外视界" },
  { tab: "realities", glyph: "⌘", label: "现实树", title: "⌘ 现实树" },
  { tab: "lore", glyph: "📖", label: "设定集", title: "📖 世界设定集" },
  { tab: "codex", glyph: "👥", label: "众生录", title: "👥 众生录" },
] as const;

export function drawerTabsForMode(mode: "pantheon" | "creator") {
  return mode === "creator" ? creatorDrawerTabs : pantheonDrawerTabs;
}

/** Parent-first, deterministic tree rows; malformed or detached nodes follow as roots. */
export function buildRealityTreeRows(nodes: readonly RealityNodeView[]): RealityTreeRow[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string | null, RealityNodeView[]>();
  for (const node of nodes) {
    const parent = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
    );
  }

  const rows: RealityTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (node: RealityNodeView, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    rows.push({ node, depth });
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  for (const node of nodes) visit(node, 0);
  return rows;
}

export function getUndoTarget(
  nodes: readonly RealityNodeView[],
  activeId: string,
): string | null {
  return nodes.find((node) => node.id === activeId)?.parentId ?? null;
}

export function isRealityNavigationDisabled(busy: BusyKinds): boolean {
  return busy.chat || busy.settlement || busy.rewrite;
}
