import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    chapter: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth/session", () => ({ requireUserId: mocks.requireUserId }));

import { GET, PATCH } from "./route";

const chapter = {
  id: "chapter-1",
  settleState: "open",
  brief: {
    objective: "守住北港",
    mustHide: ["潮神已经倒戈"],
  },
  timeline: {
    id: "timeline-1",
    world: { activeTimelineId: "timeline-1" },
  },
};

describe("/api/chapters/[id]/brief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.chapter.findFirst.mockResolvedValue(chapter);
    mocks.prisma.chapter.update.mockImplementation(async ({ data }: { data: { brief: unknown } }) => ({
      ...chapter,
      brief: data.brief,
    }));
  });

  it("returns a normalized owned chapter brief", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      brief: {
        objective: "守住北港",
        viewpointEntityId: null,
        openingConstraint: null,
        endingConstraint: null,
        readerKnows: [],
        viewpointKnows: [],
        mustHide: ["潮神已经倒戈"],
        hintOnly: [],
        forbiddenDevelopments: [],
      },
    });
    expect(mocks.prisma.chapter.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "chapter-1", timeline: { world: { userId: "test-user" } } },
    }));
  });

  it("merges a partial patch and preserves unspecified controls", async () => {
    const response = await PATCH(new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hintOnly: ["海堤下有空洞", "海堤下有空洞"] }),
    }), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: "chapter-1" },
      data: {
        brief: expect.objectContaining({
          objective: "守住北港",
          mustHide: ["潮神已经倒戈"],
          hintOnly: ["海堤下有空洞"],
        }),
      },
      select: { brief: true },
    });
  });

  it("rejects edits to settled or frozen chapters", async () => {
    mocks.prisma.chapter.findFirst.mockResolvedValueOnce({ ...chapter, settleState: "settled" });
    const settled = await PATCH(new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ objective: "改写目标" }),
    }), { params: Promise.resolve({ id: "chapter-1" }) });
    expect(settled.status).toBe(409);

    mocks.prisma.chapter.findFirst.mockResolvedValueOnce({
      ...chapter,
      timeline: { id: "timeline-old", world: { activeTimelineId: "timeline-new" } },
    });
    const frozen = await PATCH(new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ objective: "改写目标" }),
    }), { params: Promise.resolve({ id: "chapter-1" }) });
    expect(frozen.status).toBe(409);
    expect(mocks.prisma.chapter.update).not.toHaveBeenCalled();
  });
});
