import { z } from "zod";
import {
  CosmologyCardSchema, DeckAbilitySchema, EpochConflictCardSchema,
  CreatorMajorGodCardSchema, FactionCardSchema, FusionAxiomCardSchema, MajorCharacterCardSchema,
  MajorGodCardSchema, PlaceCardSchema, PlayerGodCardSchema, RaceCardSchema,
  StyleCardSchema, ThemeCardSchema,
} from "@/lib/cards/schemas";
import { MaterialKindSchema, MaterialOriginSchema } from "./types";

export const MATERIAL_SCHEMA_VERSION = 1;
const base = { schemaVersion: z.literal(1), origin: MaterialOriginSchema };
const runtimeCard = z.record(z.string(), z.unknown());
const withOrigins = <T extends z.ZodType>(deck: T) => z.union([
  z.object({ ...base, origin: z.literal("deck"), card: deck }),
  z.object({ ...base, origin: z.literal("runtime"), card: runtimeCard }),
  z.object({ ...base, origin: z.literal("edited"), card: z.union([deck, runtimeCard]) }),
]);

export const PlayerGodMaterialSchema = withOrigins(PlayerGodCardSchema).and(z.object({ kind: z.literal("player_god") }));
export const MajorGodMaterialSchema = withOrigins(z.union([MajorGodCardSchema, CreatorMajorGodCardSchema])).and(z.object({ kind: z.literal("major_god") }));
export const CharacterMaterialSchema = withOrigins(MajorCharacterCardSchema).and(z.object({ kind: z.literal("character") }));
export const RaceMaterialSchema = withOrigins(RaceCardSchema).and(z.object({ kind: z.literal("race") }));
export const FactionMaterialSchema = withOrigins(FactionCardSchema).and(z.object({ kind: z.literal("faction") }));
export const PlaceMaterialSchema = withOrigins(PlaceCardSchema).and(z.object({ kind: z.literal("place") }));
const abilityOwner = z.object({ kind: z.enum(["god", "character", "race"]), sourceRef: z.string().min(1) });
export const AbilityMaterialSchema = z.union([
  z.object({ ...base, origin: z.literal("deck"), kind: z.literal("ability"), card: DeckAbilitySchema, owner: abilityOwner }),
  z.object({ ...base, origin: z.literal("runtime"), kind: z.literal("ability"), card: runtimeCard, owner: abilityOwner }),
  z.object({ ...base, origin: z.literal("edited"), kind: z.literal("ability"), card: z.union([DeckAbilitySchema, runtimeCard]), owner: abilityOwner }),
]);
export const CosmologyMaterialSchema = withOrigins(CosmologyCardSchema).and(z.object({ kind: z.literal("cosmology") }));
export const FusionAxiomMaterialSchema = withOrigins(FusionAxiomCardSchema).and(z.object({ kind: z.literal("fusion_axiom") }));
export const EpochConflictMaterialSchema = withOrigins(EpochConflictCardSchema).and(z.object({ kind: z.literal("epoch_conflict") }));
export const StyleMaterialSchema = withOrigins(StyleCardSchema).and(z.object({ kind: z.literal("style") }));
export const ThemeMaterialSchema = withOrigins(ThemeCardSchema).and(z.object({ kind: z.literal("theme") }));

export const MaterialVersionContentSchema = z.union([
  PlayerGodMaterialSchema, MajorGodMaterialSchema, CharacterMaterialSchema,
  RaceMaterialSchema, FactionMaterialSchema, PlaceMaterialSchema, AbilityMaterialSchema,
  CosmologyMaterialSchema, FusionAxiomMaterialSchema, EpochConflictMaterialSchema,
  StyleMaterialSchema, ThemeMaterialSchema,
]).superRefine((value, ctx) => {
  if (!MaterialKindSchema.safeParse(value.kind).success) ctx.addIssue({ code: "custom", message: "未知素材类型" });
});
export type MaterialVersionContent = z.infer<typeof MaterialVersionContentSchema>;

export function migrateMaterialVersion(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("素材版本格式无效");
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (version !== MATERIAL_SCHEMA_VERSION) throw new Error(`不支持的素材结构版本：${String(version)}`);
  return raw;
}
export function parseMaterialVersionContent(raw: unknown): MaterialVersionContent {
  return MaterialVersionContentSchema.parse(migrateMaterialVersion(raw));
}
