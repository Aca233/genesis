import type { ObserverState } from "./schemas";
import { ObserverStateSchema } from "./schemas";
import type { WorldMode } from "@/lib/world-mode";

export type RealityViewer =
  | "pantheon_player"
  | "creator_omniscient"
  | "creator_limited";

const limitedObserverState: ObserverState = {
  focusType: "world",
  focusId: null,
  timeLabel: "",
  viewpoint: "limited",
  activeAvatarId: null,
};

/**
 * Resolves visibility from server-owned world and observer state.
 * Pantheon worlds never gain creator privileges, regardless of viewpoint data.
 */
export function realityViewer(
  mode: WorldMode,
  observer: ObserverState,
): RealityViewer {
  if (mode === "pantheon") return "pantheon_player";
  return observer.viewpoint === "limited"
    ? "creator_limited"
    : "creator_omniscient";
}

/** Invalid legacy observer data fails closed to limited observation. */
export function observerStateFromPersistence(value: unknown): ObserverState {
  const parsed = ObserverStateSchema.safeParse(value);
  return parsed.success ? parsed.data : limitedObserverState;
}

export function realityViewerFromPersistence(
  mode: WorldMode,
  observer: unknown,
): RealityViewer {
  return realityViewer(mode, observerStateFromPersistence(observer));
}

export function isOmniscientViewer(
  viewer: RealityViewer,
): viewer is "creator_omniscient" {
  return viewer === "creator_omniscient";
}

type SectionLike = { revealed: boolean; content: unknown };
type ProjectedSection<T extends SectionLike> = Omit<T, "content"> & {
  content: T["content"] | null;
  worldVisible: boolean;
};

/** Keeps rumor metadata but removes unrevealed section contents under fog. */
export function projectSectionsForViewer<T extends SectionLike>(
  sections: readonly T[],
  viewer: RealityViewer,
): ProjectedSection<T>[] {
  return sections.map((section) => {
    if (isOmniscientViewer(viewer) || section.revealed) {
      return { ...section, worldVisible: section.revealed };
    }
    return { ...section, content: null, worldVisible: false };
  });
}

export function projectGodAgendaForViewer<T>(
  agenda: T,
  revealed: boolean,
  viewer: RealityViewer,
): T | null {
  return revealed || isOmniscientViewer(viewer) ? agenda : null;
}


export function projectGodRelationsForViewer<T>(
  relations: T,
  viewer: RealityViewer,
): T | Record<string, never> | { player: unknown } {
  if (isOmniscientViewer(viewer)) return relations;
  if (!relations || typeof relations !== "object" || Array.isArray(relations)) return {};
  if (viewer === "pantheon_player" && "player" in relations) {
    return { player: (relations as Record<string, unknown>).player };
  }
  // Persisted creator relations currently have no per-edge reveal metadata.
  // Limited observation therefore fails closed rather than leaking the graph.
  return {};
}

export type ProjectedChronicle<T> = T & { worldVisible: boolean };

/** Hidden history is omitted under fog and explicitly annotated for omniscience. */
export function projectChronicleForViewer<T extends { revealed: boolean }>(
  entry: T,
  viewer: RealityViewer,
): ProjectedChronicle<T> | null {
  if (!entry.revealed && !isOmniscientViewer(viewer)) return null;
  return { ...entry, worldVisible: entry.revealed };
}
