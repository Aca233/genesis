import { describe, expect, it } from "vitest";
import type { RealityViewer } from "@/lib/reality/visibility";
import {
  projectWorldActivity,
  type WorldActivityProjectionInput,
} from "./projection";

const input: WorldActivityProjectionInput = {
  focusedEventId: "event-public",
  events: [
    {
      id: "event-public",
      kind: "war",
      title: "北境烽烟",
      summary: "两国在边境集结。",
      phase: "escalating",
      visibility: "public",
      participantIds: ["entity-public"],
      createdAt: new Date("2026-07-21T00:00:00.000Z"),
      updatedAt: new Date("2026-07-23T00:00:00.000Z"),
      resolvedAt: null,
    },
    {
      id: "event-hidden",
      kind: "conspiracy",
      title: "无声密约",
      summary: "摄政者已与深渊结盟。",
      phase: "developing",
      visibility: "hidden",
      participantIds: ["entity-secret"],
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
      updatedAt: new Date("2026-07-22T00:00:00.000Z"),
      resolvedAt: null,
    },
  ],
  activities: [
    {
      id: "activity-public",
      eventId: "event-public",
      recordType: "event_progress",
      kind: "war",
      text: "北境军团越过霜河。",
      visibility: "public",
      actorId: "entity-public",
      targetIds: ["place-border"],
      subjectIds: ["entity-public"],
      eraLabel: "星火纪元",
      timeLabel: "第七年·霜月",
      createdAt: new Date("2026-07-23T03:00:00.000Z"),
    },
    {
      id: "activity-known",
      eventId: null,
      recordType: "activity",
      kind: "rumor",
      text: "玩家已从信使处得知港口封锁。",
      visibility: "player_known",
      actorId: null,
      targetIds: ["place-harbor"],
      subjectIds: ["place-harbor"],
      eraLabel: "星火纪元",
      timeLabel: "第七年·霜月",
      createdAt: new Date("2026-07-23T02:00:00.000Z"),
    },
    {
      id: "activity-hidden",
      eventId: "event-hidden",
      recordType: "action",
      kind: "conspiracy",
      text: "摄政者把密约藏进王冠。",
      visibility: "hidden",
      actorId: "entity-secret",
      targetIds: ["entity-abyss"],
      subjectIds: ["entity-secret", "entity-abyss"],
      eraLabel: "星火纪元",
      timeLabel: "第七年·霜月",
      createdAt: new Date("2026-07-23T01:00:00.000Z"),
    },
  ],
};

describe("projectWorldActivity", () => {
  it.each([
    ["pantheon_player", ["public", "player_known"]],
    ["creator_limited", ["public", "player_known"]],
    ["creator_omniscient", ["public", "player_known", "hidden"]],
  ] as const)("%s only receives permitted activity", (viewer, expected) => {
    const projected = projectWorldActivity(input, viewer as RealityViewer);
    expect(projected.activities.map((item) => item.visibility)).toEqual(expected);
  });

  it("does not serialize hidden text or object ids for a limited viewer", () => {
    const serialized = JSON.stringify(projectWorldActivity(input, "pantheon_player"));
    expect(serialized).not.toContain("摄政者把密约藏进王冠");
    expect(serialized).not.toContain("entity-secret");
    expect(serialized).not.toContain("entity-abyss");
    expect(serialized).not.toContain("无声密约");
  });

  it("keeps hidden rows for omniscient creator and marks their world knowledge", () => {
    const projected = projectWorldActivity(input, "creator_omniscient");
    expect(projected.activities.find((item) => item.id === "activity-hidden"))
      .toMatchObject({ knowledgeLabel: "世界内尚未知晓" });
    expect(projected.events.find((item) => item.id === "event-hidden"))
      .toMatchObject({ knowledgeLabel: "世界内尚未知晓" });
  });

  it("drops a focused event when fog makes it invisible", () => {
    const projected = projectWorldActivity(
      { ...input, focusedEventId: "event-hidden" },
      "creator_limited",
    );
    expect(projected.focusedEvent).toBeNull();
  });

  it("redacts a hidden linked event id from visible activity under fog", () => {
    const linkedActivity = {
      ...input.activities[0],
      id: "activity-public-hidden-event",
      eventId: "event-hidden",
    };

    const limited = projectWorldActivity(
      { ...input, activities: [linkedActivity] },
      "creator_limited",
    );
    const omniscient = projectWorldActivity(
      { ...input, activities: [linkedActivity] },
      "creator_omniscient",
    );

    expect(limited.activities[0]?.eventId).toBeNull();
    expect(omniscient.activities[0]?.eventId).toBe("event-hidden");
  });
});
