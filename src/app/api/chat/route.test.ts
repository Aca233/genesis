import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    chapter: { findUnique: vi.fn() },
    message: { create: vi.fn() },
  },
  buildNarratorContext: vi.fn(),
  narratorSSE: vi.fn(),
  finalizeNarration: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/context/builder", () => ({
  buildNarratorContext: mocks.buildNarratorContext,
}));
vi.mock("@/lib/context/sse", () => ({ narratorSSE: mocks.narratorSSE }));
vi.mock("@/lib/chat/finalize", () => ({
  finalizeNarration: mocks.finalizeNarration,
}));

import { POST } from "./route";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.chapter.findUnique.mockResolvedValue({
      id: "chapter-1",
      index: 2,
      settleState: "open",
      timeline: { id: "timeline-1", worldId: "world-1" },
      messages: [{ index: 3 }],
    });
    mocks.buildNarratorContext.mockResolvedValue([{ role: "user", content: "继续" }]);
    mocks.narratorSSE.mockImplementation((options) => new Response(JSON.stringify({ options })));
    mocks.finalizeNarration.mockResolvedValue({ messageId: "generation-1", reused: false });
  });

  it("将稳定 generationId 与 request.signal 传入可取消、事务化完成链路", async () => {
    const abort = new AbortController();
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      signal: abort.signal,
      body: JSON.stringify({
        chapterId: "chapter-1",
        scale: "scene",
        mode: "continue",
        generationId: "generation-1",
      }),
    });

    await POST(request);

    expect(mocks.narratorSSE).toHaveBeenCalledWith(expect.objectContaining({
      signal: request.signal,
      onDone: expect.any(Function),
    }));
    const [{ onDone }] = mocks.narratorSSE.mock.calls[0];
    await onDone({ prose: "正文", meta: { suggestions: [], chapterBreakHint: false } });
    expect(mocks.finalizeNarration).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        generationId: "generation-1",
        narratorIndex: 4,
        prose: "正文",
      }),
    );
  });
});
