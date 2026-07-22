import type { WorldMode } from "@/lib/world-mode";

/** Both immutable world modes can materialize their validated genesis deck. */
export function canEmbarkMode(mode: WorldMode): boolean {
  return mode === "pantheon" || mode === "creator";
}
