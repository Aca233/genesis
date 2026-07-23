import { describe, expect, it } from "vitest";
import {
  assertWorldEventParentAcyclic,
  remapWorldActivityGraph,
} from "./clone";

describe("remapWorldActivityGraph", () => {
  it("重映射事件、父事件、动态、参与者、来源消息和关注事件", () => {
    const maps = {
      event: new Map([
        ["event-parent", "event-parent-clone"],
        ["event-child", "event-child-clone"],
      ]),
      activity: new Map([
        ["activity-origin", "activity-origin-clone"],
        ["activity-progress", "activity-progress-clone"],
      ]),
      message: new Map([
        ["message-origin", "message-origin-clone"],
        ["message-latest", "message-latest-clone"],
      ]),
      god: new Map([["god-old", "god-clone"]]),
      entity: new Map([
        ["entity-actor", "entity-actor-clone"],
        ["entity-target", "entity-target-clone"],
      ]),
    };

    const cloned = remapWorldActivityGraph({
      events: [
        {
          id: "event-parent",
          timelineId: "timeline-old",
          kind: "war",
          title: "边境战火",
          summary: "两国交锋",
          phase: "escalating",
          visibility: "public",
          participantIds: ["god-old", "entity-target"],
          originMessageId: "message-origin",
          originActivityId: "activity-origin",
          latestMessageId: "message-latest",
          parentEventId: null,
          createdAt: new Date("2026-07-23T01:00:00.000Z"),
          updatedAt: new Date("2026-07-23T02:00:00.000Z"),
          resolvedAt: null,
        },
        {
          id: "event-child",
          timelineId: "timeline-old",
          kind: "conspiracy",
          title: "暗线",
          summary: "阴谋自战争中滋生",
          phase: "emerging",
          visibility: "hidden",
          participantIds: ["entity-actor"],
          originMessageId: "message-latest",
          originActivityId: null,
          latestMessageId: "message-latest",
          parentEventId: "event-parent",
          createdAt: new Date("2026-07-23T03:00:00.000Z"),
          updatedAt: new Date("2026-07-23T04:00:00.000Z"),
          resolvedAt: null,
        },
      ],
      activities: [
        {
          id: "activity-origin",
          timelineId: "timeline-old",
          eventId: null,
          recordType: "activity",
          kind: "politics",
          text: "使者失踪",
          visibility: "public",
          actorId: "entity-actor",
          targetIds: ["god-old", "entity-target"],
          subjectIds: ["entity-actor", "entity-target"],
          sourceMessageId: "message-origin",
          eraLabel: "星火纪元",
          timeLabel: "第七日",
          createdAt: new Date("2026-07-23T01:30:00.000Z"),
        },
        {
          id: "activity-progress",
          timelineId: "timeline-old",
          eventId: "event-child",
          recordType: "event_progress",
          kind: "conspiracy",
          text: "密谋者现身",
          visibility: "hidden",
          actorId: null,
          targetIds: [],
          subjectIds: ["entity-actor"],
          sourceMessageId: "message-latest",
          eraLabel: "星火纪元",
          timeLabel: "第八日",
          createdAt: new Date("2026-07-23T03:30:00.000Z"),
        },
      ],
      observerState: {
        focusType: "entity",
        focusId: "entity-actor",
        activeAvatarId: null,
        focusedEventId: "event-child",
      },
    }, maps, "timeline-clone");

    expect(cloned.events[0]).toMatchObject({
      id: "event-parent-clone",
      timelineId: "timeline-clone",
      participantIds: ["god-clone", "entity-target-clone"],
      originMessageId: "message-origin-clone",
      originActivityId: "activity-origin-clone",
      latestMessageId: "message-latest-clone",
    });
    expect(cloned.events[1]).toMatchObject({
      id: "event-child-clone",
      parentEventId: "event-parent-clone",
      participantIds: ["entity-actor-clone"],
    });
    expect(cloned.activities[0]).toMatchObject({
      id: "activity-origin-clone",
      timelineId: "timeline-clone",
      actorId: "entity-actor-clone",
      targetIds: ["god-clone", "entity-target-clone"],
      subjectIds: ["entity-actor-clone", "entity-target-clone"],
      sourceMessageId: "message-origin-clone",
    });
    expect(cloned.activities[1]).toMatchObject({
      eventId: "event-child-clone",
      sourceMessageId: "message-latest-clone",
    });
    expect(cloned.observerState).toMatchObject({
      focusId: "entity-actor",
      focusedEventId: "event-child-clone",
    });
  });

  it("遇到任何未映射的现实内引用时拒绝克隆", () => {
    expect(() => remapWorldActivityGraph({
      events: [{
        id: "event-old",
        timelineId: "timeline-old",
        kind: "war",
        title: "悬空事件",
        summary: "测试",
        phase: "emerging",
        visibility: "public",
        participantIds: ["entity-missing"],
        originMessageId: "message-old",
        originActivityId: null,
        latestMessageId: "message-old",
        parentEventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
      }],
      activities: [],
      observerState: null,
    }, {
      event: new Map([["event-old", "event-clone"]]),
      activity: new Map(),
      message: new Map([["message-old", "message-clone"]]),
      god: new Map(),
      entity: new Map(),
    }, "timeline-clone")).toThrow(/entity-missing/);
  });

  it("复制前拒绝父事件循环", () => {
    expect(() => assertWorldEventParentAcyclic([
      { id: "event-a", parentEventId: "event-b" },
      { id: "event-b", parentEventId: "event-a" },
    ])).toThrow(/父链不得形成循环/);
  });
});
