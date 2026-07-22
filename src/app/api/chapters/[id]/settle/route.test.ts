import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    chapter: { findUnique: vi.fn() },
  },
  claimWorldOperation: vi.fn(),
  settleChapter: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/reality/operation-lock", () => ({
  claimWorldOperation: mocks.claimWorldOperation,
  WorldOperationConflictError: class WorldOperationConflictError extends Error {
    constructor(activeKind: string) {
      super(`世界正在进行${activeKind === "chat" ? "叙事生成" : activeKind}，请稍后再试`);
    }
  },
}));
vi.mock("@/lib/settle/pipeline", () => ({ settleChapter: mocks.settleChapter }));

import { POST } from "./route";

describe("POST /api/chapters/[id]/settle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.chapter.findUnique.mockImplementation(async ({ where }: { where: { id?: string; timelineId_index?: unknown } }) => {
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
        title: null,
        summary: null,
      };
      return null;
    });
    mocks.claimWorldOperation.mockResolvedValue({ acquired: true });
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
    mocks.prisma.chapter.findUnique.mockResolvedValue({
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
    await response.text();

    expect(mocks.claimWorldOperation).toHaveBeenCalledTimes(1);
    expect(mocks.claimWorldOperation).toHaveBeenCalledWith(
      mocks.prisma,
      "world-1",
      "settlement",
      expect.any(String),
    );
    const token = mocks.claimWorldOperation.mock.calls[0][3];
    expect(mocks.settleChapter).toHaveBeenCalledWith("chapter-1", {
      worldId: "world-1",
      token,
      claimed: true,
    });
  });
});
