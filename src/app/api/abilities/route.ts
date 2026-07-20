import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
  normalizePersistedAbility,
} from "@/lib/abilities/types";
import { projectAbilityForPlayer } from "@/lib/abilities/visibility";
import {
  AbilityValidationError,
  validateAbilityOwnership,
  type AbilityValidationTx,
} from "@/lib/abilities/validator";

function isDerivedSourceUniquenessError(
  error: unknown,
  input: z.infer<typeof CreateAbilitySchema>,
): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  if (
    input.entityId === null ||
    input.sourceAbilityId === null ||
    (input.kind !== "racial_innate" && input.kind !== "racial_tradition")
  ) return false;
  const target = candidate.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
  return fields.length === 0 || (fields.some((field) => field.includes("entity_id")) &&
    fields.some((field) => field.includes("source_ability_id")));
}

const CreateAbilitySchema = z.object({
  timelineId: z.string().min(1),
  entityId: z.string().min(1).nullable(),
  godId: z.string().min(1).nullable(),
  name: z.string().min(1),
  kind: AbilityKindSchema,
  effect: z.string(),
  trigger: z.string(),
  cost: z.string(),
  limitations: z.string(),
  mastery: AbilityMasterySchema,
  state: AbilityStateSchema,
  visibility: AbilityVisibilitySchema.exclude(["hidden"]),
  rumorText: z.string().nullable(),
  bloodlineJustification: z.string().nullable(),
  sourceAbilityId: z.string().min(1).nullable(),
  lockedFields: z.array(z.string()),
}).strict();

/** POST /api/abilities —— 当前活动时间线中的手动能力创建。 */
export async function POST(request: Request) {
  let input: z.infer<typeof CreateAbilitySchema> | undefined;
  try {
    const parsedInput = CreateAbilitySchema.parse(await request.json());
    input = parsedInput;
    const timeline = await prisma.timeline.findUnique({
      where: { id: parsedInput.timelineId },
      include: { world: { select: { activeTimelineId: true } } },
    });
    if (timeline === null || timeline.world.activeTimelineId !== parsedInput.timelineId) {
      return NextResponse.json({ error: "只能在当前活动时间线创建能力" }, { status: 409 });
    }

    const created = await prisma.$transaction(async (tx) => {
      await validateAbilityOwnership(tx as unknown as AbilityValidationTx, {
        id: "manual-create",
        timelineId: parsedInput.timelineId,
        entityId: parsedInput.entityId,
        godId: parsedInput.godId,
        sourceAbilityId: parsedInput.sourceAbilityId,
        kind: parsedInput.kind,
        bloodlineJustification: parsedInput.bloodlineJustification,
      });
      return tx.ability.create({ data: parsedInput });
    });
    const ability = projectAbilityForPlayer(normalizePersistedAbility(created));
    return NextResponse.json({ ability }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "请求参数无效", details: error.issues }, { status: 400 });
    }
    if (error instanceof AbilityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (input !== undefined && isDerivedSourceUniquenessError(error, input)) {
      return NextResponse.json({ error: "同一人物不能拥有重复的活跃种族能力来源" }, { status: 409 });
    }
    throw error;
  }
}
