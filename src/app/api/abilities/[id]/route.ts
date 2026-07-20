import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  AbilityOptimisticConflictError,
  applyAbilityChange,
  applyAbilityChangeInTransaction,
  type AbilityMutationClient,
  type AbilityMutationTx,
} from "@/lib/abilities/mutations";
import { AbilityValidationError } from "@/lib/abilities/validator";
import {
  AbilityEventTypeSchema,
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  normalizePersistedAbility,
} from "@/lib/abilities/types";
import { projectAbilityForPlayer } from "@/lib/abilities/visibility";

const EditableAbilityFieldsSchema = z.object({
  name: z.string(),
  kind: AbilityKindSchema,
  effect: z.string(),
  trigger: z.string(),
  cost: z.string(),
  limitations: z.string(),
  mastery: AbilityMasterySchema,
  state: AbilityStateSchema,
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

class AbilityDeleteRequestError extends Error {
  override name = "AbilityDeleteRequestError";
}

type DeleteAbilityTx = AbilityMutationTx & {
  ability: AbilityMutationTx["ability"] & {
    deleteMany(args: { where: { id: string; version: number } }): Promise<{ count: number }>;
  };
  abilityEvent: AbilityMutationTx["abilityEvent"] & {
    count(args: { where: { abilityId: string } }): Promise<number>;
  };
};

type DeleteAbilityClient = {
  $transaction<T>(
    operation: (tx: DeleteAbilityTx) => Promise<T>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError || error instanceof AbilityDeleteRequestError) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求参数无效" }, { status: 400 });
  }
  if (
    error instanceof AbilityValidationError ||
    error instanceof AbilityOptimisticConflictError
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}

function eventSummary(event: { id: string; type: string }) {
  return { id: event.id, type: event.type };
}

async function visibleAbilityOrNotFound(id: string) {
  const ability = await prisma.ability.findUnique({ where: { id } });
  if (ability === null) return null;
  const projection = projectAbilityForPlayer(normalizePersistedAbility(ability));
  return projection === null ? null : { ability, projection };
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && (
    ("code" in error && error.code === "P2034") ||
    ("message" in error && typeof error.message === "string" && /could not serialize/i.test(error.message))
  );
}

async function deleteAbilityInSerializableTransaction(
  client: DeleteAbilityClient,
  id: string,
  expectedVersion: number,
  event: z.infer<typeof EventSchema> | undefined,
) {
  const attempt = async () => client.$transaction(async (tx) => {
    const stored = await tx.ability.findUnique({ where: { id } });
    if (stored === null) {
      throw new AbilityOptimisticConflictError("能力已被删除，请刷新后重试");
    }
    if (stored.version !== expectedVersion) {
      throw new AbilityOptimisticConflictError("能力已被其他变更更新，请刷新后重试");
    }

    const [eventCount, descendant] = await Promise.all([
      tx.abilityEvent.count({ where: { abilityId: id } }),
      (tx.ability as unknown as {
        findFirst(args: { where: { sourceAbilityId: string } }): Promise<{ id: string } | null>;
      }).findFirst({ where: { sourceAbilityId: id } }),
    ]);

    try {
      // Keep the descendant query in the serializable transaction, then lock
      // the source row before the delete/deprecate decision is materialized.
      const locked = await tx.ability.updateMany({
        where: { id, version: expectedVersion },
        data: { version: { increment: 0 } },
      });
      if (locked.count !== 1) {
        throw new AbilityOptimisticConflictError("能力已被其他变更更新，请刷新后重试");
      }
    } catch (error) {
      if (isSerializationConflict(error)) {
        throw error;
      }
      throw new AbilityOptimisticConflictError("能力已被其他变更更新，请刷新后重试");
    }

    if (eventCount === 0 && descendant === null) {
      const deleted = await tx.ability.deleteMany({
        where: { id, version: expectedVersion },
      });
      if (deleted.count !== 1) {
        throw new AbilityOptimisticConflictError("能力已被其他变更更新，请刷新后重试");
      }
      return { deleted: true as const, deprecated: false as const };
    }

    if (event === undefined) {
      throw new AbilityDeleteRequestError("废弃有沿革或派生能力的能力必须提供事件证据");
    }

    const result = await applyAbilityChangeInTransaction(tx, {
      abilityId: id,
      version: expectedVersion,
      patch: { state: "deprecated" },
      event: { ...event, type: "deprecated" },
    });
    return { deleted: false as const, deprecated: true as const, result };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  for (let retry = 0; retry < 3; retry += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isSerializationConflict(error) || retry === 2) {
        if (isSerializationConflict(error)) {
          throw new AbilityOptimisticConflictError("能力并发变更冲突，请刷新后重试");
        }
        throw error;
      }
    }
  }

  throw new AbilityOptimisticConflictError("能力并发变更冲突，请刷新后重试");
}

/** PATCH /api/abilities/[id] —— 乐观锁下的能力更新与沿革记录。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = PatchSchema.parse(await request.json());
    const visible = await visibleAbilityOrNotFound(id);
    if (visible === null) {
      return NextResponse.json({ error: "能力不存在" }, { status: 404 });
    }

    const result = await applyAbilityChange(prisma as unknown as AbilityMutationClient, {
      abilityId: id,
      version: body.expectedVersion,
      patch: body.patch,
      event: body.event,
    });
    const ability = result.ability === undefined
      ? visible.projection
      : projectAbilityForPlayer(result.ability);

    return NextResponse.json({
      applied: result.applied,
      ability,
      event: ability === null ? null : eventSummary(result.event),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/abilities/[id] —— 无沿革且无派生引用时物理删除，否则原子废弃并保留史料。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = DeleteSchema.parse(await request.json());
    const visible = await visibleAbilityOrNotFound(id);
    if (visible === null) {
      return NextResponse.json({ error: "能力不存在" }, { status: 404 });
    }

    const outcome = await deleteAbilityInSerializableTransaction(
      prisma as unknown as DeleteAbilityClient,
      id,
      body.expectedVersion,
      body.event,
    );
    if (outcome.deleted) {
      return NextResponse.json(outcome);
    }

    const ability = outcome.result.ability === undefined
      ? visible.projection
      : projectAbilityForPlayer(outcome.result.ability);
    return NextResponse.json({
      deleted: false,
      deprecated: true,
      applied: outcome.result.applied,
      ability,
      event: ability === null ? null : eventSummary(outcome.result.event),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
