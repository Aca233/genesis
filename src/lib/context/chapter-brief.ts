import { z } from "zod";

const NullableBriefTextValueSchema = z.string().trim().min(1).max(1000).nullable();
const BriefListValueSchema = z.array(z.string().trim().min(1).max(300))
  .max(20)
  .transform((values) => [...new Set(values)]);

export const ChapterBriefSchema = z.object({
  objective: NullableBriefTextValueSchema.default(null),
  viewpointEntityId: z.string().trim().min(1).max(200).nullable().default(null),
  openingConstraint: NullableBriefTextValueSchema.default(null),
  endingConstraint: NullableBriefTextValueSchema.default(null),
  readerKnows: BriefListValueSchema.default([]),
  viewpointKnows: BriefListValueSchema.default([]),
  mustHide: BriefListValueSchema.default([]),
  hintOnly: BriefListValueSchema.default([]),
  forbiddenDevelopments: BriefListValueSchema.default([]),
}).strict();

export const ChapterBriefPatchSchema = z.object({
  objective: NullableBriefTextValueSchema.optional(),
  viewpointEntityId: z.string().trim().min(1).max(200).nullable().optional(),
  openingConstraint: NullableBriefTextValueSchema.optional(),
  endingConstraint: NullableBriefTextValueSchema.optional(),
  readerKnows: BriefListValueSchema.optional(),
  viewpointKnows: BriefListValueSchema.optional(),
  mustHide: BriefListValueSchema.optional(),
  hintOnly: BriefListValueSchema.optional(),
  forbiddenDevelopments: BriefListValueSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少提供一个章节约束字段");

export type ChapterBrief = z.infer<typeof ChapterBriefSchema>;
export type ChapterBriefPatch = z.infer<typeof ChapterBriefPatchSchema>;

export function normalizeChapterBrief(value: unknown): ChapterBrief {
  const parsed = ChapterBriefSchema.safeParse(value);
  return parsed.success ? parsed.data : ChapterBriefSchema.parse({});
}

export function mergeChapterBrief(current: unknown, patch: unknown): ChapterBrief {
  const delta = ChapterBriefPatchSchema.parse(patch);
  return ChapterBriefSchema.parse({
    ...normalizeChapterBrief(current),
    ...delta,
  });
}

function listSection(title: string, values: readonly string[]): string | null {
  return values.length ? `${title}:\n${values.map((value) => `- ${value}`).join("\n")}` : null;
}

export function formatChapterBriefSystem(value: unknown): string | null {
  const brief = normalizeChapterBrief(value);
  const populated = brief.objective !== null
    || brief.viewpointEntityId !== null
    || brief.openingConstraint !== null
    || brief.endingConstraint !== null
    || brief.readerKnows.length > 0
    || brief.viewpointKnows.length > 0
    || brief.mustHide.length > 0
    || brief.hintOnly.length > 0
    || brief.forbiddenDevelopments.length > 0;
  if (!populated) return null;

  const sections = [
    brief.objective ? `Objective: ${brief.objective}` : null,
    brief.viewpointEntityId ? `Viewpoint entity id: ${brief.viewpointEntityId}` : null,
    brief.openingConstraint ? `Opening constraint: ${brief.openingConstraint}` : null,
    brief.endingConstraint ? `Ending constraint: ${brief.endingConstraint}` : null,
    listSection("Reader knows", brief.readerKnows),
    listSection("Viewpoint character knows", brief.viewpointKnows),
    listSection("Must remain hidden", brief.mustHide),
    listSection("Hint only", brief.hintOnly),
    listSection("Forbidden developments", brief.forbiddenDevelopments),
  ].filter((section): section is string => section !== null);

  return `== CHAPTER BRIEF (binding) ==
This brief controls staging and information release. It never overrides established canon, ability limits or player agency.
${sections.join("\n\n")}`;
}
