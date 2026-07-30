import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  type WorldDeck,
} from "@/lib/cards/schemas";
import type { WorldMode } from "@/lib/world-mode";

function getPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) => current && typeof current === "object"
        ? (current as Record<string, unknown>)[key]
        : undefined,
      value,
    );
}

function setPath(value: unknown, path: string, replacement: unknown): void {
  const keys = path.split(".");
  const last = keys.pop();
  if (last === undefined) return;

  const target = keys.reduce<unknown>(
    (current, key) => current && typeof current === "object"
      ? (current as Record<string, unknown>)[key]
      : undefined,
    value,
  );
  if (target && typeof target === "object") {
    (target as Record<string, unknown>)[last] = replacement;
  }
}

export function preserveLockedPaths(
  generated: unknown,
  current: unknown,
  lockedPaths: string[],
  mode: WorldMode,
): WorldDeck {
  const merged = JSON.parse(JSON.stringify(generated)) as unknown;
  for (const path of lockedPaths) {
    const currentValue = getPath(current, path);
    if (currentValue !== undefined) setPath(merged, path, currentValue);
  }

  return mode === "pantheon"
    ? PantheonWorldDeckSchema.parse(merged)
    : CreatorWorldDeckSchema.parse(merged);
}
