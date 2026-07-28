import type { WorldDeck } from "@/lib/cards/schemas";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  WorldDeckSchema,
} from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { validateTemporalConsistency } from "@/lib/genesis/temporal-validator";
import { extractJson } from "@/lib/llm/structured";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import { assertMaterializedDeck } from "@/lib/materials/validate-result";
import type { WorldMode } from "@/lib/world-mode";
import {
  TopLevelJsonProgressScanner,
  type GenesisTopLevelKey,
} from "./json-progress";
import { mergeCompletedKeys, type GenesisStageId } from "./stages";
import {
  GENESIS_NORMALIZED_MAX_BYTES,
  GENESIS_VALIDATION_MAX_BYTES,
  PayloadLimitError,
  takeUtf8Prefix,
  utf8Bytes,
} from "./limits";

/** 定向修复轮数上限:第二轮可解决第一轮修复稿的残余语义错误。 */
const MAX_REPAIR_ROUNDS = 2;

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
  maxOutputBytes?: number;
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
  const normalized = JSON.stringify(rawDeck);
  const normalizedBytes = utf8Bytes(normalized);
  if (normalizedBytes > GENESIS_NORMALIZED_MAX_BYTES) {
    throw new PayloadLimitError(
      "OUTPUT_LIMIT_EXCEEDED",
      normalizedBytes,
      GENESIS_NORMALIZED_MAX_BYTES,
      takeUtf8Prefix(normalized, GENESIS_NORMALIZED_MAX_BYTES),
    );
  }
  // Parse the union first so a valid opposite-mode response yields a clear mode error.
  const deck = WorldDeckSchema.parse(rawDeck);
  assertExpectedMode(deck, expectedMode);
  validateDeckReferences(deck);
  // 时间一致性 T1–T7（仅对携带 temporalAnchor 的新契约卡组生效；失败走既有修复路径）。
  validateTemporalConsistency(deck);
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
    return takeUtf8Prefix(
      JSON.stringify((error as { issues: unknown }).issues, null, 2),
      GENESIS_VALIDATION_MAX_BYTES,
    );
  }
  return takeUtf8Prefix(
    error instanceof Error ? error.message : String(error),
    GENESIS_VALIDATION_MAX_BYTES,
  );
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
    const raw = scanner.getRaw();
    const observedBytes = utf8Bytes(raw) + utf8Bytes(text);
    if (options.maxOutputBytes !== undefined && observedBytes > options.maxOutputBytes) {
      const boundedText = takeUtf8Prefix(text, options.maxOutputBytes - utf8Bytes(raw));
      if (boundedText) scanner.push(boundedText);
      const boundedPrefix = scanner.getRaw();
      await options.onChunk(boundedPrefix);
      throw new PayloadLimitError(
        "OUTPUT_LIMIT_EXCEEDED",
        observedBytes,
        options.maxOutputBytes,
        boundedPrefix,
      );
    }
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
    // 最多两轮定向修复:第一轮针对流式原文,第二轮针对上一轮修复稿的残余问题。
    let invalidOutput = rawOutput;
    let validationError = describeValidationError(error);
    let lastError: unknown = error;
    for (let round = 0; round < MAX_REPAIR_ROUNDS; round += 1) {
      await options.onStage("repair");
      const sharedRepairInput = {
        decree: options.decree,
        lorebookExcerpts: options.lorebookExcerpts,
        invalidOutput,
        validationError,
      };
      let repaired: unknown;
      try {
        repaired = mode === "pantheon"
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
      } catch (repairError) {
        if (repairError instanceof PayloadLimitError) throw repairError;
        lastError = repairError;
        continue;
      }
      try {
        return validateParsedDeck(repaired, mode, options.materialSnapshot ?? null);
      } catch (repairError) {
        if (repairError instanceof PayloadLimitError) throw repairError;
        lastError = repairError;
        invalidOutput = JSON.stringify(repaired);
        validationError = describeValidationError(repairError);
      }
    }
    throw lastError;
  }
}
