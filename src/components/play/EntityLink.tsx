"use client";

import { useState, type ReactNode } from "react";
import { Emblem } from "./Emblem";
import {
  splitByEntities,
  useEntityIndex,
  type EntityIndexItem,
} from "./entity-index";

/**
 * 实体微光链接 + 悬停快览卡。
 * linkifyChildren 供 Prose 的文本节点调用。
 */

function EntityLink({ item, text }: { item: EntityIndexItem; text: string }) {
  const { openEntity } = useEntityIndex();
  const [hover, setHover] = useState(false);

  return (
    <span
      className="entity-link relative"
      onClick={(e) => {
        e.stopPropagation();
        openEntity(item.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          openEntity(item.id);
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      role="button"
      tabIndex={0}
    >
      {text}
      {hover && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 flex w-64 -translate-x-1/2 items-start gap-2 rounded-md border border-line bg-paper-raised p-2.5 text-left shadow-lg">
          <Emblem seed={item.emblemSeed} type={item.type} size={30} imageUrl={item.imageUrl} />
          <span className="min-w-0">
            <span className="block text-sm text-ink">{item.name}</span>
            <span className="block text-xs leading-snug text-ink-soft">
              {item.summary}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/** 递归处理 ReactMarkdown 的 children：字符串节点做实体匹配 */
export function linkifyChildren(
  children: ReactNode,
  patterns: { key: string; item: EntityIndexItem }[],
): ReactNode {
  if (typeof children === "string") {
    const parts = splitByEntities(children, patterns);
    if (parts.length === 1 && typeof parts[0] === "string") return children;
    return parts.map((p, i) =>
      typeof p === "string" ? (
        p
      ) : (
        <EntityLink key={`${p.item.id}-${i}`} item={p.item} text={p.text} />
      ),
    );
  }
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string" ? (
        <span key={i}>{linkifyChildren(c, patterns)}</span>
      ) : (
        c
      ),
    );
  }
  return children;
}
