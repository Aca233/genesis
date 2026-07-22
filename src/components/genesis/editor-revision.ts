import type { WorldDeck } from "@/lib/cards/schemas";

export function parseWorldRevision(value: unknown): string {
  if (typeof value !== "string") throw new Error("世界版本无效");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("世界版本无效");
  return parsed.toISOString();
}

export function buildDeckPatchPayload(
  deck: WorldDeck,
  editedPaths: string[],
  expectedUpdatedAt: string,
) {
  return { deck, editedPaths, expectedUpdatedAt };
}
