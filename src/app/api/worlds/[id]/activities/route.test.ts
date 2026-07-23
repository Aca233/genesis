import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  worldFindUnique: vi.fn(),
  timelineFindUnique: vi.fn(),
  eventFindMany: vi.fn(),
  activityFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findUnique: mocks.worldFindUnique },
    timeline: { findUnique: mocks.timelineFindUnique },
    worldEvent: { findMany: mocks.eventFindMany },
    worldActivity: { findMany: mocks.activityFindMany },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };

function request(query = "") {
  return new Request(`http://localhost/api/worlds/world-1/activities${query}`);
}

const event = (overrides: Record<string, unknown> = {}) => ({
  id: "event-1",
  kind: "war",
  title: "北境烽烟",
  summary: "两国在边境集结。",
  phase: "escalating",
  visibility: "public",
  participantIds: ["entity-1"],
  createdAt: new Date("2026-07-21T00:00:00.000Z"),
  updatedAt: new Date("2026-07-23T00:00:00.000Z"),
  resolvedAt: null,
  ...overrides,
});

const activity = (overrides: Record<string, unknown> = {}) => ({
  id: "activity-1",
  eventId: "event-1",
  recordType: "event_progress",
  kind: "war",
  text: "军团越过霜河。",
  visibility: "public",
  actorId: "entity-1",
  targetIds: [],
  subjectIds: ["entity-1"],
  eraLabel: "星火纪元",
  timeLabel: "第七年·霜月",
  createdAt: new Date("2026-07-23T03:00:00.000Z"),
  ...overrides,
});

describe("GET /api/worlds/[id]/activities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.worldFindUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      activeTimelineId: "timeline-1",
    });
    mocks.timelineFindUnique.mockResolvedValue({
      id: "timeline-1",
      observerState: {
        focusType: "world",
        focusId: null,
        focusedEventId: "event-1",
        timeLabel: "第七年·霜月",
        viewpoint: "limited",
        activeAvatarId: null,
      },
    });
    mocks.eventFindMany.mockResolvedValue([event()]);
    mocks.activityFindMany.mockResolvedValue([activity(), activity({
      id: "activity-hidden",
      text: "密谋者毒杀了信使。",
      visibility: "hidden",
      subjectIds: ["entity-secret"],
      createdAt: new Date("2026-07-23T02:00:00.000Z"),
    })]);
  });

  it("returns focused event, important events and projected recent activity", async () => {
    const response = await GET(request("?limit=1"), context);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.focusedEvent.id).toBe("event-1");
    expect(json.importantEvents).toHaveLength(1);
    expect(json.recentActivities).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain("密谋者毒杀了信使");
    expect(mocks.activityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
  });

  it("applies a compound createdAt and id cursor without skipping timestamp ties", async () => {
    mocks.activityFindMany.mockResolvedValue([
      activity({ id: "activity-2", createdAt: new Date("2026-07-22T03:00:00.000Z") }),
      activity({ id: "activity-1", createdAt: new Date("2026-07-22T03:00:00.000Z") }),
    ]);
    const cursor = encodeURIComponent("2026-07-23T00:00:00.000Z|activity-3");
    const response = await GET(
      request(`?limit=1&before=${cursor}`),
      context,
    );
    const json = await response.json();
    expect(mocks.activityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { createdAt: { lt: new Date("2026-07-23T00:00:00.000Z") } },
          {
            createdAt: new Date("2026-07-23T00:00:00.000Z"),
            id: { lt: "activity-3" },
          },
        ],
      }),
    }));
    expect(json.nextCursor).toBe("2026-07-22T03:00:00.000Z|activity-2");
  });

  it.each([
    "?limit=0",
    "?limit=51",
    "?before=not-a-cursor",
    "?before=2026-07-23T00%3A00%3A00.000Z%7C",
  ])(
    "rejects malformed pagination %s",
    async (query) => {
      expect((await GET(request(query), context)).status).toBe(400);
    },
  );

  it("returns 404 when the world or active timeline is unavailable", async () => {
    mocks.worldFindUnique.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(404);
    mocks.worldFindUnique.mockResolvedValueOnce({
      id: "world-1",
      mode: "creator",
      activeTimelineId: null,
    });
    expect((await GET(request(), context)).status).toBe(404);
  });

  it("keeps hidden activity for omniscient creator with a knowledge label", async () => {
    mocks.worldFindUnique.mockResolvedValue({
      id: "world-1",
      mode: "creator",
      activeTimelineId: "timeline-1",
    });
    mocks.timelineFindUnique.mockResolvedValue({
      id: "timeline-1",
      observerState: {
        focusType: "world",
        focusId: null,
        timeLabel: "第七年·霜月",
        viewpoint: "omniscient",
        activeAvatarId: null,
      },
    });
    const response = await GET(request(), context);
    const json = await response.json();
    expect(json.recentActivities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "activity-hidden",
        knowledgeLabel: "世界内尚未知晓",
      }),
    ]));
  });

  it("removes a hidden linked event id from otherwise visible activity", async () => {
    mocks.eventFindMany.mockResolvedValue([]);
    mocks.activityFindMany.mockResolvedValue([
      activity({
        id: "activity-public-hidden-event",
        eventId: "event-hidden",
        event: { visibility: "hidden" },
      }),
    ]);

    const response = await GET(request(), context);
    const json = await response.json();

    expect(json.recentActivities).toEqual([
      expect.objectContaining({
        id: "activity-public-hidden-event",
        eventId: null,
      }),
    ]);
    expect(mocks.activityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        event: { select: { visibility: true } },
      },
    }));
  });
});
