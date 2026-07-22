export const OPERATION_LEASE_MS = 5 * 60 * 1000;
export const OPERATION_LEASE_RENEW_MS = OPERATION_LEASE_MS / 3;

export type WorldOperationKind = "chat" | "settlement" | "rewrite" | "switch";

const OPERATION_LABELS: Record<WorldOperationKind, string> = {
  chat: "叙事生成",
  settlement: "章节结算",
  rewrite: "现实改写",
  switch: "现实切换",
};

type OperationLease = {
  operationKind: string | null;
  operationToken: string | null;
  operationLeaseExpiresAt: Date | null;
};

export type WorldOperationClient = {
  world: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: {
        operationKind: true;
        operationToken: true;
        operationLeaseExpiresAt: true;
      };
    }): Promise<OperationLease | null>;
  };
};

export type WorldOperationClaim =
  | { acquired: true }
  | { acquired: false; activeKind: WorldOperationKind };

export class WorldOperationConflictError extends Error {
  readonly activeKind: WorldOperationKind;

  constructor(activeKind: WorldOperationKind) {
    super(`世界正在进行${OPERATION_LABELS[activeKind]}，请稍后再试`);
    this.name = "WorldOperationConflictError";
    this.activeKind = activeKind;
  }
}

function operationKind(value: string | null): WorldOperationKind {
  return value === "chat" || value === "settlement" || value === "rewrite" || value === "switch"
    ? value
    : "switch";
}

async function readLease(db: WorldOperationClient, worldId: string): Promise<OperationLease | null> {
  return db.world.findUnique({
    where: { id: worldId },
    select: {
      operationKind: true,
      operationToken: true,
      operationLeaseExpiresAt: true,
    },
  });
}

export async function claimWorldOperation(
  db: WorldOperationClient,
  worldId: string,
  kind: WorldOperationKind,
  token: string,
  now = new Date(),
): Promise<WorldOperationClaim> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acquired = await db.world.updateMany({
      where: {
        id: worldId,
        OR: [
          { operationLeaseExpiresAt: null },
          { operationLeaseExpiresAt: { lte: now } },
          { operationKind: kind, operationToken: token },
        ],
      },
      data: {
        operationKind: kind,
        operationToken: token,
        operationLeaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS),
      },
    });
    if (acquired.count === 1) return { acquired: true };

    const active = await readLease(db, worldId);
    if (active?.operationLeaseExpiresAt && active.operationLeaseExpiresAt > now) {
      return { acquired: false, activeKind: operationKind(active.operationKind) };
    }
  }

  const active = await readLease(db, worldId);
  return { acquired: false, activeKind: operationKind(active?.operationKind ?? null) };
}

export async function renewWorldOperation(
  db: WorldOperationClient,
  worldId: string,
  kind: WorldOperationKind,
  token: string,
  now = new Date(),
): Promise<boolean> {
  const renewed = await db.world.updateMany({
    where: { id: worldId, operationKind: kind, operationToken: token },
    data: { operationLeaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS) },
  });
  return renewed.count === 1;
}

export async function releaseWorldOperation(
  db: WorldOperationClient,
  worldId: string,
  kind: WorldOperationKind,
  token: string,
): Promise<boolean> {
  const released = await db.world.updateMany({
    where: { id: worldId, operationKind: kind, operationToken: token },
    data: {
      operationKind: null,
      operationToken: null,
      operationLeaseExpiresAt: null,
    },
  });
  return released.count === 1;
}

export async function assertNoLiveWorldOperation(
  db: WorldOperationClient,
  worldId: string,
  now = new Date(),
): Promise<void> {
  const active = await readLease(db, worldId);
  if (active?.operationLeaseExpiresAt && active.operationLeaseExpiresAt > now) {
    throw new WorldOperationConflictError(operationKind(active.operationKind));
  }
}
