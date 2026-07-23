import { describe, expect, it, vi } from "vitest";
import {
  createCreatorInputState,
  submitCreatorInput,
  type CreatorInputDependencies,
  type RealityRewriteView,
} from "./creator-input-state";

function dependencies(overrides: Partial<CreatorInputDependencies> = {}): CreatorInputDependencies {
  return {
    createIdempotencyKey: () => "rewrite-key-12345678",
    observe: vi.fn(async () => undefined),
    createRewrite: vi.fn(async () => ({ taskId: "rewrite-1" })),
    followRewrite: vi.fn(async () => ({
      id: "rewrite-1",
      sourceTimelineId: "timeline-1",
      decree: "令群星倒悬",
      scope: "retroactive",
      status: "completed",
      interpretation: "星轨从来如此。",
      branchName: "倒悬星河",
      summary: "群星倒悬。",
      resultTimelineId: "timeline-2",
      error: null,
    } satisfies RealityRewriteView)),
    refreshState: vi.fn(async () => undefined),
    refreshEntityIndex: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("creator input state", () => {
  it("reuses a rewrite draft key after an unacknowledged POST and replaces it when the decree changes", async () => {
    const createIdempotencyKey = vi.fn()
      .mockReturnValueOnce("rewrite-key-first")
      .mockReturnValueOnce("rewrite-key-second");
    const createRewrite = vi.fn(async (
      request: Parameters<CreatorInputDependencies["createRewrite"]>[0],
    ) => {
      void request;
      throw new Error("响应遗失");
    });
    const deps = dependencies({ createIdempotencyKey, createRewrite });
    const draft = {
      ...createCreatorInputState(),
      channel: "rewrite" as const,
      scope: "retroactive" as const,
      text: "令群星倒悬",
    };

    const first = await submitCreatorInput(draft, deps);
    const retry = await submitCreatorInput(first, deps);
    const changed = await submitCreatorInput({ ...retry, text: "令赤月永悬" }, deps);

    expect(createRewrite.mock.calls.map(([request]) => request.idempotencyKey)).toEqual([
      "rewrite-key-first",
      "rewrite-key-first",
      "rewrite-key-second",
    ]);
    expect(first).toMatchObject({ text: "令群星倒悬", idempotencyKey: "rewrite-key-first" });
    expect(retry).toMatchObject({ text: "令群星倒悬", idempotencyKey: "rewrite-key-first" });
    expect(changed).toMatchObject({ text: "令赤月永悬", idempotencyKey: "rewrite-key-second" });
  });
  it("observation submission calls chat and never creates a rewrite", async () => {
    const deps = dependencies();
    const state = { ...createCreatorInputState(), channel: "observe" as const, text: "看看北境" };

    const result = await submitCreatorInput(state, deps);

    expect(deps.observe).toHaveBeenCalledWith("看看北境");
    expect(deps.createRewrite).not.toHaveBeenCalled();
    expect(result.text).toBe("");
    expect(result.error).toBeNull();
  });

  it("rewrite submission creates an idempotency key and retains decree when task creation fails", async () => {
    const createRewrite = vi.fn(async () => {
      throw new Error("天幕暂不可改写");
    });
    const deps = dependencies({ createRewrite });
    const state = {
      ...createCreatorInputState(),
      channel: "rewrite" as const,
      scope: "memory_only" as const,
      text: "令旧王忘却盟约",
    };

    const result = await submitCreatorInput(state, deps);

    expect(createRewrite).toHaveBeenCalledWith({
      decree: "令旧王忘却盟约",
      scope: "memory_only",
      idempotencyKey: "rewrite-key-12345678",
    });
    expect(result.text).toBe("令旧王忘却盟约");
    expect(result.error).toBe("天幕暂不可改写");
  });

  it("clears an accepted decree, follows SSE, refreshes all state and exposes the completed decree card", async () => {
    const deps = dependencies();
    const state = {
      ...createCreatorInputState(),
      channel: "rewrite" as const,
      scope: "retroactive" as const,
      text: "令群星倒悬",
    };

    const result = await submitCreatorInput(state, deps);

    expect(deps.followRewrite).toHaveBeenCalledWith("rewrite-1", expect.any(Function));
    expect(deps.refreshState).toHaveBeenCalledWith(expect.objectContaining({
      id: "rewrite-1",
      interpretation: "星轨从来如此。",
      branchName: "倒悬星河",
      resultTimelineId: "timeline-2",
      sourceTimelineId: "timeline-1",
    }));
    expect(deps.refreshEntityIndex).toHaveBeenCalledOnce();
    expect(result.text).toBe("");
    expect(result.completedRewrite).toMatchObject({
      decree: "令群星倒悬",
      interpretation: "星轨从来如此。",
      scope: "retroactive",
      branchName: "倒悬星河",
      resultTimelineId: "timeline-2",
    });
  });
});

it("keeps the avatar draft open when creation fails and resets it only after success", async () => {
  const { finishAvatarCreation } = await import("./CreatorViewPanel");
  const reset = vi.fn();

  await expect(finishAvatarCreation(async () => false, reset)).resolves.toBe(false);
  expect(reset).not.toHaveBeenCalled();

  await expect(finishAvatarCreation(async () => true, reset)).resolves.toBe(true);
  expect(reset).toHaveBeenCalledOnce();
});

it("follows named rewrite SSE stages through completion", async () => {
  const encoder = new TextEncoder();
  const completed: RealityRewriteView = {
    id: "rewrite-1",
    decree: "令群星倒悬",
    scope: "retroactive",
    status: "completed",
    interpretation: "星轨从来如此。",
    branchName: "倒悬星河",
    summary: "群星倒悬。",
    resultTimelineId: "timeline-2",
    error: null,
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('event: planning\ndata: {"stage":"planning","task":null}\n\n'));
      controller.enqueue(encoder.encode(`event: completed\ndata: ${JSON.stringify({ stage: "completed", task: completed })}\n\n`));
      controller.close();
    },
  });
  const fetcher = vi.fn(async () => new Response(stream, { status: 200 }));
  const stages: string[] = [];
  const { followRealityRewriteEvents } = await import("./creator-input-state");

  await expect(followRealityRewriteEvents("rewrite-1", (stage) => stages.push(stage), fetcher))
    .resolves.toEqual(completed);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/rewrites/rewrite-1/events",
    expect.objectContaining({ headers: { Accept: "text/event-stream" } }),
  );
  expect(stages).toEqual(["planning", "completed"]);
});

it("renders creator observation controls without a player-god identity", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { CreatorViewPanel } = await import("./CreatorViewPanel");
  const html = renderToStaticMarkup(
    createElement(CreatorViewPanel, {
      worldId: "world-1",
      timeline: {
        id: "timeline-1",
        branchName: "原初现实",
        branchSummary: null,
        observerState: {
          focusType: "world",
          focusId: null,
          timeLabel: "创世初年",
          viewpoint: "omniscient",
          activeAvatarId: null,
        },
      },
      gods: [],
      avatars: [],
      recentRewrite: null,
      busy: false,
      onChanged: async () => undefined,
    }),
  );
  expect(html).toContain("天外视界");
  expect(html).toContain("全知观察");
  expect(html).toContain("创造化身");
  expect(html).not.toContain("本尊神格");
});

it("renders a busy-disabled return-to-source-reality action with matching semantics", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MessageBlock } = await import("./MessageBlock");
  const message = {
    id: "message-return",
    chapterId: "chapter-1",
    index: 0,
    role: "narrator" as const,
    content: "新现实已定。",
    scale: "epoch",
    variants: null,
    meta: {
      kind: "reality_rewrite_result",
      realityRewriteId: "rewrite-1",
      decree: "令群星倒悬",
      scope: "retroactive",
      sourceTimelineId: "timeline-1",
    },
    createdAt: "2026-07-22T00:00:00.000Z",
  };

  const ready = renderToStaticMarkup(createElement(MessageBlock, { message, busy: false }));
  const busy = renderToStaticMarkup(createElement(MessageBlock, { message, busy: true }));
  expect(ready).toContain("⌘ 现实已分叉");
  expect(ready).not.toContain("返回前现实");
  expect(busy).toContain("⌘ 现实已分叉");
  expect(busy).toContain("disabled");
});

it("enriches persisted rewrite-result messages with decree-card context after refresh", async () => {
  const { enrichRewriteResultMessages } = await import("./creator-input-state");
  const messages = [{
    id: "message-1",
    chapterId: "chapter-1",
    index: 0,
    role: "narrator" as const,
    content: "群星自古倒悬。",
    scale: "epoch",
    variants: null,
    meta: { kind: "reality_rewrite_result", realityRewriteId: "rewrite-1", decree: "令群星倒悬", scope: "retroactive" },
    createdAt: "2026-07-22T00:00:00.000Z",
  }];

  expect(enrichRewriteResultMessages(messages, {
    id: "rewrite-1",
    decree: "令群星倒悬",
    scope: "retroactive",
    status: "completed",
    interpretation: "星轨从来如此。",
    branchName: "倒悬星河",
    summary: "群星倒悬。",
    sourceTimelineId: "timeline-1",
    resultTimelineId: "timeline-2",
    error: null,
  })).toEqual([expect.objectContaining({
    meta: expect.objectContaining({
      interpretation: "星轨从来如此。",
      branchName: "倒悬星河",
      sourceTimelineId: "timeline-1",
      summary: "群星倒悬。",
    }),
  })]);
});
