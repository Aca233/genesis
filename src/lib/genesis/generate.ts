import type { WorldDeck } from "@/lib/cards/schemas";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  WorldDeckSchema,
} from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { extractJson } from "@/lib/llm/structured";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import { assertMaterializedDeck } from "@/lib/materials/validate-result";
import type { WorldMode } from "@/lib/world-mode";
import {
  TopLevelJsonProgressScanner,
  type GenesisTopLevelKey,
} from "./json-progress";
import { mergeCompletedKeys, type GenesisStageId } from "./stages";

type SharedRepairInput = {
  decree: string;
  lorebookExcerpts?: string;
  invalidOutput: string;
  validationError: string;
};

export type RepairInput = SharedRepairInput & (
  | { mode: "pantheon"; schema: typeof PantheonWorldDeckSchema }
  | { mode: "creator"; schema: typeof CreatorWorldDeckSchema }
);

export type GenesisGenerationOptions = {
  mode: WorldMode;
  decree: string;
  lorebookExcerpts?: string;
  materialSnapshot?: GenesisMaterialSnapshot | null;
  streamCompletion: () => AsyncIterable<string>;
  repairCompletion: (input: RepairInput) => Promise<unknown>;
  onProgress: (completedKeys: GenesisTopLevelKey[], rawOutput: string) => Promise<void> | void;
  onChunk: (rawOutput: string) => Promise<void> | void;
  onStage: (stage: GenesisStageId) => Promise<void> | void;
};

function assertExpectedMode(deck: WorldDeck, expectedMode: WorldMode): void {
  if (deck.mode !== expectedMode) {
    throw new Error(`创世卡组模式不匹配：期望 ${expectedMode}，实际 ${deck.mode}`);
  }
}

function validateParsedDeck(
  rawDeck: unknown,
  expectedMode: WorldMode,
  materialSnapshot: GenesisMaterialSnapshot | null,
): WorldDeck {
  // Parse the union first so a valid opposite-mode response yields a clear mode error.
  const deck = WorldDeckSchema.parse(rawDeck);
  assertExpectedMode(deck, expectedMode);
  validateDeckReferences(deck);
  assertMaterializedDeck(deck, materialSnapshot);
  return deck;
}

function parseAndValidate(
  raw: string,
  expectedMode: WorldMode,
  materialSnapshot: GenesisMaterialSnapshot | null,
): WorldDeck {
  return validateParsedDeck(extractJson(raw), expectedMode, materialSnapshot);
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
  const mode = options.mode;
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
    return parseAndValidate(rawOutput, mode, options.materialSnapshot ?? null);
  } catch (error) {
    const validationError = describeValidationError(error);
    await options.onStage("repair");
    const sharedRepairInput = {
      decree: options.decree,
      lorebookExcerpts: options.lorebookExcerpts,
      invalidOutput: rawOutput,
      validationError,
    };
    const repaired = mode === "pantheon"
      ? await options.repairCompletion({
        ...sharedRepairInput,
        mode,
        schema: PantheonWorldDeckSchema,
      })
      : await options.repairCompletion({
        ...sharedRepairInput,
        mode,
        schema: CreatorWorldDeckSchema,
      });
    return validateParsedDeck(repaired, mode, options.materialSnapshot ?? null);
  }
}
