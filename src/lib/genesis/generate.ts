import type { WorldDeck } from "@/lib/cards/schemas";
import { WorldDeckSchema } from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { extractJson } from "@/lib/llm/structured";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import { assertMaterializedDeck } from "@/lib/materials/validate-result";
import {
  TopLevelJsonProgressScanner,
  type GenesisTopLevelKey,
} from "./json-progress";
import { mergeCompletedKeys, type GenesisStageId } from "./stages";

type RepairInput = {
  decree: string;
  lorebookExcerpts?: string;
  invalidOutput: string;
  validationError: string;
};

export type GenesisGenerationOptions = {
  decree: string;
  lorebookExcerpts?: string;
  materialSnapshot?: GenesisMaterialSnapshot | null;
  streamCompletion: () => AsyncIterable<string>;
  repairCompletion: (input: RepairInput) => Promise<WorldDeck>;
  onProgress: (completedKeys: GenesisTopLevelKey[], rawOutput: string) => Promise<void> | void;
  onChunk: (rawOutput: string) => Promise<void> | void;
  onStage: (stage: GenesisStageId) => Promise<void> | void;
};

function parseAndValidate(raw: string, materialSnapshot: GenesisMaterialSnapshot | null): WorldDeck {
  const deck = WorldDeckSchema.parse(extractJson(raw));
  validateDeckReferences(deck);
  assertMaterializedDeck(deck, materialSnapshot);
  return deck;
}

function describeValidationError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    return JSON.stringify((error as { issues: unknown }).issues, null, 2).slice(0, 4000);
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 4000);
}

/** Performs one observable streaming attempt, then a targeted repair if needed. */
export async function generateGenesisDeck(
  options: GenesisGenerationOptions,
): Promise<WorldDeck> {
  const scanner = new TopLevelJsonProgressScanner();
  let completedKeys: GenesisTopLevelKey[] = [];
  let lastProgressRaw = "";

  for await (const text of options.streamCompletion()) {
    if (!text) continue;
    const newlyCompleted = scanner.push(text);
    await options.onChunk(scanner.getRaw());
    if (newlyCompleted.length > 0) {
      completedKeys = mergeCompletedKeys(completedKeys, newlyCompleted);
      lastProgressRaw = scanner.getRaw();
      await options.onProgress(completedKeys, lastProgressRaw);
    }
  }

  const rawOutput = scanner.getRaw();
  if (completedKeys.length > 0 && lastProgressRaw !== rawOutput) {
    await options.onProgress(completedKeys, rawOutput);
  }
  await options.onStage("validation");

  try {
    return parseAndValidate(rawOutput, options.materialSnapshot ?? null);
  } catch (error) {
    const validationError = describeValidationError(error);
    await options.onStage("repair");
    const repaired = await options.repairCompletion({
      decree: options.decree,
      lorebookExcerpts: options.lorebookExcerpts,
      invalidOutput: rawOutput,
      validationError,
    });
    // Repair adapters are external/untrusted too. Never skip either authority.
    const deck = WorldDeckSchema.parse(repaired);
    validateDeckReferences(deck);
    assertMaterializedDeck(deck, options.materialSnapshot ?? null);
    return deck;
  }
}
