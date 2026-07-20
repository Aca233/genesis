import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  AbilityOptimisticConflictError,
  applyAbilityChange,
  type AbilityMutationClient,
} from "@/lib/abilities/mutations";
import { AbilityValidationError } from "@/lib/abilities/validator";
import {
  AbilityEventTypeSchema,
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
} from "@/lib/abilities/types";

const EditableAbilityFieldsSchema = z.object({
  name: z.string(),
  kind: AbilityKindSchema,
  effect: z.string(),
  trigger: z.string(),
  cost: z.string(),
  limitations: z.string(),
  mastery: AbilityMasterySchema,
  state: AbilityStateSchema,
  visibility: AbilityVisibilitySchema,
  rumorText: z.string().nullable(),
  bloodlineJustification: z.string().nullable(),
  sourceAbilityId: z.string().nullable(),
  lockedFields: z.array(z.string()),
}).partial().strict();

const EventSchema = z.object({
  type: AbilityEventTypeSchema,
  chapterId: z.string().min(1),
  messageId: z.string().min(1).nullable().optional(),
  evidence: z.string(),
  scale: z.enum(["scene", "era", "epoch"]),
  dedupeKey: z.string().min(1),
}).strict();

const PatchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  patch: EditableAbilityFieldsSchema,
  event: EventSchema,
}).strict();

const DeleteSchema = z.object({
  expectedVersion: z.number().int().positive(),
  event: EventSchema.optional(),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "请求参数无效", details: error.issues }, { status: 400 });
  }
  if (
    error instanceof AbilityValidationError ||
    error instanceof AbilityOptimisticConflictError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}

/** PATCH /api/abilities/[id] —— 乐观锁下的能力更新与沿革记录。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = PatchSchema.parse(await request.json());
    const result = await applyAbilityChange(prisma as unknown as AbilityMutationClient, {
      abilityId: id,
      version: body.expectedVersion,
      patch: body.patch,
      event: body.event,
    });

    return NextResponse.json({
      applied: result.applied,
      ability: result.ability ?? null,
      event: result.event,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/abilities/[id] —— 尚无沿革时物理删除；已有沿革时废弃，保留史料。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = DeleteSchema.parse(await request.json());
    const ability = await prisma.ability.findUnique({ where: { id } });
    if (ability === null) {
      return NextResponse.json({ error: "能力不存在" }, { status: 404 });
    }
    if (ability.version !== body.expectedVersion) {
      return NextResponse.json({ error: "能力已被其他变更更新，请刷新后重试" }, { status: 409 });
    }

    const eventCount = await prisma.abilityEvent.count({ where: { abilityId: id } });
    if (eventCount === 0) {
      await prisma.ability.delete({ where: { id } });
      return NextResponse.json({ deleted: true, deprecated: false });
    }
    if (body.event === undefined) {
      return NextResponse.json({ error: "废弃有沿革的能力必须提供事件证据" }, { status: 400 });
    }

    const result = await applyAbilityChange(prisma as unknown as AbilityMutationClient, {
      abilityId: id,
      version: body.expectedVersion,
      patch: { state: "deprecated" },
      event: { ...body.event, type: "deprecated" },
    });
    return NextResponse.json({
      deleted: false,
      deprecated: true,
      applied: result.applied,
      ability: result.ability ?? null,
      event: result.event,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
