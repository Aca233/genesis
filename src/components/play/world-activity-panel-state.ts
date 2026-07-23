export type ActivityCursor = {
  createdAt: string;
  id: string;
};

export type ProjectedActivityCursorRecord = ActivityCursor & {
  sourceMessageId?: string;
};

export type FocusMutation =
  | { kind: "confirm_replace"; replacingEventId: string }
  | { kind: "request"; url: string; method: "PUT" | "DELETE" };

function compareCursor(
  left: ActivityCursor,
  right: ActivityCursor,
): number {
  const time = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return time || left.id.localeCompare(right.id);
}

export function buildFocusMutation(input: {
  worldId: string;
  currentFocusedEventId: string | null;
  requestedEventId: string;
  confirmedReplacement: boolean;
}): FocusMutation {
  if (input.currentFocusedEventId === input.requestedEventId) {
    return {
      kind: "request",
      url: `/api/worlds/${encodeURIComponent(input.worldId)}/events/${encodeURIComponent(input.requestedEventId)}/focus`,
      method: "DELETE",
    };
  }
  if (input.currentFocusedEventId !== null && !input.confirmedReplacement) {
    return {
      kind: "confirm_replace",
      replacingEventId: input.currentFocusedEventId,
    };
  }
  return {
    kind: "request",
    url: `/api/worlds/${encodeURIComponent(input.worldId)}/events/${encodeURIComponent(input.requestedEventId)}/focus`,
    method: "PUT",
  };
}

export function countUnreadActivities(
  activities: readonly ProjectedActivityCursorRecord[],
  cursor: ActivityCursor | null,
): number {
  if (cursor === null) return activities.length;
  return activities.filter((activity) => compareCursor(activity, cursor) > 0).length;
}

export function advanceActivityCursor(
  activities: readonly ProjectedActivityCursorRecord[],
  cursor: ActivityCursor | null,
): ActivityCursor | null {
  let latest = cursor;
  for (const activity of activities) {
    if (latest === null || compareCursor(activity, latest) > 0) {
      latest = { createdAt: activity.createdAt, id: activity.id };
    }
  }
  return latest;
}
