import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  WorldActivityPanelView,
  type WorldActivityResponse,
} from "./WorldActivityPanel";

const data: WorldActivityResponse = {
  focusedEvent: {
    id: "event-1",
    kind: "war",
    title: "北境烽烟",
    summary: "两国在边境集结。",
    phase: "escalating",
    visibility: "public",
    participantIds: ["entity-1"],
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    resolvedAt: null,
  },
  importantEvents: [
    {
      id: "event-1",
      kind: "war",
      title: "北境烽烟",
      summary: "两国在边境集结。",
      phase: "escalating",
      visibility: "public",
      participantIds: ["entity-1"],
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
      resolvedAt: null,
    },
  ],
  recentActivities: [
    {
      id: "activity-1",
      eventId: "event-1",
      recordType: "event_progress",
      kind: "war",
      text: "北境军团越过霜河。",
      visibility: "public",
      actorId: "entity-1",
      targetIds: [],
      subjectIds: ["entity-1"],
      eraLabel: "星火纪元",
      timeLabel: "第七年·霜月",
      createdAt: "2026-07-23T03:00:00.000Z",
    },
    {
      id: "activity-hidden",
      eventId: null,
      recordType: "action",
      kind: "conspiracy",
      text: "摄政者藏起了密约。",
      visibility: "hidden",
      actorId: null,
      targetIds: [],
      subjectIds: [],
      eraLabel: "星火纪元",
      timeLabel: "第七年·霜月",
      createdAt: "2026-07-23T02:00:00.000Z",
      knowledgeLabel: "世界内尚未知晓",
    },
  ],
  nextCursor: null,
};

describe("WorldActivityPanelView", () => {
  it("renders focused, important and recent groups with local object targets", () => {
    const html = renderToStaticMarkup(createElement(WorldActivityPanelView, {
      worldName: "烬海",
      data,
      selectedEventId: null,
      onOpenEntity: vi.fn(),
      onSelectEvent: vi.fn(),
    }));
    expect(html).toContain("当前关注");
    expect(html).toContain("重要事件");
    expect(html).toContain("近期动态");
    expect(html).toContain("烬海 · 星火纪元 · 第七年·霜月");
    expect(html).toContain('data-entity-id="entity-1"');
    expect(html).toContain('data-event-id="event-1"');
    expect(html).toContain('data-focus-event-id="event-1"');
    expect(html).toContain("取消追踪");
    expect(html).toContain("世界内尚未知晓");
    expect(html).not.toContain("/api/chat");
    expect(html).not.toContain("章节");
  });

  it("shows locally selected event details without requesting narration", () => {
    const html = renderToStaticMarkup(createElement(WorldActivityPanelView, {
      worldName: "烬海",
      data,
      selectedEventId: "event-1",
      onOpenEntity: vi.fn(),
      onSelectEvent: vi.fn(),
    }));
    expect(html).toContain("事件详情");
    expect(html).toContain("两国在边境集结");
    expect(html).toContain('data-entity-id="entity-1"');
  });

  it("offers tracking for an unresolved event when none is focused", () => {
    const html = renderToStaticMarkup(createElement(WorldActivityPanelView, {
      worldName: "烬海",
      data: { ...data, focusedEvent: null },
      selectedEventId: null,
      onOpenEntity: vi.fn(),
      onSelectEvent: vi.fn(),
      onToggleFocus: vi.fn(),
    }));
    expect(html).toContain("追踪事件");
    expect(html).not.toContain("取消追踪");
  });

  it("renders defensive empty states", () => {
    const html = renderToStaticMarkup(createElement(WorldActivityPanelView, {
      worldName: "烬海",
      data: {
        focusedEvent: null,
        importantEvents: [],
        recentActivities: [],
        nextCursor: null,
      },
      selectedEventId: null,
      onOpenEntity: vi.fn(),
      onSelectEvent: vi.fn(),
    }));
    expect(html).toContain("尚未追踪重要事件");
    expect(html).toContain("世界仍在酝酿新的动向");
  });
});
