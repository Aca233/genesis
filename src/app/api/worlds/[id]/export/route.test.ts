import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    world: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { GET } from "./route";

describe("version 4 世界存档导出", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("保留 owner-private hidden 事件和动态，但排除 GenerationRequest 私有字段", async () => {
    mocks.prisma.world.findFirst.mockResolvedValue({
      id: "world-1",
      name: "隐秘世界",
      genesisInput: "让世界运行",
      mode: "creator",
      status: "playing",
      activeTimelineId: "timeline-1",
      iconTheme: { version: 1, catalogVersion: 1, primaryFamily: "tabler" },
      rewrites: [],
      lorebookEntries: [],
      timelines: [{
        id: "timeline-1",
        worldId: "world-1",
        parentId: null,
        forkChapter: null,
        branchName: "原初现实",
        branchSummary: null,
        realityState: { currentEra: "隐秘纪元" },
        observerState: {
          focusType: "world",
          focusId: null,
          timeLabel: "第七日",
          viewpoint: "omniscient",
          activeAvatarId: null,
          focusedEventId: "world-event-1",
        },
        forkRewriteId: null,
        chapters: [{
          id: "chapter-1",
          timelineId: "timeline-1",
          index: 0,
          title: null,
          summary: null,
          settleState: "open",
          snapshot: null,
          messages: [{
            id: "message-1",
            chapterId: "chapter-1",
            index: 0,
            role: "narrator",
            content: "暗潮涌动。",
            scale: "scene",
            variants: null,
            meta: null,
          }],
          generationRequests: [{
            id: "generation-1",
            outputSnapshot: { prose: "不得导出" },
            leaseExpiresAt: new Date("2026-07-23T00:00:00Z"),
            safeError: "内部安全错误",
            error: "provider raw error",
          }],
        }],
        gods: [],
        abilities: [],
        entities: [],
        entityRelations: [{
          id: "relation-1",
          timelineId: "timeline-1",
          sourceEntityId: "entity-1",
          targetEntityId: "entity-2",
          label: "盟友",
          note: "共同守护边境。",
          createdAt: new Date("2026-07-23T00:00:00Z"),
          updatedAt: new Date("2026-07-23T00:01:00Z"),
        }],
        chronicles: [],
        omens: [],
        worldEvents: [{
          id: "world-event-1",
          timelineId: "timeline-1",
          kind: "conspiracy",
          title: "无声议会",
          summary: "密谋仍未公开。",
          phase: "developing",
          visibility: "hidden",
          participantIds: [],
          originMessageId: "message-1",
          originActivityId: "world-activity-1",
          latestMessageId: "message-1",
          parentEventId: null,
          createdAt: new Date("2026-07-23T00:00:00Z"),
          updatedAt: new Date("2026-07-23T00:00:00Z"),
          resolvedAt: null,
        }],
        worldActivities: [{
          id: "world-activity-1",
          timelineId: "timeline-1",
          eventId: "world-event-1",
          recordType: "event_progress",
          kind: "conspiracy",
          text: "密使交换了黑蜡封缄。",
          visibility: "hidden",
          actorId: null,
          targetIds: [],
          subjectIds: [],
          sourceMessageId: "message-1",
          eraLabel: "隐秘纪元",
          timeLabel: "第七日",
          createdAt: new Date("2026-07-23T00:00:00Z"),
        }],
        iconAssignments: [{
          id: "icon-assignment-1",
          timelineId: "timeline-1",
          subjectType: "event",
          subjectId: "world-event-1",
          token: "event.conflict",
          source: "player",
          playerLocked: true,
        }],
      }],
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "world-1" }),
    });
    const archive = await response.json();
    const serialized = JSON.stringify(archive);

    expect(archive.version).toBe(4);
    expect(archive.world.timelines[0].worldEvents).toContainEqual(
      expect.objectContaining({ id: "world-event-1", visibility: "hidden" }),
    );
    expect(archive.world.timelines[0].worldActivities).toContainEqual(
      expect.objectContaining({ id: "world-activity-1", visibility: "hidden" }),
    );
    expect(archive.world.iconTheme).toEqual(expect.objectContaining({ primaryFamily: "tabler" }));
    expect(archive.world.timelines[0].iconAssignments).toEqual([
      expect.objectContaining({ subjectId: "world-event-1", token: "event.conflict" }),
    ]);
    expect(archive.iconCreditsMarkdown).toContain("# Icon Credits");
    expect(archive.iconCreditsMarkdown).toContain("CC BY 3.0");
    expect(archive.world.timelines[0].entityRelations).toEqual([expect.objectContaining({
      id: "relation-1",
      sourceEntityId: "entity-1",
      targetEntityId: "entity-2",
      label: "盟友",
      note: "共同守护边境。",
    })]);
    expect(serialized).not.toContain("generationRequests");
    expect(serialized).not.toContain("outputSnapshot");
    expect(serialized).not.toContain("leaseExpiresAt");
    expect(serialized).not.toContain("safeError");
    expect(serialized).not.toContain("provider raw error");
    expect(mocks.prisma.world.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", userId: "local" },
      include: expect.objectContaining({
        timelines: expect.objectContaining({
          include: expect.objectContaining({
            worldEvents: expect.anything(),
            worldActivities: expect.anything(),
            entityRelations: expect.anything(),
            iconAssignments: expect.anything(),
            chapters: expect.objectContaining({
              include: { messages: { orderBy: { index: "asc" } } },
            }),
          }),
        }),
      }),
    }));
  });

  it("非 local 所有者的世界按不存在处理", async () => {
    mocks.prisma.world.findFirst.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "foreign-world" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.prisma.world.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign-world", userId: "local" },
    }));
  });
});
