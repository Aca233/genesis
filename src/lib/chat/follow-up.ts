import { z } from "zod";
import { ContinuousNarratorMetaSchema } from "./continuous-meta";

export const ChatFollowUpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({
    kind: z.literal("settlement"),
    segmentId: z.string().trim().min(1),
  }).strict(),
  z.object({
    kind: z.literal("rewrite"),
    taskId: z.string().trim().min(1),
  }).strict(),
]);

export const GenerationCompletionSchema = z.object({
  messageId: z.string().trim().min(1).nullable(),
  meta: ContinuousNarratorMetaSchema,
  followUp: ChatFollowUpSchema,
}).strict();

export const StoredGenerationResultSchema = GenerationCompletionSchema.extend({
  version: z.literal(1),
}).strict();

export type ChatFollowUp = z.infer<typeof ChatFollowUpSchema>;
export type GenerationCompletion = z.infer<typeof GenerationCompletionSchema>;
export type StoredGenerationResult = z.infer<typeof StoredGenerationResultSchema>;

