import { describe, expect, it } from "vitest";
import {
  advanceActivityCursor,
  buildFocusMutation,
  countUnreadActivities,
} from "./world-activity-panel-state";

const projectedActivities = [
  { id: "activity-a", createdAt: "2026-07-23T10:00:00.000Z", sourceMessageId: "message-1" },
  { id: "activity-b", createdAt: "2026-07-23T10:00:00.000Z", sourceMessageId: "message-2" },
  { id: "activity-c", createdAt: "2026-07-23T11:00:00.000Z", sourceMessageId: "message-3" },
];

describe("world activity panel state", () => {
  it("requires replacement confirmation before constructing the only focus PUT", () => {
    expect(buildFocusMutation({
      worldId: "world-1",
      currentFocusedEventId: "event-a",
      requestedEventId: "event-b",
      confirmedReplacement: false,
    })).toEqual({ kind: "confirm_replace", replacingEventId: "event-a" });

    expect(buildFocusMutation({
      worldId: "world-1",
      currentFocusedEventId: "event-a",
      requestedEventId: "event-b",
      confirmedReplacement: true,
    })).toEqual({
      kind: "request",
      url: "/api/worlds/world-1/events/event-b/focus",
      method: "PUT",
    });
  });

  it("constructs DELETE only when cancelling the currently focused event", () => {
    expect(buildFocusMutation({
      worldId: "world 1",
      currentFocusedEventId: "event/a",
      requestedEventId: "event/a",
      confirmedReplacement: false,
    })).toEqual({
      kind: "request",
      url: "/api/worlds/world%201/events/event%2Fa/focus",
      method: "DELETE",
    });
  });

  it("counts only projected records after the local createdAt/id cursor", () => {
    expect(countUnreadActivities(projectedActivities, {
      createdAt: "2026-07-23T10:00:00.000Z",
      id: "activity-a",
    })).toBe(2);
    expect(countUnreadActivities(projectedActivities, null)).toBe(3);
  });

  it("moves the cursor to the newest projected record when the panel opens", () => {
    expect(advanceActivityCursor(projectedActivities, {
      createdAt: "2026-07-23T10:00:00.000Z",
      id: "activity-a",
    })).toEqual({
      createdAt: "2026-07-23T11:00:00.000Z",
      id: "activity-c",
    });
    expect(advanceActivityCursor([], null)).toBeNull();
  });
});
