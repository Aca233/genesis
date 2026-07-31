import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    chapter: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  claimWorldOperation: vi.fn(),
  releaseWorldOperation: vi.fn(),
  settleChapter: vi.fn(),
  ensureSettlementRunning: vi.fn(),
  createSettlementTaskSSE: vi.fn(),
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/reality/operation-lock", () => ({
  claimWorldOperation: mocks.claimWorldOperation,
  releaseWorldOperation: mocks.releaseWorldOperation,
  WorldOperationConflictError: class WorldOperationConflictError extends Error {
    constructor(activeKind: string) {
      super(`世界正在进行${activeKind === "chat" ? "叙事生成" : activeKind}，请稍后再试`);
    }
  },
}));
vi.mock("@/lib/settle/pipeline", () => ({ settleChapter: mocks.settleChapter }));
vi.mock("@/lib/settle/task-runner", () => ({
  ensureSettlementRunning: mocks.ensureSettlementRunning,
  createSettlementTaskSSE: mocks.createSettlementTaskSSE,
}));
vi.mock("@/lib/auth/session", () => ({ requireUserId: mocks.requireUserId }));

import { POST } from "./route";

describe("POST /api/chapters/[id]/settle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.chapter.findFirst.mockImplementation(async ({ where }: { where: { id?: string; timelineId_index?: unknown } }) => {
      if (where.id === "chapter-1") return {
        id: "chapter-1",
        index: 1,
        timelineId: "timeline-1",
        timeline: {
          id: "timeline-1",
          worldId: "world-1",
          world: { activeTimelineId: "timeline-1" },
        },
        messages: [{ id: "message-1" }],
        settleState: "open",
        settleError: null,
        settleRetryable: true,
        settleUpdatedAt: new Date("2026-07-23T00:00:00.000Z"),
        title: null,
        summary: null,
      };
      return null;
    });
    mocks.prisma.chapter.findUnique.mockImplementation(mocks.prisma.chapter.findFirst);
    mocks.claimWorldOperation.mockResolvedValue({ acquired: true });
    mocks.releaseWorldOperation.mockResolvedValue(true);
    mocks.prisma.chapter.update.mockResolvedValue({});
    mocks.ensureSettlementRunning.mockResolvedValue(undefined);
    mocks.createSettlementTaskSSE.mockImplementation(() => new Response("settlement stream", {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    }));
    mocks.settleChapter.mockImplementation(async function* () {
      yield { step: "done" };
    });
  });

  it("returns HTTP 409 with the Chinese active kind before opening SSE", async () => {
    mocks.claimWorldOperation.mockResolvedValue({ acquired: false, activeKind: "chat" });

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界正在进行叙事生成，请稍后再试" });
    expect(mocks.settleChapter).not.toHaveBeenCalled();
  });

  it("preserves the active-reality freeze guard before claiming a lease", async () => {
    mocks.prisma.chapter.findFirst.mockResolvedValue({
      id: "chapter-1", index: 1, timelineId: "timeline-old",
      timeline: { id: "timeline-old", worldId: "world-1", world: { activeTimelineId: "timeline-new" } },
      messages: [{ id: "message-1" }],
    });

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "该现实已被冻结" });
    expect(mocks.claimWorldOperation).not.toHaveBeenCalled();
  });

  it("claims once and hands the owned token to the settlement runner", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "chapter-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.claimWorldOperation).toHaveBeenCalledTimes(1);
    expect(mocks.claimWorldOperation).toHaveBeenCalledWith(
      mocks.prisma,
      "world-1",
      "settlement",
      "chapter-1",
    );
    expect(mocks.ensureSettlementRunning).toHaveBeenCalledWith(
      "chapter-1",
      expect.any(Function),
    );
    expect(mocks.createSettlementTaskSSE).toHaveBeenCalledWith(
      "chapter-1",
      expect.any(Array),
    );
    const run = mocks.ensureSettlementRunning.mock.calls[0][1];
    const emit = vi.fn();
    await run(emit);
    expect(mocks.prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: "chapter-1" },
      data: {
        settleError: null,
        settleRetryable: true,
        settleUpdatedAt: expect.any(Date),
      },
    });
    expect(mocks.settleChapter).toHaveBeenCalledWith("chapter-1", {
      worldId: "world-1",
      token: "chapter-1",
      claimed: true,
      userId: "test-user",
    });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "progress",
      taskKind: "settlement",
      stage: "completed",
      status: "completed",
    }));
    expect(mocks.releaseWorldOperation).toHaveBeenCalledWith(
      mocks.prisma,
      "world-1",
      "settlement",
      "chapter-1",
    );
  });
});
