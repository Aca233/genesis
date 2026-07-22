"use client";

import { useMemo, useState } from "react";
import type { GodRelation, GodRow, ThemeCard } from "./types";
import { rankName, relationName, relationTone } from "./lexicon";

/**
 * 神谱星图：手绘天文图风格（docs/01 §9.4）。
 * 玩家神居中为北极星，主神按位阶定轨距成星座，次神散作外环微星；
 * 关系连线：敌对朱红 / 盟友烫金 / 竞争虚线 / 未知雾淡。
 * 纯确定性布局（名字散列定相位），无力导模拟。
 */

const RANK_ORBIT: Record<string, number> = {
  sovereign: 88,
  exalted: 108,
  ascended: 128,
  nascent: 148,
  slumbering: 162,
  ember: 174,
  fallen: 184,
};

function hashOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

type Star = { god: GodRow; x: number; y: number; r: number };
type StarRelation = { source: Star; target: Star; relation: GodRelation };
type GodRelationDetail = {
  targetId: string;
  targetName: string;
  label: string;
  note?: string;
};

function relationEntries(god: GodRow): Array<[string, GodRelation]> {
  return Object.entries(god.relations ?? {}).flatMap(([targetId, relation]) =>
    targetId === "player" || !relation ? [] : [[targetId, relation]],
  );
}

export function godRelationsForDetail(
  god: GodRow,
  gods: readonly GodRow[],
  player: GodRow | null,
): GodRelationDetail[] {
  if (player && god.id !== player.id) {
    const relation = god.relations?.player;
    return relation
      ? [{
        targetId: player.id,
        targetName: player.name,
        label: relation.label,
        note: relation.note,
      }]
      : [];
  }

  const byId = new Map(gods.map((item) => [item.id, item]));
  return relationEntries(god).flatMap(([targetId, relation]) => {
    const target = byId.get(targetId);
    return target
      ? [{
        targetId,
        targetName: target.name,
        label: relation.label,
        note: relation.note,
      }]
      : [];
  });
}

function relationStroke(label: string | undefined): {
  stroke: string;
  dash?: string;
  opacity: number;
} {
  switch (label) {
    case "enemy":
      return { stroke: "var(--cinnabar)", opacity: 0.65 };
    case "ally":
      return { stroke: "var(--gilt)", opacity: 0.7 };
    case "vassal":
      return { stroke: "var(--gilt)", dash: "6 3", opacity: 0.5 };
    case "rival":
      return { stroke: "var(--cinnabar)", dash: "4 4", opacity: 0.4 };
    case "neutral":
      return { stroke: "var(--ink-faint)", opacity: 0.3 };
    default:
      return { stroke: "var(--ink-faint)", dash: "2 5", opacity: 0.22 };
  }
}

export function StarmapPanel({
  gods,
  theme,
}: {
  gods: GodRow[];
  theme: ThemeCard | null;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);

  const { player, stars, relations } = useMemo(() => {
    const player = gods.find((g) => g.isPlayer) ?? null;
    const majors = gods.filter((g) => g.tier === "major");
    const minors = gods.filter((g) => g.tier === "minor");

    const CX = 210;
    const CY = 210;
    const stars: Star[] = [];

    // 主神：位阶定轨距，名字散列微扰均匀相位
    majors.forEach((g, i) => {
      const base = (i / Math.max(majors.length, 1)) * 2 * Math.PI;
      const jitter = ((hashOf(g.name) % 1000) / 1000 - 0.5) * 0.5;
      const a = base + jitter;
      const orbit = RANK_ORBIT[g.rank] ?? 130;
      stars.push({
        god: g,
        x: CX + orbit * Math.sin(a),
        y: CY - orbit * Math.cos(a),
        r: g.rank === "sovereign" ? 7 : g.rank === "exalted" ? 6 : 5,
      });
    });
    // 次神：外环微星
    minors.forEach((g, i) => {
      const a =
        (i / Math.max(minors.length, 1)) * 2 * Math.PI +
        ((hashOf(g.name) % 628) / 100) * 0.15 +
        0.35;
      const orbit = 190 + (hashOf(g.name) % 14);
      stars.push({
        god: g,
        x: CX + orbit * Math.sin(a),
        y: CY - orbit * Math.cos(a),
        r: 2.5,
      });
    });
    const starById = new Map(stars.map((star) => [star.god.id, star]));
    const relations: StarRelation[] = [];
    for (const source of stars) {
      for (const [targetId, relation] of relationEntries(source.god)) {
        const target = starById.get(targetId);
        if (!target) continue;
        relations.push({ source, target, relation });
      }
    }
    return { player, stars, relations };
  }, [gods]);

  const focused = focusId ? gods.find((g) => g.id === focusId) : null;
  const focusedRelations = focused
    ? godRelationsForDetail(focused, gods, player)
    : [];
  const CX = 210;
  const CY = 210;

  return (
    <div className="grid gap-4">
      <svg viewBox="0 0 420 420" className="w-full select-none">
        {/* 天球经纬（手绘感虚线圈） */}
        {[88, 128, 174].map((r) => (
          <circle
            key={r}
            cx={CX}
            cy={CY}
            r={r}
            fill="none"
            stroke="var(--line)"
            strokeWidth="0.8"
            strokeDasharray="3 6"
          />
        ))}
        <circle
          cx={CX}
          cy={CY}
          r={198}
          fill="none"
          stroke="var(--gilt)"
          strokeWidth="1"
          opacity="0.35"
        />
        {/* 十字准线 */}
        <line x1={CX} y1={16} x2={CX} y2={404} stroke="var(--line)" strokeWidth="0.5" opacity="0.5" />
        <line x1={16} y1={CY} x2={404} y2={CY} stroke="var(--line)" strokeWidth="0.5" opacity="0.5" />

        {/* 关系连线：玩家 ↔ 主神（relations.player 是「对玩家」的态度） */}
        {player &&
          stars
            .filter((s) => s.god.tier === "major")
            .map((s) => {
              const rel = s.god.relations?.player;
              const st = relationStroke(rel?.label);
              const dim = focusId && focusId !== s.god.id;
              return (
                <line
                  key={`rel-${s.god.id}`}
                  x1={CX}
                  y1={CY}
                  x2={s.x}
                  y2={s.y}
                  stroke={st.stroke}
                  strokeWidth="1.2"
                  strokeDasharray={st.dash}
                  opacity={dim ? st.opacity * 0.25 : st.opacity}
                />
              );
            })}

        {/* Creator 世界没有玩家神，按真实 God ID 绘制诸神之间的关系。 */}
        {!player && relations.map(({ source, target, relation }) => {
          const st = relationStroke(relation.label);
          const dim = focusId && focusId !== source.god.id && focusId !== target.god.id;
          return (
            <line
              key={`rel-${source.god.id}-${target.god.id}`}
              data-relation-source={source.god.id}
              data-relation-target={target.god.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={st.stroke}
              strokeWidth="1.2"
              strokeDasharray={st.dash}
              opacity={dim ? st.opacity * 0.25 : st.opacity}
            />
          );
        })}

        {/* 玩家神：北极星（金芒十字） */}
        {player && (
          <g
            className="cursor-pointer"
            onClick={() => setFocusId(focusId === player.id ? null : player.id)}
          >
            <line x1={CX - 13} y1={CY} x2={CX + 13} y2={CY} stroke="var(--gilt)" strokeWidth="1" opacity="0.8" />
            <line x1={CX} y1={CY - 13} x2={CX} y2={CY + 13} stroke="var(--gilt)" strokeWidth="1" opacity="0.8" />
            <circle cx={CX} cy={CY} r="6.5" fill="var(--gilt)" />
            <circle cx={CX} cy={CY} r="10" fill="none" stroke="var(--gilt)" strokeWidth="0.8" opacity="0.5" />
            <text
              x={CX}
              y={CY + 26}
              textAnchor="middle"
              className="fill-[var(--gilt)] text-[13px]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {player.name}
            </text>
          </g>
        )}

        {/* 诸神星辰 */}
        {stars.map((s) => {
          const isMinor = s.god.tier === "minor";
          const isFocus = focusId === s.god.id;
          const dim = focusId && !isFocus;
          return (
            <g
              key={s.god.id}
              className="cursor-pointer"
              opacity={dim ? 0.35 : 1}
              onClick={() => setFocusId(isFocus ? null : s.god.id)}
            >
              <circle
                cx={s.x}
                cy={s.y}
                r={s.r}
                fill={isMinor ? "var(--ink-faint)" : "var(--ink-soft)"}
              />
              {isFocus && (
                <circle cx={s.x} cy={s.y} r={s.r + 5} fill="none" stroke="var(--gilt)" strokeWidth="1" />
              )}
              {!isMinor && (
                <text
                  x={s.x}
                  y={s.y - s.r - 6}
                  textAnchor="middle"
                  className="fill-[var(--ink-soft)] text-[11px]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {s.god.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* 图例 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-5 bg-cinnabar/70" /> 敌对
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-5 bg-gilt/80" /> 盟友
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-5 border-t border-dashed border-cinnabar/60" /> 竞争
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-px w-5 border-t border-dotted border-ink-faint" /> 未知
        </span>
      </div>

      {/* 星辰快览 */}
      {focused && (
        <div className="rounded-lg border border-line bg-paper-raised p-4 text-sm">
          <header className="flex items-baseline justify-between gap-3">
            <h4 className="text-base text-ink" style={{ fontFamily: "var(--font-display)" }}>
              {focused.name}
            </h4>
            <span className="flex shrink-0 items-center gap-1.5 text-xs">
              <span className="rounded border border-line px-1.5 py-0.5 text-ink-faint">
                {rankName(theme, focused.rank)}
              </span>
              {!focused.isPlayer && player && (
                <span
                  className={`rounded border px-1.5 py-0.5 ${relationTone(focused.relations?.player?.label)}`}
                >
                  {relationName(focused.relations?.player?.label)}
                </span>
              )}
            </span>
          </header>
          {focused.domains.length > 0 && (
            <p className="mt-1 text-xs text-ink-faint">{focused.domains.join(" · ")}</p>
          )}
          {player && focused.relations?.player?.note && (
            <p className="mt-2 text-ink-soft">{focused.relations.player.note}</p>
          )}
          {!player && focusedRelations.length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs text-ink-soft">
              {focusedRelations.map((relation) => (
                <li key={relation.targetId}>
                  <span className={relationTone(relation.label)}>
                    {relationName(relation.label)} · {relation.targetName}
                  </span>
                  {relation.note && <span>：{relation.note}</span>}
                </li>
              ))}
            </ul>
          )}
          {!focused.isPlayer && focused.agenda && !focused.agendaWorldVisible ? (
            <div className="mt-2 border-l-2 border-cinnabar/40 pl-2 text-xs text-ink-soft">
              <p className="text-cinnabar/75">天外批注 · 世界内不可见</p>
              {focused.agenda.longTermGoal && <p>长愿：{focused.agenda.longTermGoal}</p>}
              {(focused.agenda.shortTermGoals?.length ?? 0) > 0 && (
                <p>近谋：{focused.agenda.shortTermGoals!.join("；")}</p>
              )}
            </div>
          ) : !focused.isPlayer && !focused.agendaRevealed ? (
            <p className="fog-text mt-2 text-xs">其意难测——天机未泄。</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
