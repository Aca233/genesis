"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * 实体索引 Context：正文微光链接（docs/01 §9.2 正文联动）。
 * page.tsx 提供索引与 openEntity 回调；Prose 渲染时匹配实体名。
 */

export type EntityIndexItem = {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  summary: string;
  emblemSeed: string;
  imageUrl?: string | null;
};

type EntityIndexValue = {
  /** 按名字长度降序的 (名字, 实体) 对——防子串抢先 */
  patterns: { key: string; item: EntityIndexItem }[];
  openEntity: (id: string) => void;
};

const EntityIndexContext = createContext<EntityIndexValue>({
  patterns: [],
  openEntity: () => {},
});

export function EntityIndexProvider({
  index,
  openEntity,
  children,
}: {
  index: EntityIndexItem[];
  openEntity: (id: string) => void;
  children: ReactNode;
}) {
  const patterns = useMemo(() => {
    const pairs: { key: string; item: EntityIndexItem }[] = [];
    for (const item of index) {
      for (const key of [item.name, ...item.aliases]) {
        if (key && key.length >= 2) pairs.push({ key, item });
      }
    }
    pairs.sort((a, b) => b.key.length - a.key.length);
    return pairs;
  }, [index]);

  const value = useMemo(() => ({ patterns, openEntity }), [patterns, openEntity]);
  return (
    <EntityIndexContext.Provider value={value}>
      {children}
    </EntityIndexContext.Provider>
  );
}

export function useEntityIndex() {
  return useContext(EntityIndexContext);
}

/**
 * 把一段纯文本切成 [文本, 链接, 文本…]。
 * 每个实体在同一文本块中只链首次出现。
 */
export function splitByEntities(
  text: string,
  patterns: { key: string; item: EntityIndexItem }[],
): (string | { item: EntityIndexItem; text: string })[] {
  if (!patterns.length || !text) return [text];

  const linkedIds = new Set<string>();
  type Hit = { start: number; end: number; item: EntityIndexItem; text: string };
  const hits: Hit[] = [];

  for (const { key, item } of patterns) {
    if (linkedIds.has(item.id)) continue;
    const idx = text.indexOf(key);
    if (idx === -1) continue;
    // 与已有命中重叠则跳过（长名优先已由排序保证）
    if (hits.some((h) => idx < h.end && idx + key.length > h.start)) continue;
    hits.push({ start: idx, end: idx + key.length, item, text: key });
    linkedIds.add(item.id);
  }
  if (!hits.length) return [text];

  hits.sort((a, b) => a.start - b.start);
  const out: (string | { item: EntityIndexItem; text: string })[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) out.push(text.slice(pos, h.start));
    out.push({ item: h.item, text: h.text });
    pos = h.end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
