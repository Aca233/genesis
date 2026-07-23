import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(200);

export const ActivityVisibilitySchema = z.enum([
  "public",
  "player_known",
  "hidden",
]);

export const WorldActionSchema = z.object({
  actorType: z.enum(["god", "entity"]),
  actorId: IdentifierSchema,
  action: z.string().trim().min(1).max(500),
  targetIds: z.array(IdentifierSchema).max(8),
  visibility: ActivityVisibilitySchema,
  consequence: z.string().trim().min(1).max(1000),
}).strict();

export const ActivityEntrySchema = z.object({
  kind: z.enum([
    "movement",
    "rumor",
    "omen",
    "meeting",
    "relation",
    "conflict",
    "discovery",
  ]),
  text: z.string().trim().min(1).max(1000),
  subjectIds: z.array(IdentifierSchema).min(1).max(12),
  visibility: ActivityVisibilitySchema,
  importance: z.literal("normal"),
}).strict();

const ImportantEventKindSchema = z.enum([
  "war",
  "conspiracy",
  "disaster",
  "religious_conflict",
  "faction_shift",
  "world_crisis",
]);

const EventPhaseSchema = z.enum([
  "emerging",
  "developing",
  "escalating",
  "resolved",
]);

export const ImportantEventMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    tempRef: z.string().trim().min(1).max(80),
    kind: ImportantEventKindSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(2000),
    phase: z.enum(["emerging", "escalating"]),
    participantIds: z.array(IdentifierSchema).min(1).max(30),
    visibility: ActivityVisibilitySchema,
    progressText: z.string().trim().min(1).max(1000),
    originActivityId: IdentifierSchema.optional(),
  }).strict(),
  z.object({
    operation: z.literal("advance"),
    eventId: IdentifierSchema,
    phase: EventPhaseSchema,
    summary: z.string().trim().min(1).max(2000),
    participantIds: z.array(IdentifierSchema).min(1).max(30),
    visibility: ActivityVisibilitySchema,
    progressText: z.string().trim().min(1).max(1000),
  }).strict(),
]);

export const WorldActivityMetaSchema = z.object({
  worldActions: z.array(WorldActionSchema).max(3).default([]),
  activityEntries: z.array(ActivityEntrySchema).max(3).default([]),
  importantEventMutation: ImportantEventMutationSchema.optional(),
}).strict();

export type ActivityVisibility = z.infer<typeof ActivityVisibilitySchema>;
export type WorldAction = z.infer<typeof WorldActionSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export type ImportantEventMutation = z.infer<typeof ImportantEventMutationSchema>;
export type WorldActivityMeta = z.infer<typeof WorldActivityMetaSchema>;
