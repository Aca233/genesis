"use client";

import type { GodRow, ThemeCard } from "./types";
import { rankName, relationName, relationTone } from "./lexicon";
import { AbilityList } from "./AbilityList";
import { SaveMaterialVersionButton } from "@/components/materials/SaveMaterialVersionButton";

/**
 * 神格页签：玩家神卡 + 主神列表卡 + 次要神一句话列表。
 * 议程未揭示 → .fog-text 残卷样式。
 */

function PlayerGodCard({ god, theme }: { god: GodRow; theme: ThemeCard | null }) {
  return (
    <section className="rounded-lg border border-gilt/40 bg-paper-raised p-5">
      <header className="flex items-baseline justify-between gap-3">
        <h3
          className="text-xl text-gilt"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {god.name}
        </h3>
        <span className="shrink-0 rounded border border-gilt/50 px-2 py-0.5 text-xs text-gilt">
          {rankName(theme, god.rank)}
        </span>
        <SaveMaterialVersionButton sourceType="god" sourceId={god.id} compact />
      </header>

      <dl className="mt-3 grid gap-2 text-sm">
        {god.domains.length > 0 && (
          <div>
            <dt className="text-xs text-ink-faint">领域</dt>
            <dd className="text-ink-soft">{god.domains.join(" · ")}</dd>
          </div>
        )}
        {god.faithScope && (
          <div>
            <dt className="text-xs text-ink-faint">信仰范围</dt>
            <dd className="text-ink-soft">{god.faithScope}</dd>
          </div>
        )}
        {god.persona?.origin && (
          <div>
            <dt className="text-xs text-ink-faint">出身</dt>
            <dd className="text-ink-soft">{god.persona.origin}</dd>
          </div>
        )}
        {god.persona?.situation && (
          <div>
            <dt className="text-xs text-ink-faint">处境</dt>
            <dd className="text-ink-soft">{god.persona.situation}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 border-t border-gilt/25 pt-3">
        <AbilityList abilities={god.abilities} kinds={["divine"]} allowMaterialSave />
      </div>
    </section>
  );
}

function MajorGodCard({ god, theme }: { god: GodRow; theme: ThemeCard | null }) {
  const rel = god.relations?.player;
  return (
    <li className="rounded-lg border border-line bg-paper-raised p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h4 className="text-lg text-ink" style={{ fontFamily: "var(--font-display)" }}>
          {god.name}
        </h4>
        <span className="flex shrink-0 items-center gap-1.5 text-xs">
          <span className="rounded border border-line px-1.5 py-0.5 text-ink-faint">
            {rankName(theme, god.rank)}
          </span>
          <span className={`rounded border px-1.5 py-0.5 ${relationTone(rel?.label)}`}>
            {relationName(rel?.label)}
          </span>
        </span>
        <SaveMaterialVersionButton sourceType="god" sourceId={god.id} compact />
      </header>

      {god.domains.length > 0 && (
        <p className="mt-1 text-xs text-ink-faint">{god.domains.join(" · ")}</p>
      )}
      {rel?.note && <p className="mt-2 text-sm text-ink-soft">{rel.note}</p>}
      {god.persona?.text && (
        <p className="mt-1 line-clamp-3 text-sm text-ink-soft">{god.persona.text}</p>
      )}

      <div className="mt-3 border-t border-line pt-2">
        <AbilityList abilities={god.abilities} kinds={["divine"]} allowMaterialSave />
      </div>

      {/* 议程区：揭示前为残卷 */}
      <div className="mt-3 border-t border-line pt-2 text-sm">
        <p className="mb-1 text-xs text-ink-faint">议程</p>
        {god.agendaRevealed && god.agenda ? (
          <div className="grid gap-1 text-ink-soft">
            {god.agenda.longTermGoal && <p>长愿：{god.agenda.longTermGoal}</p>}
            {(god.agenda.shortTermGoals?.length ?? 0) > 0 && (
              <p>近谋：{god.agenda.shortTermGoals!.join("；")}</p>
            )}
            {god.agenda.stanceToPlayer?.motive && (
              <p>对你：{god.agenda.stanceToPlayer.motive}</p>
            )}
          </div>
        ) : (
          <p className="fog-text">此处经卷残缺——天机未泄</p>
        )}
      </div>
    </li>
  );
}

export function GodPanel({
  gods,
  theme,
}: {
  gods: GodRow[];
  theme: ThemeCard | null;
}) {
  const player = gods.find((g) => g.isPlayer);
  const majors = gods.filter((g) => g.tier === "major");
  const minors = gods.filter((g) => g.tier === "minor");

  return (
    <div className="grid gap-6">
      {player && (
        <div>
          <h3 className="mb-2 text-xs tracking-widest text-ink-faint">本尊神格</h3>
          <PlayerGodCard god={player} theme={theme} />
        </div>
      )}

      {majors.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs tracking-widest text-ink-faint">主神席</h3>
          <ul className="grid gap-3">
            {majors.map((g) => (
              <MajorGodCard key={g.id} god={g} theme={theme} />
            ))}
          </ul>
        </div>
      )}

      {minors.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs tracking-widest text-ink-faint">次要神祇</h3>
          <ul className="grid gap-1.5 text-sm">
            {minors.map((g) => (
              <li key={g.id} className="rounded-md border border-line/70 p-2.5">
                <div className="flex gap-2">
                  <span className="shrink-0 text-ink">{g.name}</span>
                  <span className="text-ink-faint">{g.persona?.text ?? ""}</span>
                </div>
                {g.abilities.length > 0 && (
                  <div className="mt-2 border-t border-line/70 pt-2">
                    <AbilityList abilities={g.abilities} kinds={["divine"]} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
