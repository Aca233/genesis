"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFocusMutation } from "./world-activity-panel-state";

export type WorldActivityEventView = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  phase: string;
  visibility: "public" | "player_known" | "hidden";
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  knowledgeLabel?: "世界内尚未知晓";
};

export type WorldActivityItemView = {
  id: string;
  eventId: string | null;
  recordType: string;
  kind: string;
  text: string;
  visibility: "public" | "player_known" | "hidden";
  actorId: string | null;
  targetIds: string[];
  subjectIds: string[];
  eraLabel: string;
  timeLabel: string;
  createdAt: string;
  knowledgeLabel?: "世界内尚未知晓";
};

export type WorldActivityResponse = {
  focusedEvent: WorldActivityEventView | null;
  importantEvents: WorldActivityEventView[];
  recentActivities: WorldActivityItemView[];
  nextCursor: string | null;
};

function SubjectButtons({
  ids,
  onOpenEntity,
}: {
  ids: readonly string[];
  onOpenEntity: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          data-entity-id={id}
          onClick={() => onOpenEntity(id)}
          className="rounded border border-line px-2 py-0.5 text-xs text-ink-soft transition hover:border-gilt hover:text-gilt"
        >
          查看对象
        </button>
      ))}
    </div>
  );
}

function EventCard({
  event,
  focused,
  focusBusy,
  onOpenEntity,
  onSelectEvent,
  onToggleFocus,
}: {
  event: WorldActivityEventView;
  focused: boolean;
  focusBusy: boolean;
  onOpenEntity: (id: string) => void;
  onSelectEvent: (id: string) => void;
  onToggleFocus: (id: string) => void;
}) {
  return (
    <article className="rounded-lg border border-line bg-paper-raised/55 p-3">
      <button
        type="button"
        data-event-id={event.id}
        onClick={() => onSelectEvent(event.id)}
        className="text-left text-sm font-medium text-ink transition hover:text-gilt"
      >
        {event.title}
      </button>
      <p className="mt-1 text-sm leading-6 text-ink-soft">{event.summary}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
        <span>{event.phase}</span>
        {event.knowledgeLabel ? <span>{event.knowledgeLabel}</span> : null}
      </div>
      {event.resolvedAt === null ? (
        <button
          type="button"
          data-focus-event-id={event.id}
          disabled={focusBusy}
          onClick={() => onToggleFocus(event.id)}
          className="mt-2 rounded border border-gilt/50 px-2 py-1 text-xs text-gilt transition hover:bg-gilt/10 disabled:opacity-50"
        >
          {focused ? "取消追踪" : "追踪事件"}
        </button>
      ) : null}
      <SubjectButtons ids={event.participantIds} onOpenEntity={onOpenEntity} />
    </article>
  );
}

export function WorldActivityPanelView({
  worldName,
  data,
  selectedEventId,
  focusBusy = false,
  onOpenEntity,
  onSelectEvent,
  onToggleFocus = () => undefined,
}: {
  worldName: string;
  data: WorldActivityResponse;
  selectedEventId: string | null;
  focusBusy?: boolean;
  onOpenEntity: (id: string) => void;
  onSelectEvent: (id: string) => void;
  onToggleFocus?: (id: string) => void;
}) {
  const selectedEvent = selectedEventId === null
    ? null
    : data.importantEvents.find((event) => event.id === selectedEventId)
      ?? (data.focusedEvent?.id === selectedEventId ? data.focusedEvent : null);

  return (
    <div className="space-y-7">
      {selectedEvent ? (
        <section aria-labelledby="activity-event-detail">
          <h3 id="activity-event-detail" className="mb-3 text-sm font-medium text-ink">
            事件详情
          </h3>
          <EventCard
            event={selectedEvent}
            focused={data.focusedEvent?.id === selectedEvent.id}
            focusBusy={focusBusy}
            onOpenEntity={onOpenEntity}
            onSelectEvent={onSelectEvent}
            onToggleFocus={onToggleFocus}
          />
        </section>
      ) : null}

      <section aria-labelledby="activity-focused">
        <h3 id="activity-focused" className="mb-3 text-sm font-medium text-ink">
          当前关注
        </h3>
        {data.focusedEvent ? (
          <EventCard
            event={data.focusedEvent}
            focused
            focusBusy={focusBusy}
            onOpenEntity={onOpenEntity}
            onSelectEvent={onSelectEvent}
            onToggleFocus={onToggleFocus}
          />
        ) : (
          <p className="text-sm text-ink-faint">尚未追踪重要事件</p>
        )}
      </section>

      <section aria-labelledby="activity-important">
        <h3 id="activity-important" className="mb-3 text-sm font-medium text-ink">
          重要事件
        </h3>
        <div className="space-y-3">
          {data.importantEvents.length > 0 ? data.importantEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              focused={data.focusedEvent?.id === event.id}
              focusBusy={focusBusy}
              onOpenEntity={onOpenEntity}
              onSelectEvent={onSelectEvent}
              onToggleFocus={onToggleFocus}
            />
          )) : <p className="text-sm text-ink-faint">尚无持续中的重要事件</p>}
        </div>
      </section>

      <section aria-labelledby="activity-recent">
        <h3 id="activity-recent" className="mb-3 text-sm font-medium text-ink">
          近期动态
        </h3>
        <div className="space-y-3">
          {data.recentActivities.length > 0 ? data.recentActivities.map((activity) => (
            <article key={activity.id} className="border-l border-gilt/45 pl-3">
              <p className="text-sm leading-6 text-ink">{activity.text}</p>
              <p className="mt-1 text-xs text-ink-faint">
                {worldName} · {activity.eraLabel} · {activity.timeLabel}
              </p>
              {activity.knowledgeLabel ? (
                <p className="mt-1 text-xs text-gilt">{activity.knowledgeLabel}</p>
              ) : null}
              {activity.eventId ? (
                <button
                  type="button"
                  data-event-id={activity.eventId}
                  onClick={() => onSelectEvent(activity.eventId!)}
                  className="mt-2 text-xs text-ink-soft underline decoration-line underline-offset-2 hover:text-gilt"
                >
                  查看关联事件
                </button>
              ) : null}
              <SubjectButtons ids={activity.subjectIds} onOpenEntity={onOpenEntity} />
            </article>
          )) : <p className="text-sm text-ink-faint">世界仍在酝酿新的动向</p>}
        </div>
      </section>
    </div>
  );
}

const EMPTY_ACTIVITY: WorldActivityResponse = {
  focusedEvent: null,
  importantEvents: [],
  recentActivities: [],
  nextCursor: null,
};

export function WorldActivityPanel({
  worldId,
  timelineId,
  worldName,
  onOpenEntity,
  onLoaded,
}: {
  worldId: string;
  timelineId: string;
  worldName: string;
  onOpenEntity: (id: string) => void;
  onLoaded?: (data: WorldActivityResponse) => void;
}) {
  const [data, setData] = useState<WorldActivityResponse>(EMPTY_ACTIVITY);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const onLoadedRef = useRef(onLoaded);
  const requestKey = useMemo(() => `${worldId}:${timelineId}`, [timelineId, worldId]);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const loadActivities = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/worlds/${worldId}/activities`, { signal });
    const json = await response.json().catch(() => null) as
      | (WorldActivityResponse & { error?: string })
      | null;
    if (!response.ok || json === null) {
      throw new Error(json?.error ?? "世界动态读取失败");
    }
    setData(json);
    setLoadedKey(requestKey);
    setFailure(null);
    onLoadedRef.current?.(json);
    return json;
  }, [requestKey, worldId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadActivities(controller.signal)
        .then(() => {
          setSelectedEventId(null);
        })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setFailure({
            key: requestKey,
            message: reason instanceof Error ? reason.message : String(reason),
          });
        }
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadActivities, requestKey]);

  const toggleFocus = useCallback(async (eventId: string) => {
    let mutation = buildFocusMutation({
      worldId,
      currentFocusedEventId: data.focusedEvent?.id ?? null,
      requestedEventId: eventId,
      confirmedReplacement: false,
    });
    if (mutation.kind === "confirm_replace") {
      const confirmed = window.confirm("当前正在追踪另一事件，是否替换追踪目标？");
      if (!confirmed) return;
      mutation = buildFocusMutation({
        worldId,
        currentFocusedEventId: data.focusedEvent?.id ?? null,
        requestedEventId: eventId,
        confirmedReplacement: true,
      });
    }
    if (mutation.kind !== "request") return;

    setFocusBusy(true);
    try {
      const response = await fetch(mutation.url, { method: mutation.method });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "事件追踪更新失败");
      await loadActivities();
    } catch (reason) {
      setFailure({
        key: requestKey,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setFocusBusy(false);
    }
  }, [data.focusedEvent?.id, loadActivities, requestKey, worldId]);

  const loading = loadedKey !== requestKey && failure?.key !== requestKey;
  const error = failure?.key === requestKey ? failure.message : null;
  if (loading) return <p className="text-sm text-ink-faint">正在读取世界动态…</p>;
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  return (
    <WorldActivityPanelView
      worldName={worldName}
      data={data}
      selectedEventId={selectedEventId}
      focusBusy={focusBusy}
      onOpenEntity={onOpenEntity}
      onSelectEvent={setSelectedEventId}
      onToggleFocus={(eventId) => { void toggleFocus(eventId); }}
    />
  );
}
