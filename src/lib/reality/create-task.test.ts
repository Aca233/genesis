import { describe, expect, it, vi } from "vitest";
import {
  createRealityRewriteInTransaction,
  RealityRewriteTaskConflictError,
} from "./create-task";

const input = {
  worldId: "world-1",
  sourceTimelineId: "timeline-1",
  sourceChapterId: "segment-1",
  decree: "让旧王从未登基",
  scope: "retroactive" as const,
  idempotencyKey: "chat:generation-1",
};

describe("createRealityRewriteInTransaction", () => {
  it("创建固定来源的追溯任务", async () => {
    const created = { id: "rewrite-1", ...input, status: "planning" };
    const tx = {
      realityRewrite: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
    };

    await expect(createRealityRewriteInTransaction(tx as never, input))
      .resolves.toEqual({ task: created, replayed: false });
  });

  it("相同幂等请求复用，不同语义拒绝", async () => {
    const existing = { id: "rewrite-1", ...input, status: "planning" };
    const tx = {
      realityRewrite: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    };
    await expect(createRealityRewriteInTransaction(tx as never, input))
      .resolves.toMatchObject({ replayed: true });
    await expect(createRealityRewriteInTransaction(tx as never, {
      ...input,
      decree: "另一道命令",
    })).rejects.toBeInstanceOf(RealityRewriteTaskConflictError);
  });
});

