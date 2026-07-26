"use client";

import { useMemo, useState } from "react";
import type { GodRow, ThemeCard } from "./types";
import { rankName, relationName, relationTone } from "./lexicon";
import { AbilityList } from "./AbilityList";
import { SaveMaterialVersionButton } from "@/components/materials/SaveMaterialVersionButton";
import { IconPicker, type IconAssignmentView } from "@/components/icons/IconPicker";
import { WorldIcon } from "@/components/icons/WorldIcon";

type IconContext = { worldId?: string; timelineId?: string };

function GodIconControl({ god, worldId, timelineId }: { god: GodRow } & IconContext) {
  const [assignment, setAssignment] = useState<IconAssignmentView | undefined>(god.iconAssignment);
  if (!assignment) return null;
  return (
    <span className="flex items-center gap-2">
      <WorldIcon icon={assignment.icon} size={24} />
      {worldId && timelineId && (
        <IconPicker
          worldId={worldId}
          timelineId={timelineId}
          subjectType="god"
          subjectId={god.id}
          value={assignment}
          onChange={setAssignment}
        />
      )}
    </span>
  );
}

/**
 * 神格页签：玩家神卡 + 主神列表卡 + 次要神一句话列表。
 * 议程未揭示 → .fog-text 残卷样式。
 */

function PlayerGodCard({ god, theme, worldId, timelineId }: { god: GodRow; theme: ThemeCard | null } & IconContext) {
  return (
    <section className="tome-plate tome-plate--corners p-5">
      <header className="flex items-baseline justify-between gap-3">
        <GodIconControl god={god} worldId={worldId} timelineId={timelineId} />
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
        <AbilityList abilities={god.abilities} kinds={["divine"]} allowMaterialSave worldId={worldId} timelineId={timelineId} />
      </div>
    </section>
  );
}

function MajorGodCard({ god, theme, worldId, timelineId }: { god: GodRow; theme: ThemeCard | null } & IconContext) {
  const rel = god.relations?.player;
  return (
    <li className="tome-plate p-4">
      <header className="flex items-baseline justify-between gap-3">
        <GodIconControl god={god} worldId={worldId} timelineId={timelineId} />
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
        <AbilityList abilities={god.abilities} kinds={["divine"]} allowMaterialSave worldId={worldId} timelineId={timelineId} />
      </div>

      {/* 议程区：揭示前为残卷 */}
      <div className="mt-3 border-t border-line pt-2 text-sm">
        <p className="mb-1 text-xs text-ink-faint">议程</p>
        {god.agenda ? (
          <div className="grid gap-1 text-ink-soft">
            {!god.agendaWorldVisible && (
              <p className="text-xs text-cinnabar/75">天外批注 · 世界内不可见</p>
            )}
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

const VOICE_LABELS: Record<string, string> = {
  address: "称呼习惯",
  verbalTics: "语癖",
  catchphrases: "常用语",
  neverSays: "绝不会说",
  style: "言语风格",
  cadence: "语调",
};

function readableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join("；");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => `${VOICE_LABELS[key] ?? key}：${readableValue(nested)}`)
      .join("；");
  }
  return "";
}

function CreatorGodDetail({
  god,
  gods,
  theme,
  worldId,
  timelineId,
}: {
  god: GodRow;
  gods: readonly GodRow[];
  theme: ThemeCard | null;
} & IconContext) {
  const godNames = new Map(gods.map((item) => [item.id, item.name]));
  const relations = Object.entries(god.relations ?? {}).filter(([, relation]) => relation);
  const voice = readableValue(god.voice);

  return (
    <article data-god-id={god.id} className="tome-plate tome-plate--corners p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <GodIconControl god={god} worldId={worldId} timelineId={timelineId} />
        <div>
          <h3 className="text-xl text-gilt" style={{ fontFamily: "var(--font-display)" }}>
            {god.name}
          </h3>
          <p className="mt-1 text-xs text-ink-faint">
            {god.tier === "major" ? "主神" : god.tier === "minor" ? "次神" : "玩家神"}
            {" · "}
            {rankName(theme, god.rank)}
          </p>
        </div>
        <SaveMaterialVersionButton sourceType="god" sourceId={god.id} compact />
      </header>

      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-xs text-ink-faint">领域</dt>
          <dd className="text-ink-soft">{god.domains.length ? god.domains.join(" · ") : "未载"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">信仰范围</dt>
          <dd className="text-ink-soft">{god.faithScope || "未形成稳定信仰"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">性情与形象</dt>
          <dd className="whitespace-pre-wrap text-ink-soft">
            {god.persona?.text || god.persona?.origin || god.persona?.situation || "尚未载明"}
          </dd>
        </div>
        {voice && (
          <div>
            <dt className="text-xs text-ink-faint">言语风格</dt>
            <dd className="text-ink-soft">{voice}</dd>
          </div>
        )}
      </dl>

      <section className="mt-4 border-t border-line pt-3">
        <h4 className="letterpress mb-2">诸神关系</h4>
        {relations.length ? (
          <ul className="grid gap-2 text-sm">
            {relations.map(([targetId, relation]) => (
              <li key={targetId} className="rounded border border-line/70 px-3 py-2 text-ink-soft">
                <span className={relationTone(relation?.label)}>
                  {godNames.get(targetId) ?? (targetId === "player" ? "玩家神" : targetId)}
                </span>
                <span className="mx-1.5 text-ink-faint">·</span>
                <span>{relationName(relation?.label)}</span>
                {relation?.note && <span>：{relation.note}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="fog-text text-sm">尚无已载关系</p>
        )}
      </section>

      <section className="mt-4 border-t border-line pt-3">
        <h4 className="letterpress mb-2">神权与能力</h4>
        <AbilityList abilities={god.abilities} kinds={["divine"]} allowMaterialSave worldId={worldId} timelineId={timelineId} />
      </section>

      <section className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="letterpress">幕后议程</h4>
          {!god.agendaWorldVisible && god.agenda && (
            <span className="text-[10px] text-cinnabar/75">天外批注 · 世界内不可见</span>
          )}
        </div>
        {god.agenda ? (
          <dl className="grid gap-2 text-sm text-ink-soft">
            {god.agenda.longTermGoal && <div><dt className="text-xs text-ink-faint">长愿</dt><dd>{god.agenda.longTermGoal}</dd></div>}
            {(god.agenda.shortTermGoals?.length ?? 0) > 0 && <div><dt className="text-xs text-ink-faint">近谋</dt><dd>{god.agenda.shortTermGoals!.join("；")}</dd></div>}
            {god.agenda.methods && <div><dt className="text-xs text-ink-faint">手段</dt><dd>{god.agenda.methods}</dd></div>}
            {(god.agenda.schemes?.length ?? 0) > 0 && <div><dt className="text-xs text-ink-faint">密谋</dt><dd>{god.agenda.schemes!.join("；")}</dd></div>}
            {god.agenda.stanceToPlayer?.motive && <div><dt className="text-xs text-ink-faint">对创世主</dt><dd>{god.agenda.stanceToPlayer.motive}</dd></div>}
          </dl>
        ) : (
          <p className="fog-text text-sm">尚无已载议程</p>
        )}
      </section>
    </article>
  );
}

export function GodPanel({
  gods,
  theme,
  mode = "pantheon",
  initialGodId = null,
  worldId,
  timelineId,
}: {
  gods: GodRow[];
  theme: ThemeCard | null;
  mode?: "pantheon" | "creator";
  initialGodId?: string | null;
} & IconContext) {
  const initial = initialGodId && gods.some((god) => god.id === initialGodId)
    ? initialGodId
    : gods[0]?.id ?? null;
  const [selectedGodId, setSelectedGodId] = useState(initial);
  const selectedGod = useMemo(
    () => gods.find((god) => god.id === selectedGodId) ?? gods[0] ?? null,
    [gods, selectedGodId],
  );

  if (mode === "creator") {
    return (
      <div className="grid gap-5">
        <div>
          <h3 className="illuminated-header text-base">
            <span className="illuminated-header__glyph" aria-hidden="true">
              ✦
            </span>
            诸神录
          </h3>
          <p className="mt-1.5 text-center text-xs text-ink-faint">创世主可查看诸神的完整身份、关系、能力与幕后议程。</p>
        </div>
        {gods.length ? (
          <>
            <div className="flex flex-wrap gap-2" aria-label="选择神明">
              {gods.map((god) => (
                <button
                  key={god.id}
                  type="button"
                  data-god-id={god.id}
                  onClick={() => setSelectedGodId(god.id)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition ${
                    selectedGod?.id === god.id
                      ? "border-gilt bg-gilt/10 text-gilt shadow-[0_0_0.6rem_var(--gilt-glow),inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_70%,transparent)]"
                      : "border-line text-ink-soft hover:border-gilt/60 hover:text-gilt"
                  }`}
                >
                  {god.name}
                </button>
              ))}
            </div>
            {selectedGod && <CreatorGodDetail god={selectedGod} gods={gods} theme={theme} worldId={worldId} timelineId={timelineId} />}
          </>
        ) : (
          <p className="fog-text text-sm">此世尚无神明入录</p>
        )}
      </div>
    );
  }

  const player = gods.find((g) => g.isPlayer);
  const majors = gods.filter((g) => g.tier === "major");
  const minors = gods.filter((g) => g.tier === "minor");

  return (
    <div className="grid gap-6">
      {player && (
        <div>
          <h3 className="letterpress mb-2">本尊神格</h3>
          <PlayerGodCard god={player} theme={theme} worldId={worldId} timelineId={timelineId} />
        </div>
      )}

      {majors.length > 0 && (
        <div>
          <h3 className="letterpress mb-2">主神席</h3>
          <ul className="grid gap-3">
            {majors.map((g) => (
              <MajorGodCard key={g.id} god={g} theme={theme} worldId={worldId} timelineId={timelineId} />
            ))}
          </ul>
        </div>
      )}

      {minors.length > 0 && (
        <div>
          <h3 className="letterpress mb-2">次要神祇</h3>
          <ul className="grid gap-1.5 text-sm">
            {minors.map((g) => (
              <li
                key={g.id}
                className="rounded-md border border-line/70 bg-paper-raised/45 p-2.5 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--paper-raised)_75%,transparent)] [background-image:var(--fiber-noise)]"
              >
                <div className="flex gap-2">
                  <GodIconControl god={g} worldId={worldId} timelineId={timelineId} />
                  <span className="shrink-0 text-ink">{g.name}</span>
                  <span className="text-ink-faint">{g.persona?.text ?? ""}</span>
                </div>
                {g.abilities.length > 0 && (
                  <div className="mt-2 border-t border-line/70 pt-2">
                    <AbilityList abilities={g.abilities} kinds={["divine"]} worldId={worldId} timelineId={timelineId} />
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
