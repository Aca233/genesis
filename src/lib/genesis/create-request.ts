import type { MaterialSelectionItem } from "@/lib/materials/types";
import type { WorldMode } from "@/lib/world-mode";

export const defaultGenesisMode: WorldMode = "creator";

export function createGenesisIdempotencyKey(): string {
  return crypto.randomUUID();
}

type GenesisTaskPayloadInput = {
  mode?: WorldMode;
  decree: string;
  lorebook?: { name: string; data: unknown } | null;
  materialSelections?: MaterialSelectionItem[];
};

export function buildGenesisTaskPayload(input: GenesisTaskPayloadInput) {
  return {
    mode: input.mode ?? defaultGenesisMode,
    decree: input.decree.trim(),
    ...(input.lorebook
      ? { lorebook: input.lorebook.data, lorebookName: input.lorebook.name }
      : {}),
    materialSelections: input.materialSelections ?? [],
  };
}
