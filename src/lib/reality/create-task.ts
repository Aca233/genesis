import type { Prisma, RealityRewrite } from "@prisma/client";
import type { RewriteScope } from "./schemas";

export type CreateRealityRewriteTaskInput = {
  worldId: string;
  sourceTimelineId: string;
  sourceChapterId: string;
  decree: string;
  scope: RewriteScope;
  idempotencyKey: string;
};

export class RealityRewriteTaskConflictError extends Error {
  constructor(message = "幂等键已用于另一项现实改写") {
    super(message);
    this.name = "RealityRewriteTaskConflictError";
  }
}

export async function createRealityRewriteInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateRealityRewriteTaskInput,
): Promise<{ task: RealityRewrite; replayed: boolean }> {
  const existing = await tx.realityRewrite.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (
      existing.worldId !== input.worldId
      || existing.sourceTimelineId !== input.sourceTimelineId
      || existing.sourceChapterId !== input.sourceChapterId
      || existing.decree !== input.decree
      || existing.scope !== input.scope
    ) {
      throw new RealityRewriteTaskConflictError();
    }
    return { task: existing, replayed: true };
  }
  const task = await tx.realityRewrite.create({
    data: {
      ...input,
      status: "planning",
    },
  });
  return { task, replayed: false };
}

