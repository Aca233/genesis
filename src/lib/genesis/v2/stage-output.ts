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
import type { WorldMode } from "@/lib/world-mode";
import type { GenesisV2StageId } from "./stage-registry";

const WorldModeLiteralSchema = z.enum(["pantheon", "creator"]);

const SlotBriefSchema = z.object({
  role: z.string().min(1),
  differentiation: z.string().min(1),
  interfaces: z.array(z.string().min(1)).max(6),
}).strict();

export const GenesisV2BlueprintOutputSchema = z.object({
  mode: WorldModeLiteralSchema,
  worldName: z.string().min(1),
  temporalAnchor: TemporalAnchorCardSchema.optional(),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable(),
  style: StyleCardSchema,
  theme: ThemeCardSchema,
  canonBrief: z.string().min(1),
  slotBriefs: z.record(z.string(), SlotBriefSchema),
}).strict();

const SharedPantheonDomainShape = {
  minorGods: z.array(MinorGodSchema),
};

export const GenesisV2PantheonDomainOutputSchema = z.object({
  mode: z.literal("pantheon"),
  ...SharedPantheonDomainShape,
  playerGod: PlayerGodCardSchema,
  majorGods: z.array(MajorGodCardSchema).min(1).max(10),
}).strict();

export const GenesisV2CreatorDomainOutputSchema = z.object({
  mode: z.literal("creator"),
  ...SharedPantheonDomainShape,
  majorGods: z.array(CreatorMajorGodCardSchema).min(1).max(10),
}).strict();

export const GenesisV2CivilizationsOutputSchema = z.object({
  mode: WorldModeLiteralSchema,
  factions: z.array(FactionCardSchema).min(2).max(8),
  races: z.array(RaceCardSchema),
  places: z.array(PlaceCardSchema),
}).strict();

export const GenesisV2ErasOutputSchema = z.object({
  mode: WorldModeLiteralSchema,
  epochConflict: EpochConflictCardSchema,
  openingChapterBrief: OpeningChapterBriefSchema.optional(),
  canonEvents: z.array(CanonFutureEventSchema).min(3).max(5).optional(),
}).strict();

export const GenesisV2CharactersOutputSchema = z.object({
  mode: WorldModeLiteralSchema,
  majorCharacters: z.array(MajorCharacterCardSchema).min(4).max(12),
  relationsAtAnchor: z.array(RelationAtAnchorSchema).optional(),
}).strict().superRefine((output, ctx) => {
  output.majorCharacters.forEach((character, index) => {
    if ((character.statusAtAnchor ?? "active") !== "active") return;
    const heldAbilityCount = character.abilities.filter(
      ({ timing }) => (timing ?? "at_anchor") === "at_anchor",
    ).length;
    if (heldAbilityCount >= 2) return;
    ctx.addIssue({
      code: "custom",
      path: ["majorCharacters", index, "abilities"],
      message: "active 人物必须至少有 2 个 timing=at_anchor 的个人技能；future/lost 能力不计入当前持有技能",
    });
  });
});

export type GenesisV2StageOutputs = {
  blueprint: z.infer<typeof GenesisV2BlueprintOutputSchema>;
  pantheon_domain:
    | z.infer<typeof GenesisV2PantheonDomainOutputSchema>
    | z.infer<typeof GenesisV2CreatorDomainOutputSchema>;
  civilizations: z.infer<typeof GenesisV2CivilizationsOutputSchema>;
  eras: z.infer<typeof GenesisV2ErasOutputSchema>;
  characters: z.infer<typeof GenesisV2CharactersOutputSchema>;
};

export type GenesisV2CharactersRelationContext = {
  pantheonDomain: GenesisV2StageOutputs["pantheon_domain"];
  civilizations: GenesisV2StageOutputs["civilizations"];
};

const MIN_CHARACTER_ABILITIES = 2;
const MAX_RELATIONS_PER_ACTIVE_CHARACTER = 4;

export function sanitizeGenesisV2CharactersTemporalOutput(
  rawOutput: GenesisV2StageOutputs["characters"],
  relationContext?: GenesisV2CharactersRelationContext,
): GenesisV2StageOutputs["characters"] {
  const output = GenesisV2CharactersOutputSchema.parse(rawOutput);
  const activeCharacterRefs = new Set(output.majorCharacters.flatMap((character) =>
    (character.statusAtAnchor ?? "active") === "active" ? [character.ref] : [],
  ));
  const relationCounts = new Map<string, number>();
  const validRelationRefs = relationContext === undefined
    ? null
    : new Set([
      ...(relationContext.pantheonDomain.mode === "pantheon"
        ? [relationContext.pantheonDomain.playerGod.ref]
        : []),
      ...relationContext.pantheonDomain.majorGods.map(({ ref }) => ref),
      ...relationContext.civilizations.races.map(({ ref }) => ref),
      ...relationContext.civilizations.factions.map(({ ref }) => ref),
      ...relationContext.civilizations.places.map(({ ref }) => ref),
      ...output.majorCharacters.map(({ ref }) => ref),
    ]);
  const relationsAtAnchor = output.relationsAtAnchor?.filter((relation) => {
    if (validRelationRefs !== null
      && (!validRelationRefs.has(relation.sourceRef) || !validRelationRefs.has(relation.targetRef))) {
      return false;
    }
    if (!activeCharacterRefs.has(relation.sourceRef)) return true;
    const count = relationCounts.get(relation.sourceRef) ?? 0;
    relationCounts.set(relation.sourceRef, count + 1);
    return count < MAX_RELATIONS_PER_ACTIVE_CHARACTER;
  });
  return {
    ...output,
    ...(relationsAtAnchor === undefined ? {} : { relationsAtAnchor }),
    majorCharacters: output.majorCharacters.map((character) => {
      if ((character.statusAtAnchor ?? "active") !== "active") return character;

      let removableAbilities = Math.max(0, character.abilities.length - MIN_CHARACTER_ABILITIES);
      const abilities = character.abilities.filter((ability) => {
        if (ability.timing !== "future" || removableAbilities === 0) return true;
        removableAbilities -= 1;
        return false;
      });
      const racialOverrides = character.racialOverrides.filter(({ timing }) => timing !== "future");
      if (
        abilities.length === character.abilities.length
        && racialOverrides.length === character.racialOverrides.length
      ) return character;
      return { ...character, abilities, racialOverrides };
    }),
  };
}

export function getGenesisV2StageOutputSchema(
  stageId: GenesisV2StageId,
  mode: WorldMode,
): z.ZodType {
  switch (stageId) {
    case "blueprint":
      return GenesisV2BlueprintOutputSchema;
    case "pantheon_domain":
      return mode === "pantheon"
        ? GenesisV2PantheonDomainOutputSchema
        : GenesisV2CreatorDomainOutputSchema;
    case "civilizations":
      return GenesisV2CivilizationsOutputSchema;
    case "eras":
      return GenesisV2ErasOutputSchema;
    case "characters":
      return GenesisV2CharactersOutputSchema;
  }
}

function assertArtifactModes(outputs: GenesisV2StageOutputs, mode: WorldMode): void {
  for (const [stageId, output] of Object.entries(outputs)) {
    if (output.mode !== mode) {
      throw new Error(`Genesis V2 Artifact 模式不匹配：${stageId}=${output.mode}，任务=${mode}`);
    }
  }
}

export function assembleGenesisV2WorldDeck(
  rawOutputs: GenesisV2StageOutputs,
  mode: WorldMode,
): WorldDeck {
  assertArtifactModes(rawOutputs, mode);

  const outputs = {
    blueprint: GenesisV2BlueprintOutputSchema.parse(rawOutputs.blueprint),
    pantheon_domain: getGenesisV2StageOutputSchema("pantheon_domain", mode)
      .parse(rawOutputs.pantheon_domain) as GenesisV2StageOutputs["pantheon_domain"],
    civilizations: GenesisV2CivilizationsOutputSchema.parse(rawOutputs.civilizations),
    eras: GenesisV2ErasOutputSchema.parse(rawOutputs.eras),
    characters: GenesisV2CharactersOutputSchema.parse(rawOutputs.characters),
  } satisfies GenesisV2StageOutputs;

  assertArtifactModes(outputs, mode);

  const { canonBrief: _canonBrief, slotBriefs: _slotBriefs, ...blueprint } = outputs.blueprint;
  void _canonBrief;
  void _slotBriefs;
  const shared = {
    ...blueprint,
    ...outputs.civilizations,
    ...outputs.eras,
    ...outputs.characters,
    mode,
  };

  if (mode === "pantheon") {
    if (outputs.pantheon_domain.mode !== "pantheon") {
      throw new Error("Genesis V2 神系 Artifact 模式不匹配");
    }
    return PantheonWorldDeckSchema.parse({
      ...shared,
      playerGod: outputs.pantheon_domain.playerGod,
      majorGods: outputs.pantheon_domain.majorGods,
      minorGods: outputs.pantheon_domain.minorGods,
    });
  }

  if (outputs.pantheon_domain.mode !== "creator") {
    throw new Error("Genesis V2 神系 Artifact 模式不匹配");
  }
  return CreatorWorldDeckSchema.parse({
    ...shared,
    majorGods: outputs.pantheon_domain.majorGods,
    minorGods: outputs.pantheon_domain.minorGods,
  });
}
