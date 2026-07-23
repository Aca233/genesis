import { describe, expect, it } from "vitest";
import {
  selectWorldActivityContext,
  type WorldActivityContextRecord,
  type WorldEventContextRecord,
} from "./context";

const events: WorldEventContextRecord[] = [
  {
    id: "event-recent",
    title: "边境骚动",
    summary: "边境军团开始集结。",
    phase: "emerging",
    visibility: "public",
    participantIds: ["entity-other"],
    updatedAt: new Date("2026-07-23T10:00:00.000Z"),
    resolvedAt: null,
  },
  {
    id: "event-focus",
    title: "潮港阴谋",
    summary: "潮港议会的密谋仍在发展。",
    phase: "developing",
    visibility: "player_known",
    participantIds: ["entity-focus"],
    updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    resolvedAt: null,
  },
  {
    id: "event-scene",
    title: "林霁失踪",
    summary: "林霁从神庙外消失。",
    phase: "escalating",
    visibility: "public",
    participantIds: ["entity-scene"],
    updatedAt: new Date("2026-07-23T09:00:00.000Z"),
    resolvedAt: null,
  },
];

const activities: WorldActivityContextRecord[] = [
  {
    id: "activity-hidden",
    eventId: "event-focus",
    recordType: "action",
    kind: "scheme",
    text: "密使烧毁了账册。",
    visibility: "hidden",
    actorId: "entity-focus",
    targetIds: [],
    subjectIds: ["entity-focus"],
    eraLabel: "潮汐纪",
    timeLabel: "七月暮刻",
    createdAt: new Date("2026-07-23T11:00:00.000Z"),
  },
  {
    id: "activity-scene",
    eventId: null,
    recordType: "activity",
    kind: "movement",
    text: "林霁最后一次被人看见是在神庙前。",
    visibility: "public",
    actorId: null,
    targetIds: [],
    subjectIds: ["entity-scene"],
    eraLabel: "潮汐纪",
    timeLabel: "七月晨刻",
    createdAt: new Date("2026-07-23T09:30:00.000Z"),
  },
];

describe("selectWorldActivityContext", () => {
  it("places the focused event first, de-duplicates it, and preserves scene relevance", () => {
    const selected = selectWorldActivityContext({
      focusedEventId: "event-focus",
      currentSubjectIds: ["entity-scene"],
      events: [...events, events[1]],
      activities,
      budget: { events: 3, activities: 8 },
      viewer: "creator_omniscient",
    });

    expect(selected.events.map((event) => event.id)).toEqual([
      "event-focus",
      "event-scene",
      "event-recent",
    ]);
    expect(selected.events.filter((event) => event.id === "event-focus")).toHaveLength(1);
    expect(selected.actionableEventIds).toEqual([
      "event-focus",
      "event-scene",
      "event-recent",
    ]);
  });

  it("never injects hidden records into Pantheon or limited Creator context", () => {
    for (const viewer of ["pantheon", "creator_limited"] as const) {
      const selected = selectWorldActivityContext({
        focusedEventId: "event-focus",
        currentSubjectIds: [],
        events,
        activities,
        budget: { events: 3, activities: 8 },
        viewer,
      });
      expect(selected.activities).not.toContainEqual(
        expect.objectContaining({ visibility: "hidden" }),
      );
    }
  });

  it("marks hidden Creator knowledge as unknown inside the world", () => {
    const selected = selectWorldActivityContext({
      focusedEventId: "event-focus",
      currentSubjectIds: [],
      events,
      activities,
      budget: { events: 3, activities: 8 },
      viewer: "creator_omniscient",
    });

    expect(selected.activities[0]).toMatchObject({
      id: "activity-hidden",
      knowledgeNote: "世界内尚未知晓",
    });
  });
});
