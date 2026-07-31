import { z } from "zod";
import {
  CanonFutureEventSchema,
  CosmologyCardSchema,
  CreatorMajorGodCardSchema,
  CreatorWorldDeckSchema,
  EpochConflictCardSchema,
  FactionCardSchema,
  FusionAxiomCardSchema,
  MajorCharacterCardSchema,
  MajorGodCardSchema,
  MinorGodSchema,
  OpeningChapterBriefSchema,
  PantheonWorldDeckSchema,
  PlaceCardSchema,
  PlayerGodCardSchema,
  RaceCardSchema,
  RelationAtAnchorSchema,
  StyleCardSchema,
  TemporalAnchorCardSchema,
  ThemeCardSchema,
  type WorldDeck,
} from "@/lib/cards/schemas";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import type { WorldMode } from "@/lib/world-mode";
import type { GenesisTopLevelKey } from "./json-progress";
import type { GenesisStageId } from "./stages";
import { validateGenesisDeck } from "./generate";

export const LEGACY_GENESIS_STAGE_IDS = [
  "laws",
  "gods",
  "peoples",
  "characters",
  "conflict",
] as const;

export type LegacyGenesisStageId = (typeof LEGACY_GENESIS_STAGE_IDS)[number];

const ModeSchema = z.enum(["pantheon", "creator"]);

export const LegacyLawsOutputSchema = z.object({
  mode: ModeSchema,
  worldName: z.string().min(1),
  temporalAnchor: TemporalAnchorCardSchema.optional(),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable(),
}).strict();

export const LegacyPantheonGodsOutputSchema = z.object({
  mode: z.literal("pantheon"),
  playerGod: PlayerGodCardSchema,
  majorGods: z.array(MajorGodCardSchema).min(1).max(10),
  minorGods: z.array(MinorGodSchema),
}).strict();

export const LegacyCreatorGodsOutputSchema = z.object({
  mode: z.literal("creator"),
  majorGods: z.array(CreatorMajorGodCardSchema).min(1).max(10),
  minorGods: z.array(MinorGodSchema),
}).strict();

export const LegacyPeoplesOutputSchema = z.object({
  mode: ModeSchema,
  races: z.array(RaceCardSchema),
  factions: z.array(FactionCardSchema).min(2).max(8),
  places: z.array(PlaceCardSchema),
}).strict();

export const LegacyCharactersOutputSchema = z.object({
  mode: ModeSchema,
  majorCharacters: z.array(MajorCharacterCardSchema).min(4).max(12),
  relationsAtAnchor: z.array(RelationAtAnchorSchema).optional(),
}).strict();

export const LegacyConflictOutputSchema = z.object({
  mode: ModeSchema,
  epochConflict: EpochConflictCardSchema,
  openingChapterBrief: OpeningChapterBriefSchema.optional(),
  canonEvents: z.array(CanonFutureEventSchema).min(3).max(5).optional(),
  style: StyleCardSchema,
  theme: ThemeCardSchema,
}).strict();

const STAGE_KEYS: Record<LegacyGenesisStageId, readonly GenesisTopLevelKey[]> = {
  laws: ["mode", "worldName", "temporalAnchor", "cosmology", "fusionAxiom"],
  gods: ["majorGods", "minorGods"],
  peoples: ["races", "factions", "places"],
  characters: ["majorCharacters", "relationsAtAnchor"],
  conflict: ["epochConflict", "openingChapterBrief", "canonEvents", "style", "theme"],
};

function withFrozenMode(schema: z.ZodObject, mode: WorldMode): z.ZodType {
  return mode === "pantheon"
    ? schema.extend({ mode: z.literal("pantheon") })
    : schema.extend({ mode: z.literal("creator") });
}

export function legacyGenesisStageSchema(
  stageId: LegacyGenesisStageId,
  mode: WorldMode,
): z.ZodType {
  switch (stageId) {
    case "laws": return withFrozenMode(LegacyLawsOutputSchema, mode);
    case "gods": return mode === "pantheon"
      ? LegacyPantheonGodsOutputSchema
      : LegacyCreatorGodsOutputSchema;
    case "peoples": return withFrozenMode(LegacyPeoplesOutputSchema, mode);
    case "characters": return withFrozenMode(LegacyCharactersOutputSchema, mode);
    case "conflict": return withFrozenMode(LegacyConflictOutputSchema, mode);
  }
}

type StageOutputs = Partial<Record<LegacyGenesisStageId, unknown>>;

export type LegacyStageCompletionInput = {
  stageId: LegacyGenesisStageId;
  schema: z.ZodType;
  acceptedOutputs: Readonly<StageOutputs>;
  previousOutput?: unknown;
  validationError?: string;
};

export type LegacyStagedGenerationOptions = {
  mode: WorldMode;
  materialSnapshot: GenesisMaterialSnapshot | null;
  checkpoint?: string | null;
  completeStage: (input: LegacyStageCompletionInput) => Promise<unknown>;
  onStage: (stage: GenesisStageId) => Promise<void> | void;
  onCheckpoint: (input: {
    stageId: LegacyGenesisStageId;
    completedKeys: GenesisTopLevelKey[];
    checkpoint: string;
  }) => Promise<void> | void;
  onCheckpointRecovery: (input: {
    nextStage: GenesisStageId;
    completedKeys: GenesisTopLevelKey[];
    checkpoint: string;
    reason: string;
  }) => Promise<void> | void;
};

const CHECKPOINT_FORMAT = "legacy-staged-v1";
const MAX_TOTAL_REPAIR_ATTEMPTS = LEGACY_GENESIS_STAGE_IDS.length;
const MAX_REPAIR_ATTEMPTS_PER_STAGE = 2;

type CheckpointReadResult = {
  outputs: StageOutputs;
  recoveryReason?: string;
};

function readCheckpoint(raw: string | null | undefined, mode: WorldMode): CheckpointReadResult {
  if (!raw) return { outputs: {} };
  try {
    const parsed = JSON.parse(raw) as {
      format?: unknown;
      mode?: unknown;
      outputs?: Record<string, unknown>;
    };
    if (parsed.format !== CHECKPOINT_FORMAT) {
      return { outputs: {}, recoveryReason: "旧版或未知 checkpoint 格式" };
    }
    if (parsed.mode !== mode) {
      return { outputs: {}, recoveryReason: "checkpoint 模式与任务模式不一致" };
    }
    if (!parsed.outputs || typeof parsed.outputs !== "object") {
      return { outputs: {}, recoveryReason: "checkpoint 缺少分段输出" };
    }
    const outputs: StageOutputs = {};
    for (const [index, stageId] of LEGACY_GENESIS_STAGE_IDS.entries()) {
      if (parsed.outputs[stageId] === undefined) {
        const hasLaterOutput = LEGACY_GENESIS_STAGE_IDS
          .slice(index + 1)
          .some((laterStage) => parsed.outputs![laterStage] !== undefined);
        return {
          outputs,
          ...(hasLaterOutput
            ? { recoveryReason: `checkpoint 在 ${stageId} 段出现断层` }
            : {}),
        };
      }
      const result = legacyGenesisStageSchema(stageId, mode).safeParse(parsed.outputs[stageId]);
      if (!result.success) {
        return { outputs, recoveryReason: `checkpoint 的 ${stageId} 段校验失败` };
      }
      outputs[stageId] = result.data;
    }
    return { outputs };
  } catch {
    return { outputs: {}, recoveryReason: "checkpoint JSON 已损坏" };
  }
}

function serializeCheckpoint(mode: WorldMode, outputs: StageOutputs): string {
  return JSON.stringify({ format: CHECKPOINT_FORMAT, mode, outputs });
}

function completedKeys(outputs: StageOutputs, mode: WorldMode): GenesisTopLevelKey[] {
  return LEGACY_GENESIS_STAGE_IDS.flatMap((stageId) =>
    outputs[stageId] === undefined
      ? []
      : stageId === "gods" && mode === "pantheon"
        ? ["playerGod", ...STAGE_KEYS.gods]
        : STAGE_KEYS[stageId],
  );
}

function nextStage(outputs: StageOutputs): GenesisStageId {
  return LEGACY_GENESIS_STAGE_IDS.find((stageId) => outputs[stageId] === undefined)
    ?? "validation";
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    return JSON.stringify((error as { issues: unknown }).issues, null, 2);
  }
  return error instanceof Error ? error.message : String(error);
}

function repairStageFor(error: unknown): LegacyGenesisStageId {
  const message = describeError(error);
  if (/majorCharacters|relationsAtAnchor|raceRef|factionRef|keyCharacterRefs|sourceAbilityRef|racialOverrides|种族引用|势力引用|关键人物引用|能力来源引用|族群技艺来源|人物派生/.test(message)) {
    return "characters";
  }
  if (/playerGod|majorGods|minorGods|stanceToPlayer|initialRelationToPlayer|主神关系|神明关系/.test(message)) return "gods";
  if (/races|factions|places/.test(message)) return "peoples";
  if (/epochConflict|openingChapterBrief|canonEvents|style|theme/.test(message)) return "conflict";
  if (/worldName|temporalAnchor|cosmology|fusionAxiom|mode/.test(message)) return "laws";
  return "characters";
}

function assembleDeck(outputs: StageOutputs, mode: WorldMode): unknown {
  const laws = LegacyLawsOutputSchema.parse(outputs.laws);
  const peoples = LegacyPeoplesOutputSchema.parse(outputs.peoples);
  const characters = LegacyCharactersOutputSchema.parse(outputs.characters);
  const conflict = LegacyConflictOutputSchema.parse(outputs.conflict);
  const shared = { ...laws, ...peoples, ...characters, ...conflict, mode };

  if (mode === "pantheon") {
    const gods = LegacyPantheonGodsOutputSchema.parse(outputs.gods);
    return PantheonWorldDeckSchema.parse({ ...shared, ...gods, mode });
  }
  const gods = LegacyCreatorGodsOutputSchema.parse(outputs.gods);
  return CreatorWorldDeckSchema.parse({ ...shared, ...gods, mode });
}

/** Sequential July-24-style generation: five bounded calls, one checkpoint after each call. */
export async function generateLegacyStagedDeck(
  options: LegacyStagedGenerationOptions,
): Promise<WorldDeck> {
  const checkpoint = readCheckpoint(options.checkpoint, options.mode);
  const outputs = checkpoint.outputs;
  if (checkpoint.recoveryReason) {
    await options.onCheckpointRecovery({
      nextStage: nextStage(outputs),
      completedKeys: completedKeys(outputs, options.mode),
      checkpoint: serializeCheckpoint(options.mode, outputs),
      reason: checkpoint.recoveryReason,
    });
  }

  for (const stageId of LEGACY_GENESIS_STAGE_IDS) {
    if (outputs[stageId] !== undefined) continue;
    await options.onStage(stageId);
    const schema = legacyGenesisStageSchema(stageId, options.mode);
    outputs[stageId] = schema.parse(await options.completeStage({
      stageId,
      schema,
      acceptedOutputs: { ...outputs },
    }));
    await options.onCheckpoint({
      stageId,
      completedKeys: completedKeys(outputs, options.mode),
      checkpoint: serializeCheckpoint(options.mode, outputs),
    });
  }

  const repairAttempts = new Map<LegacyGenesisStageId, number>();
  for (let totalRepairs = 0; totalRepairs <= MAX_TOTAL_REPAIR_ATTEMPTS; totalRepairs += 1) {
    await options.onStage("validation");
    try {
      return validateGenesisDeck(
        assembleDeck(outputs, options.mode),
        options.mode,
        options.materialSnapshot,
      );
    } catch (error) {
      if (totalRepairs === MAX_TOTAL_REPAIR_ATTEMPTS) throw error;
      const stageId = repairStageFor(error);
      const stageAttempts = repairAttempts.get(stageId) ?? 0;
      if (stageAttempts >= MAX_REPAIR_ATTEMPTS_PER_STAGE) throw error;
      repairAttempts.set(stageId, stageAttempts + 1);
      await options.onStage("repair");
      const schema = legacyGenesisStageSchema(stageId, options.mode);
      const acceptedOutputs = { ...outputs };
      delete acceptedOutputs[stageId];
      outputs[stageId] = schema.parse(await options.completeStage({
        stageId,
        schema,
        acceptedOutputs,
        previousOutput: outputs[stageId],
        validationError: describeError(error),
      }));
      await options.onCheckpoint({
        stageId,
        completedKeys: completedKeys(outputs, options.mode),
        checkpoint: serializeCheckpoint(options.mode, outputs),
      });
    }
  }
  throw new Error("分段创世未能组装为完整世界");
}
