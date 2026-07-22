"use client";

import { useState } from "react";
import type {
  CreatorAvatar,
  GodRow,
  RecentRewrite,
  TimelineInfo,
} from "./types";

const EMPTY_AVATAR = { name: "", identity: "", appearance: "" };

export async function finishAvatarCreation(
  create: () => Promise<boolean>,
  reset: () => void,
): Promise<boolean> {
  const succeeded = await create();
  if (succeeded) reset();
  return succeeded;
}

export function CreatorViewPanel({
  worldId,
  timeline,
  gods,
  avatars,
  recentRewrite,
  busy,
  onChanged,
}: {
  worldId: string;
  timeline: TimelineInfo;
  gods: GodRow[];
  avatars: CreatorAvatar[];
  recentRewrite: RecentRewrite | null;
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [showAvatarForm, setShowAvatarForm] = useState(false);
  const [avatar, setAvatar] = useState(EMPTY_AVATAR);

  async function act(body: Record<string, unknown>): Promise<boolean> {
    if (busy || acting) return false;
    setActing(true);
    setError(null);
    try {
      const response = await fetch(`/api/worlds/${worldId}/observer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? "天外视界未能更新");
      }
      await onChanged();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setActing(false);
    }
  }

  const observer = timeline.observerState;
  const activeAvatar = avatars.find((item) => item.id === observer.activeAvatarId) ?? null;
  const focusLabel = observer.focusType === "world"
    ? "整个世界"
    : observer.focusType === "god"
      ? gods.find((god) => god.id === observer.focusId)?.name ?? "未知神明"
      : avatars.find((item) => item.id === observer.focusId)?.name
        ?? `${observer.focusType} · ${observer.focusId ?? "未指定"}`;

  return (
    <section className="space-y-5" aria-label="天外视界">
      <div className="rounded-lg border border-gilt/30 bg-gilt/5 p-4">
        <p className="text-xs tracking-[0.25em] text-gilt">天外视界</p>
        <h3 className="mt-1 text-xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
          {timeline.branchName}
        </h3>
        {timeline.branchSummary && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{timeline.branchSummary}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-ink-faint">观察焦点</dt><dd className="text-ink">{focusLabel}</dd></div>
          <div><dt className="text-ink-faint">世界时间</dt><dd className="text-ink">{observer.timeLabel || "未标记"}</dd></div>
          <div><dt className="text-ink-faint">观察方式</dt><dd className="text-ink">{observer.viewpoint === "omniscient" ? "全知观察" : "迷雾观察"}</dd></div>
          <div><dt className="text-ink-faint">活动化身</dt><dd className="text-ink">{activeAvatar?.name ?? "世界之外"}</dd></div>
        </dl>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-ink">观察方式</h4>
        <div className="flex gap-2">
          {(["omniscient", "limited"] as const).map((viewpoint) => (
            <button
              key={viewpoint}
              type="button"
              disabled={busy || acting || observer.viewpoint === viewpoint}
              onClick={() => void act({ action: "set_viewpoint", viewpoint })}
              className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft transition hover:border-gilt hover:text-gilt disabled:opacity-40"
            >
              {viewpoint === "omniscient" ? "全知观察" : "迷雾观察"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-ink">观察焦点</h4>
        <button
          type="button"
          disabled={busy || acting || observer.focusType === "world"}
          onClick={() => void act({ action: "set_focus", focusType: "world", focusId: null })}
          className="mr-2 rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:text-gilt disabled:opacity-40"
        >
          俯瞰全界
        </button>
        {gods.map((god) => (
          <button
            key={god.id}
            type="button"
            disabled={busy || acting || observer.focusId === god.id}
            onClick={() => void act({ action: "set_focus", focusType: "god", focusId: god.id })}
            className="mr-2 mt-2 rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:text-gilt disabled:opacity-40"
          >
            {god.name}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-ink">创世主化身</h4>
          <button type="button" onClick={() => setShowAvatarForm((value) => !value)} className="text-sm text-gilt hover:underline">
            {showAvatarForm ? "收起" : "创造化身"}
          </button>
        </div>
        {showAvatarForm && (
          <form
            className="space-y-2 rounded border border-line bg-paper-sunken p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!avatar.name.trim()) return;
              void finishAvatarCreation(() => act({
                action: "create_avatar",
                name: avatar.name.trim(),
                identity: avatar.identity.trim(),
                appearance: avatar.appearance.trim(),
                raceId: null,
                abilities: [],
              }), () => {
                setAvatar(EMPTY_AVATAR);
                setShowAvatarForm(false);
              });
            }}
          >
            <input aria-label="化身名" value={avatar.name} onChange={(event) => setAvatar({ ...avatar, name: event.target.value })} placeholder="化身名" className="w-full rounded border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-gilt" />
            <textarea aria-label="化身身份" value={avatar.identity} onChange={(event) => setAvatar({ ...avatar, identity: event.target.value })} placeholder="身份与来历" className="w-full rounded border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-gilt" />
            <textarea aria-label="化身外貌" value={avatar.appearance} onChange={(event) => setAvatar({ ...avatar, appearance: event.target.value })} placeholder="外貌" className="w-full rounded border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-gilt" />
            <button disabled={busy || acting || !avatar.name.trim()} className="rounded border border-gilt/50 px-4 py-1.5 text-sm text-gilt disabled:opacity-40">显化</button>
          </form>
        )}
        {avatars.length === 0 ? (
          <p className="text-sm text-ink-faint">尚未显化任何化身。</p>
        ) : avatars.map((item) => {
          const active = observer.activeAvatarId === item.id;
          const dormant = item.heat === "dormant";
          return (
            <div key={item.id} className="rounded border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-ink">{item.name}</p><p className="text-xs text-ink-faint">{dormant ? "已收回" : active ? "正在世间" : "可进入"}</p></div>
                <div className="flex gap-2 text-sm">
                  {active ? (
                    <button disabled={busy || acting} onClick={() => void act({ action: "exit_avatar" })} className="text-gilt disabled:opacity-40">离开</button>
                  ) : !dormant && (
                    <button disabled={busy || acting} onClick={() => void act({ action: "enter_avatar", avatarId: item.id })} className="text-gilt disabled:opacity-40">进入</button>
                  )}
                  {!dormant && <button disabled={busy || acting} onClick={() => void act({ action: "withdraw_avatar", avatarId: item.id })} className="text-cinnabar disabled:opacity-40">收回</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {recentRewrite && (
        <div className="border-t border-line pt-4">
          <p className="text-xs text-ink-faint">最近敕令</p>
          <blockquote className="mt-1 text-sm leading-relaxed text-gilt">{recentRewrite.decree}</blockquote>
          {recentRewrite.summary && <p className="mt-1 text-sm text-ink-soft">{recentRewrite.summary}</p>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-cinnabar">{error}</p>}
    </section>
  );
}
