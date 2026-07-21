import { z } from "zod";

export const WORLD_MODES = ["pantheon", "creator"] as const;
export const WorldModeSchema = z.enum(WORLD_MODES);
export type WorldMode = z.infer<typeof WorldModeSchema>;

const LABELS: Record<WorldMode, string> = {
  pantheon: "诸神共世",
  creator: "创世主",
};

export function worldModeLabel(mode: WorldMode): string {
  return LABELS[mode];
}

export function assertModeTransition(current: WorldMode, next: WorldMode): void {
  if (current !== next) throw new Error("世界模式不可更改");
}
