export type RealityNodeView = {
  id: string;
  parentId: string | null;
  branchName: string;
  branchSummary: string | null;
  forkChapter: number | null;
  forkTimeLabel: string | null;
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

export type ModeDrawerTab = "activity" | "starmap" | "chronicle" | "god" | "creator" | "realities" | "lore" | "codex";
export type DrawerTabDefinition = {
  tab: ModeDrawerTab;
  iconToken: string;
  label: string;
  title: string;
};

export const pantheonDrawerTabs: readonly DrawerTabDefinition[] = [
  { tab: "activity", iconToken: "world.activity", label: "动态", title: "世界动态" },
  { tab: "starmap", iconToken: "cosmos.constellation", label: "星图", title: "星图" },
  { tab: "chronicle", iconToken: "chronicle.archive", label: "年表", title: "编年史" },
  { tab: "realities", iconToken: "reality.branch", label: "往昔", title: "往昔诸相" },
  { tab: "god", iconToken: "divinity.pantheon", label: "神格", title: "本尊神格" },
  { tab: "lore", iconToken: "knowledge.codex", label: "设定集", title: "世界设定集" },
  { tab: "codex", iconToken: "people.collective", label: "众生录", title: "众生录" },
] as const;

export const creatorDrawerTabs: readonly DrawerTabDefinition[] = [
  { tab: "activity", iconToken: "world.activity", label: "动态", title: "世界动态" },
  { tab: "starmap", iconToken: "cosmos.constellation", label: "星图", title: "星图" },
  { tab: "chronicle", iconToken: "chronicle.archive", label: "编年史", title: "编年史" },
  { tab: "god", iconToken: "divinity.pantheon", label: "诸神", title: "诸神录" },
  { tab: "creator", iconToken: "observer.transcendent", label: "天外视界", title: "天外视界" },
  { tab: "realities", iconToken: "reality.branch", label: "现实树", title: "现实树" },
  { tab: "lore", iconToken: "knowledge.codex", label: "设定集", title: "世界设定集" },
  { tab: "codex", iconToken: "people.collective", label: "众生录", title: "众生录" },
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

export type RealityTreeNavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function getRealityTreeKeyboardTarget(
  rows: readonly RealityTreeRow[],
  currentId: string,
  key: RealityTreeNavigationKey,
): string {
  if (rows.length === 0) return currentId;
  const index = rows.findIndex(({ node }) => node.id === currentId);
  if (index < 0) return rows[0].node.id;
  if (key === "Home") return rows[0].node.id;
  if (key === "End") return rows[rows.length - 1].node.id;
  if (key === "ArrowUp") return rows[Math.max(0, index - 1)].node.id;
  if (key === "ArrowDown") return rows[Math.min(rows.length - 1, index + 1)].node.id;
  if (key === "ArrowLeft") return rows.find(({ node }) => node.id === rows[index].node.parentId)?.node.id ?? currentId;
  if (rows[index].node.childCount === 0) return currentId;
  return rows.slice(index + 1).find(({ depth }) => depth === rows[index].depth + 1)?.node.id ?? currentId;
}

export async function switchCreatorReality({
  worldId,
  targetTimelineId,
  expectedActiveId,
  fetcher = fetch,
  reload,
}: {
  worldId: string;
  targetTimelineId: string;
  expectedActiveId: string;
  fetcher?: typeof fetch;
  reload: (timelineId: string) => Promise<void>;
}): Promise<string> {
  const response = await fetcher(`/api/worlds/${worldId}/realities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "switch", targetTimelineId, expectedActiveId }),
  });
  const json = (await response.json().catch(() => null)) as { activeId?: string; error?: string } | null;
  if (!response.ok) throw new Error(json?.error ?? "现实切换失败");
  const activeId = json?.activeId ?? targetTimelineId;
  await reload(activeId);
  return activeId;
}

export function isRealityNavigationDisabled(busy: BusyKinds): boolean {
  return busy.chat || busy.settlement || busy.rewrite;
}
