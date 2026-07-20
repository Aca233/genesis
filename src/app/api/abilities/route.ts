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
  try {
    const input = CreateAbilitySchema.parse(await request.json());
    const timeline = await prisma.timeline.findUnique({
      where: { id: input.timelineId },
      include: { world: { select: { activeTimelineId: true } } },
    });
    if (timeline === null || timeline.world.activeTimelineId !== input.timelineId) {
      return NextResponse.json({ error: "只能在当前活动时间线创建能力" }, { status: 409 });
    }

    const created = await prisma.$transaction(async (tx) => {
      await validateAbilityOwnership(tx as unknown as AbilityValidationTx, {
        id: "manual-create",
        timelineId: input.timelineId,
        entityId: input.entityId,
        godId: input.godId,
        sourceAbilityId: input.sourceAbilityId,
        kind: input.kind,
        bloodlineJustification: input.bloodlineJustification,
      });
      return tx.ability.create({ data: input });
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
    throw error;
  }
}
