"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFocusMutation } from "./world-activity-panel-state";
import { eventPhaseName } from "./lexicon";

export type WorldActivityEventView = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  phase: string;
  visibility: "public" | "player_known" | "hidden";
  participantIds: string[];
  participants?: WorldActivitySubjectView[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  knowledgeLabel?: "世界内尚未知晓";
};

export type WorldActivitySubjectView = {
  id: string;
  name: string;
  entityId: string | null;
  godId: string | null;
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
  subjects?: WorldActivitySubjectView[];
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

function SubjectLinks({
  subjects,
  onOpenEntity,
  onOpenGod,
}: {
  subjects: readonly WorldActivitySubjectView[];
  onOpenEntity: (id: string) => void;
  onOpenGod: (id: string) => void;
}) {
  if (subjects.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {subjects.map((subject) => subject.godId ? (
          <button
            key={subject.id}
            type="button"
            data-god-id={subject.godId}
            onClick={() => onOpenGod(subject.godId!)}
            className="rounded border border-line px-2 py-0.5 text-xs text-ink-soft transition hover:border-gilt hover:text-gilt"
          >
            {subject.name}
          </button>
        ) : subject.entityId ? (
          <button
            key={subject.id}
            type="button"
            data-entity-id={subject.entityId}
            onClick={() => onOpenEntity(subject.entityId!)}
            className="rounded border border-line px-2 py-0.5 text-xs text-ink-soft transition hover:border-gilt hover:text-gilt"
          >
            {subject.name}
          </button>
        ) : (
          <span
            key={subject.id}
            className="rounded border border-line/70 px-2 py-0.5 text-xs text-ink-faint"
          >
            {subject.name}
          </span>
        ))}
    </div>
  );
}

function EventCard({
  event,
  focused,
  focusBusy,
  confirmingReplace,
  onOpenEntity,
  onOpenGod,
  onSelectEvent,
  onToggleFocus,
  onConfirmReplace,
  onCancelReplace,
}: {
  event: WorldActivityEventView;
  focused: boolean;
  focusBusy: boolean;
  /** 追踪替换的二次确认：confirmingEventId 与本卡一致时原位显示确认行 */
  confirmingReplace: boolean;
  onOpenEntity: (id: string) => void;
  onOpenGod: (id: string) => void;
  onSelectEvent: (id: string) => void;
  onToggleFocus: (id: string) => void;
  onConfirmReplace: (id: string) => void;
  onCancelReplace: () => void;
}) {
  return (
    <article
      className={`rounded-lg border p-3 transition [background-image:var(--fiber-noise)] ${
        focused
          ? "border-gilt/55 bg-paper-raised/70 shadow-[0_0_0.6rem_var(--gilt-glow),0_2px_10px_var(--shadow-warm),inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_85%,transparent)]"
          : "border-line bg-paper-raised/55 shadow-[0_2px_10px_var(--shadow-warm),inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_85%,transparent)]"
      }`}
    >
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
        <span>{eventPhaseName(event.phase)}</span>
        {event.knowledgeLabel ? <span>{event.knowledgeLabel}</span> : null}
      </div>
      {event.resolvedAt === null ? (
        confirmingReplace ? (
          <span className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-cinnabar/40 bg-paper-sunken/70 px-3 py-2 text-xs text-cinnabar shadow-[inset_0_1px_3px_color-mix(in_srgb,var(--ink)_12%,transparent)]">
            替换当前追踪目标？
            <button
              type="button"
              disabled={focusBusy}
              onClick={() => onConfirmReplace(event.id)}
              className="font-bold underline underline-offset-2 disabled:opacity-50"
            >
              确认
            </button>
            <button
              type="button"
              onClick={onCancelReplace}
              className="text-ink-faint transition hover:text-ink"
            >
              且慢
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-focus-event-id={event.id}
            disabled={focusBusy}
            onClick={() => onToggleFocus(event.id)}
            className={
              focused
                ? "mt-2 rounded border border-gilt/50 px-2 py-1 text-xs text-gilt transition hover:bg-gilt/10 disabled:opacity-50"
                : "seal-button mt-2 min-h-7! px-3! py-1! text-xs"
            }
          >
            {focused ? "取消追踪" : "追踪事件"}
          </button>
        )
      ) : null}
      <SubjectLinks subjects={event.participants ?? []} onOpenEntity={onOpenEntity} onOpenGod={onOpenGod} />
    </article>
  );
}

export function WorldActivityPanelView({
  worldName,
  data,
  selectedEventId,
  focusBusy = false,
  confirmingEventId = null,
  onOpenEntity,
  onOpenGod = () => undefined,
  onSelectEvent,
  onToggleFocus = () => undefined,
  onConfirmReplace = () => undefined,
  onCancelReplace = () => undefined,
}: {
  worldName: string;
  data: WorldActivityResponse;
  selectedEventId: string | null;
  focusBusy?: boolean;
  /** 追踪替换确认态由容器 WorldActivityPanel 持有，经此透传至 EventCard 原位渲染 */
  confirmingEventId?: string | null;
  onOpenEntity: (id: string) => void;
  onOpenGod?: (id: string) => void;
  onSelectEvent: (id: string) => void;
  onToggleFocus?: (id: string) => void;
  onConfirmReplace?: (id: string) => void;
  onCancelReplace?: () => void;
}) {
  const selectedEvent = selectedEventId === null
    ? null
    : data.importantEvents.find((event) => event.id === selectedEventId)
      ?? (data.focusedEvent?.id === selectedEventId ? data.focusedEvent : null);

  return (
    <div className="space-y-7">
      {selectedEvent ? (
        <section aria-labelledby="activity-event-detail">
          <h3 id="activity-event-detail" className="illuminated-header mb-3 text-sm">
            <span className="illuminated-header__glyph" aria-hidden="true">
              ✦
            </span>
            事件详情
          </h3>
          <EventCard
            event={selectedEvent}
            focused={data.focusedEvent?.id === selectedEvent.id}
            focusBusy={focusBusy}
            confirmingReplace={confirmingEventId === selectedEvent.id}
            onOpenEntity={onOpenEntity}
            onOpenGod={onOpenGod}
            onSelectEvent={onSelectEvent}
            onToggleFocus={onToggleFocus}
            onConfirmReplace={onConfirmReplace}
            onCancelReplace={onCancelReplace}
          />
        </section>
      ) : null}

      <section aria-labelledby="activity-focused">
        <h3 id="activity-focused" className="illuminated-header mb-3 text-sm">
          <span className="illuminated-header__glyph" aria-hidden="true">
            ✦
          </span>
          当前关注
        </h3>
        {data.focusedEvent ? (
          <EventCard
            event={data.focusedEvent}
            focused
            focusBusy={focusBusy}
            confirmingReplace={confirmingEventId === data.focusedEvent.id}
            onOpenEntity={onOpenEntity}
            onOpenGod={onOpenGod}
            onSelectEvent={onSelectEvent}
            onToggleFocus={onToggleFocus}
            onConfirmReplace={onConfirmReplace}
            onCancelReplace={onCancelReplace}
          />
        ) : (
          <p className="text-sm text-ink-faint">尚未追踪重要事件</p>
        )}
      </section>

      <section aria-labelledby="activity-important">
        <h3 id="activity-important" className="illuminated-header mb-3 text-sm">
          <span className="illuminated-header__glyph" aria-hidden="true">
            ✦
          </span>
          重要事件
        </h3>
        <div className="space-y-3">
          {data.importantEvents.length > 0 ? data.importantEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              focused={data.focusedEvent?.id === event.id}
              focusBusy={focusBusy}
              confirmingReplace={confirmingEventId === event.id}
              onOpenEntity={onOpenEntity}
              onOpenGod={onOpenGod}
              onSelectEvent={onSelectEvent}
              onToggleFocus={onToggleFocus}
              onConfirmReplace={onConfirmReplace}
              onCancelReplace={onCancelReplace}
            />
          )) : <p className="text-sm text-ink-faint">尚无持续中的重要事件</p>}
        </div>
      </section>

      <section aria-labelledby="activity-recent">
        <h3 id="activity-recent" className="illuminated-header mb-3 text-sm">
          <span className="illuminated-header__glyph" aria-hidden="true">
            ✦
          </span>
          近期动态
        </h3>
        <div className="space-y-3">
          {data.recentActivities.length > 0 ? data.recentActivities.map((activity) => (
            <article key={activity.id} className="relative border-l border-gilt/45 pl-3">
              <span
                aria-hidden
                className="absolute -left-[3.5px] top-2 h-1.5 w-1.5 rotate-45 bg-gilt/70"
              />
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
              <SubjectLinks subjects={activity.subjects ?? []} onOpenEntity={onOpenEntity} onOpenGod={onOpenGod} />
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
  onOpenGod,
  onLoaded,
}: {
  worldId: string;
  timelineId: string;
  worldName: string;
  onOpenEntity: (id: string) => void;
  onOpenGod?: (id: string) => void;
  onLoaded?: (data: WorldActivityResponse) => void;
}) {
  const [data, setData] = useState<WorldActivityResponse>(EMPTY_ACTIVITY);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  /** 追踪替换二次确认：待确认的事件 id（原位替代 window.confirm） */
  const [confirmingEventId, setConfirmingEventId] = useState<string | null>(null);
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

  const toggleFocus = useCallback(async (eventId: string, confirmedReplacement = false) => {
    const mutation = buildFocusMutation({
      worldId,
      currentFocusedEventId: data.focusedEvent?.id ?? null,
      requestedEventId: eventId,
      confirmedReplacement,
    });
    if (mutation.kind === "confirm_replace") {
      // 已在追踪另一事件 → 在事件卡原位展开确认行，不再用原生弹窗
      setConfirmingEventId(eventId);
      return;
    }
    if (mutation.kind !== "request") return;

    setConfirmingEventId(null);
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
  if (error) {
    return (
      <p role="alert" className="text-sm text-cinnabar">
        {error}{" "}
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            void loadActivities().catch((reason: unknown) => {
              setFailure({
                key: requestKey,
                message: reason instanceof Error ? reason.message : String(reason),
              });
            });
          }}
          className="underline transition hover:text-ink"
        >
          重试
        </button>
      </p>
    );
  }
  return (
    <WorldActivityPanelView
      worldName={worldName}
      data={data}
      selectedEventId={selectedEventId}
      focusBusy={focusBusy}
      confirmingEventId={confirmingEventId}
      onOpenEntity={onOpenEntity}
      onOpenGod={onOpenGod}
      onSelectEvent={setSelectedEventId}
      onToggleFocus={(eventId) => { void toggleFocus(eventId); }}
      onConfirmReplace={(eventId) => { void toggleFocus(eventId, true); }}
      onCancelReplace={() => setConfirmingEventId(null)}
    />
  );
}
