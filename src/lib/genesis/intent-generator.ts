import { z } from "zod";
import { completeStructured } from "@/lib/llm/structured";
import type { CompletionRequest } from "@/lib/llm/types";
import type { WorldMode } from "@/lib/world-mode";
import { genesisIntentSystem, genesisIntentUserPrompt } from "@/lib/prompts/genesis-intent";
import {
  GenesisIntentContractSchema,
  assertGenesisIntentForMode,
  type GenesisIntentContract,
} from "./intent";

export type GenerateGenesisIntentInput = {
  mode: WorldMode;
  decree: string;
  userId: string;
  lorebookExcerpts?: string;
  owner?: CompletionRequest["owner"];
};

export type IntentGeneratorDeps = {
  complete: (
    slot: "backstage",
    opts: {
      task: "extract";
      userId: string;
      owner?: CompletionRequest["owner"];
      system: string;
      user: string;
      schema: z.ZodType<GenesisIntentContract>;
      temperature: number;
      maxTokens: number;
      maxAttempts: number;
      transportMaxAttempts: number;
      allowTransportFallback: boolean;
      failOnTruncation: boolean;
    },
  ) => Promise<unknown>;
};

export class GenesisIntentGenerationError extends Error {
  override name = "GenesisIntentGenerationError";

  constructor(cause: unknown) {
    super("创世意图提取失败，请稍后重试", { cause });
  }
}

const INTENT_ATTEMPTS = 2;

export async function generateGenesisIntent(
  input: GenerateGenesisIntentInput,
  deps: IntentGeneratorDeps = { complete: completeStructured },
): Promise<GenesisIntentContract> {
  let lastError: unknown;

  for (let attempt = 0; attempt < INTENT_ATTEMPTS; attempt += 1) {
    try {
      const result = await deps.complete("backstage", {
        task: "extract",
        userId: input.userId,
        owner: input.owner,
        system: genesisIntentSystem(input.mode),
        user: genesisIntentUserPrompt(input),
        schema: GenesisIntentContractSchema,
        temperature: 0.1,
        maxTokens: 3000,
        maxAttempts: 1,
        transportMaxAttempts: 1,
        allowTransportFallback: false,
        failOnTruncation: false,
      });
      const intent = GenesisIntentContractSchema.parse(result);
      assertGenesisIntentForMode(intent, input.mode);
      return intent;
    } catch (error) {
      lastError = error;
    }
  }

  throw new GenesisIntentGenerationError(lastError);
}
