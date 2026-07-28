import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    world: { findUnique: vi.fn() },
    timeline: { findUnique: vi.fn(), update: vi.fn() },
    worldEvent: { findUnique: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: { world: { findFirst: vi.fn().mockResolvedValue({ id: "world-1" }) }, $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-user") }));

import { DELETE, PUT } from "./route";

const context = (eventId: string) => ({
  params: Promise.resolve({ id: "world-1", eventId }),
});

const observerState = (focusedEventId: string | null = null) => ({
  focusType: "world" as const,
  focusId: null,
  timeLabel: "星海元年",
  viewpoint: "omniscient" as const,
  activeAvatarId: null,
  focusedEventId,
});

describe("PUT/DELETE /api/worlds/[id]/events/[eventId]/focus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.world.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      activeTimelineId: "timeline-active",
    });
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: observerState(),
    });
    mocks.tx.timeline.update.mockResolvedValue({ id: "timeline-active" });
    mocks.tx.worldEvent.findUnique.mockResolvedValue({
      id: "event-a",
      timelineId: "timeline-active",
      phase: "developing",
      resolvedAt: null,
      visibility: "public",
    });
  });

  it("focuses an unresolved event on the active timeline", async () => {
    const response = await PUT(
      new Request("http://localhost/api/worlds/world-1/events/event-a/focus", { method: "PUT" }),
      context("event-a"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ focusedEventId: "event-a" });
    expect(mocks.tx.timeline.update).toHaveBeenCalledWith({
      where: { id: "timeline-active" },
      data: {
        observerState: {
          ...observerState(),
          focusedEventId: "event-a",
        },
      },
    });
  });

  it("atomically replaces the previously focused event", async () => {
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: observerState("event-old"),
    });
    mocks.tx.worldEvent.findUnique.mockResolvedValue({
      id: "event-new",
      timelineId: "timeline-active",
      phase: "escalating",
      resolvedAt: null,
      visibility: "public",
    });

    const response = await PUT(
      new Request("http://localhost/api/worlds/world-1/events/event-new/focus", { method: "PUT" }),
      context("event-new"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ focusedEventId: "event-new" });
    expect(mocks.tx.timeline.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.timeline.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { observerState: expect.objectContaining({ focusedEventId: "event-new" }) },
    }));
  });

  it.each([
    ["event-old-reality", {
      id: "event-old-reality",
      timelineId: "timeline-frozen",
      phase: "developing",
      resolvedAt: null,
      visibility: "public",
    }],
    ["event-resolved", {
      id: "event-resolved",
      timelineId: "timeline-active",
      phase: "resolved",
      resolvedAt: new Date("2026-07-22T00:00:00.000Z"),
      visibility: "public",
    }],
  ])("rejects cross-reality or resolved event %s", async (eventId, event) => {
    mocks.tx.worldEvent.findUnique.mockResolvedValue(event);

    const response = await PUT(
      new Request(`http://localhost/api/worlds/world-1/events/${eventId}/focus`, { method: "PUT" }),
      context(eventId),
    );

    expect(response.status).toBe(409);
    expect(mocks.tx.timeline.update).not.toHaveBeenCalled();
  });

  it("clears only the matching focus and keeps repeated deletes idempotent", async () => {
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: observerState("event-a"),
    });
    const first = await DELETE(
      new Request("http://localhost/api/worlds/world-1/events/event-a/focus", { method: "DELETE" }),
      context("event-a"),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ focusedEventId: null });
    expect(mocks.tx.timeline.update).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.tx.world.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      activeTimelineId: "timeline-active",
    });
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: observerState(null),
    });
    const repeated = await DELETE(
      new Request("http://localhost/api/worlds/world-1/events/event-a/focus", { method: "DELETE" }),
      context("event-a"),
    );
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ focusedEventId: null });
    expect(mocks.tx.timeline.update).not.toHaveBeenCalled();
  });

  it("does not clear a replacement focus when deleting a stale event id", async () => {
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: observerState("event-b"),
    });

    const response = await DELETE(
      new Request("http://localhost/api/worlds/world-1/events/event-a/focus", { method: "DELETE" }),
      context("event-a"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ focusedEventId: "event-b" });
    expect(mocks.tx.timeline.update).not.toHaveBeenCalled();
  });

  it.each([
    ["pantheon", "omniscient"],
    ["creator", "limited"],
  ] as const)(
    "rejects hidden focus for %s worlds with a %s observer",
    async (mode, viewpoint) => {
      mocks.tx.world.findUnique.mockResolvedValue({
        id: "world-1",
        mode,
        activeTimelineId: "timeline-active",
      });
      mocks.tx.timeline.findUnique.mockResolvedValue({
        id: "timeline-active",
        observerState: {
          ...observerState(),
          viewpoint,
        },
      });
      mocks.tx.worldEvent.findUnique.mockResolvedValue({
        id: "event-hidden",
        timelineId: "timeline-active",
        phase: "developing",
        resolvedAt: null,
        visibility: "hidden",
      });

      const response = await PUT(
        new Request(
          "http://localhost/api/worlds/world-1/events/event-hidden/focus",
          { method: "PUT" },
        ),
        context("event-hidden"),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "只能关注当前视角可见且尚未解决的活动现实事件",
      });
      expect(mocks.tx.timeline.update).not.toHaveBeenCalled();
    },
  );

  it("allows an omniscient creator to focus a hidden event", async () => {
    mocks.tx.world.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "creator",
      activeTimelineId: "timeline-active",
    });
    mocks.tx.worldEvent.findUnique.mockResolvedValue({
      id: "event-hidden",
      timelineId: "timeline-active",
      phase: "developing",
      resolvedAt: null,
      visibility: "hidden",
    });

    const response = await PUT(
      new Request(
        "http://localhost/api/worlds/world-1/events/event-hidden/focus",
        { method: "PUT" },
      ),
      context("event-hidden"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ focusedEventId: "event-hidden" });
  });
});
