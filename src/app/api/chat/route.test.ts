import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  OpeningGenerationConflictError: class OpeningGenerationConflictError extends Error {},
  FrozenRealityError: class FrozenRealityError extends Error {},
  prisma: {
    chapter: { findUnique: vi.fn() },
    world: { findUnique: vi.fn() },
    message: { create: vi.fn() },
  },
  buildNarratorContext: vi.fn(),
  narratorSSE: vi.fn(),
  narratorCompletionSSE: vi.fn(),
  finalizeNarration: vi.fn(),
  prepareGenerationRequest: vi.fn(),
  readGenerationCompletion: vi.fn(),
  markGenerationFailed: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/context/builder", () => ({
  buildNarratorContext: mocks.buildNarratorContext,
}));
vi.mock("@/lib/context/sse", () => ({
  narratorSSE: mocks.narratorSSE,
  narratorCompletionSSE: mocks.narratorCompletionSSE,
}));
vi.mock("@/lib/chat/finalize", () => ({
  finalizeNarration: mocks.finalizeNarration,
}));
vi.mock("@/lib/chat/request", () => ({
  prepareGenerationRequest: mocks.prepareGenerationRequest,
  readGenerationCompletion: mocks.readGenerationCompletion,
  markGenerationFailed: mocks.markGenerationFailed,
  OpeningGenerationConflictError: mocks.OpeningGenerationConflictError,
  FrozenRealityError: mocks.FrozenRealityError,
}));

import { POST } from "./route";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.chapter.findUnique.mockResolvedValue({
      id: "chapter-1",
      index: 2,
      settleState: "open",
      timeline: { id: "timeline-1", worldId: "world-1", world: { activeTimelineId: "timeline-1" } },
      messages: [{ index: 3 }],
    });
    mocks.buildNarratorContext.mockResolvedValue([{ role: "user", content: "继续" }]);
    mocks.narratorSSE.mockImplementation((options) => new Response(JSON.stringify({ options })));
    mocks.narratorCompletionSSE.mockImplementation(() => new Response("sse replay", {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    }));
    mocks.finalizeNarration.mockResolvedValue({ messageId: "generation-1", reused: false });
    mocks.prepareGenerationRequest.mockResolvedValue({
      state: "owner",
      attempt: 1,
      meta: {
        type: "chat-generation-request",
        chapterId: "chapter-1",
        mode: "continue",
        scale: "scene",
        content: null,
        directive: null,
        playerMessageId: null,
        narratorMessageId: "generation-1",
        playerIndex: null,
        narratorIndex: 4,
      },
    });
  });

  it("completed generation 重试仍返回含已有 messageId/meta 的 SSE done", async () => {
    const completion = {
      messageId: "generation-1",
      meta: { suggestions: ["继续观察"], chapterBreakHint: false },
    };
    mocks.prepareGenerationRequest.mockResolvedValue({
      state: "completed",
      meta: expect.anything(),
      completion,
    });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-1",
        scale: "scene",
        mode: "continue",
        generationId: "generation-1",
      }),
    });

    const response = await POST(request);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(mocks.narratorCompletionSSE).toHaveBeenCalledWith(expect.objectContaining({
      completion,
      signal: request.signal,
    }));
    expect(mocks.buildNarratorContext).not.toHaveBeenCalled();
    expect(mocks.narratorSSE).not.toHaveBeenCalled();
  });

  it("opening 已产生消息后仍可按 generationId 重放完成 SSE", async () => {
    const completion = {
      messageId: "opening-generation",
      meta: { suggestions: [], chapterBreakHint: false },
    };
    mocks.prepareGenerationRequest.mockResolvedValue({
      state: "completed",
      meta: {},
      completion,
    });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-1",
        scale: "scene",
        mode: "opening",
        generationId: "opening-generation",
      }),
    });

    await POST(request);

    expect(mocks.prepareGenerationRequest).toHaveBeenCalled();
    expect(mocks.narratorCompletionSSE).toHaveBeenCalledWith({
      completion,
      signal: request.signal,
    });
  });

  it("首次 opening 已有消息的 typed conflict 映射为 409", async () => {
    mocks.prepareGenerationRequest.mockRejectedValue(
      new mocks.OpeningGenerationConflictError("本章已有开场，不可重复演出"),
    );
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-1",
        scale: "scene",
        mode: "opening",
        generationId: "opening-new-id",
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "本章已有开场，不可重复演出" });
  });

  it("pending generation loser 不调用 LLM，并以 SSE 等待 durable 完成结果", async () => {
    mocks.prepareGenerationRequest.mockResolvedValue({
      state: "pending",
      meta: {
        type: "chat-generation-request",
        chapterId: "chapter-1",
        mode: "continue",
        scale: "scene",
        content: null,
        directive: null,
        playerMessageId: null,
        narratorMessageId: "generation-1",
        playerIndex: null,
        narratorIndex: 4,
      },
    });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-1",
        scale: "scene",
        mode: "continue",
        generationId: "generation-1",
      }),
    });

    await POST(request);

    expect(mocks.narratorCompletionSSE).toHaveBeenCalledWith(expect.objectContaining({
      waitForCompletion: expect.any(Function),
      signal: request.signal,
    }));
    expect(mocks.buildNarratorContext).not.toHaveBeenCalled();
    expect(mocks.narratorSSE).not.toHaveBeenCalled();
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
      onFailure: expect.any(Function),
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
    const [{ onFailure }] = mocks.narratorSSE.mock.calls[0];
    await onFailure(new Error("upstream cancelled"));
    expect(mocks.markGenerationFailed).toHaveBeenCalledWith(
      mocks.prisma,
      "generation-1",
      1,
      expect.any(Error),
    );
  });

  it("owner 在流建立前失败也标记当前 attempt failed", async () => {
    mocks.buildNarratorContext.mockRejectedValue(new Error("context unavailable"));
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-1",
        scale: "scene",
        mode: "continue",
        generationId: "generation-1",
      }),
    });

    await expect(POST(request)).rejects.toThrow("context unavailable");

    expect(mocks.markGenerationFailed).toHaveBeenCalledWith(
      mocks.prisma,
      "generation-1",
      1,
      expect.objectContaining({ message: "context unavailable" }),
    );
  });
  it("rejects a frozen branch before generation reservation", async () => {
    mocks.prisma.chapter.findUnique.mockResolvedValue({
      id: "chapter-frozen", index: 2, settleState: "open",
      timeline: { id: "timeline-old", worldId: "world-1", world: { activeTimelineId: "timeline-new" } },
      messages: [],
    });
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-frozen", scale: "scene", mode: "continue",
        generationId: "generation-frozen",
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "该现实已被冻结" });
    expect(mocks.prepareGenerationRequest).not.toHaveBeenCalled();
  });

  it("returns 409 when the reality freezes while building narration context", async () => {
    mocks.buildNarratorContext.mockRejectedValue(new mocks.FrozenRealityError("该现实已被冻结"));

    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-1", scale: "scene", mode: "continue",
        generationId: "generation-frozen-late",
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "该现实已被冻结" });
    expect(mocks.markGenerationFailed).toHaveBeenCalled();
  });

  it("passes the expected active timeline into finalization so late replies cannot write", async () => {
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chapterId: "chapter-1", scale: "scene", mode: "continue",
        generationId: "generation-1",
      }),
    });
    await POST(request);
    const [{ onDone }] = mocks.narratorSSE.mock.calls[0];
    await onDone({ prose: "正文", meta: { suggestions: [], chapterBreakHint: false } });

    expect(mocks.finalizeNarration).toHaveBeenCalledWith(mocks.prisma, expect.objectContaining({
      worldId: "world-1",
      expectedActiveTimelineId: "timeline-1",
    }));
  });

});
