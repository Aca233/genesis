import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messageFindUnique: vi.fn(),
  messageUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    message: {
      findUnique: mocks.messageFindUnique,
      update: mocks.messageUpdate,
    },
  },
}));

vi.mock("@/lib/context/builder", () => ({
  buildNarratorContext: vi.fn(),
}));

vi.mock("@/lib/context/sse", () => ({
  narratorSSE: vi.fn(),
}));

import { PATCH, POST } from "./route";

const context = { params: Promise.resolve({ id: "message-1" }) };

function messageIn(
  settleState: string,
  timelineId = "timeline-1",
  activeTimelineId: string | null = "timeline-1",
) {
  return {
    id: "message-1",
    chapterId: "segment-1",
    index: 1,
    role: "narrator",
    content: "潮声涌来。",
    scale: "scene",
    meta: null,
    variants: [{ content: "旧异文", chosen: true }],
    chapter: {
      settleState,
      timeline: {
        id: timelineId,
        worldId: "world-1",
        world: { activeTimelineId },
      },
    },
  };
}

describe("message variants edit boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["settled", "timeline-1", "timeline-1"],
    ["settling:extract", "timeline-1", "timeline-1"],
    ["open", "timeline-old", "timeline-1"],
  ])("POST 拒绝不可编辑状态 %s/%s", async (settleState, timelineId, activeTimelineId) => {
    mocks.messageFindUnique.mockResolvedValue(messageIn(
      settleState,
      timelineId,
      activeTimelineId,
    ));

    const response = await POST(
      new Request("http://localhost/api/messages/message-1/variants", {
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["settled", "timeline-1", "timeline-1"],
    ["settling:apply", "timeline-1", "timeline-1"],
    ["open", "timeline-old", "timeline-1"],
  ])("PATCH 拒绝不可编辑状态 %s/%s", async (settleState, timelineId, activeTimelineId) => {
    mocks.messageFindUnique.mockResolvedValue(messageIn(
      settleState,
      timelineId,
      activeTimelineId,
    ));

    const response = await PATCH(
      new Request("http://localhost/api/messages/message-1/variants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: 0 }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
  });
});
