"use client";

import type { WorldInfo } from "./types";

/**
 * 设定集页签：宇宙论四节 / 融合公理 / 纪元冲突 / 风格卡。
 * hiddenCurrents 恒以残卷雾呈现，不显示内容（迷雾）。
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tome-plate p-4">
      <h3 className="illuminated-header mb-3 text-base">
        <span className="illuminated-header__glyph" aria-hidden="true">
          ✦
        </span>
        {title}
      </h3>
      <div className="grid gap-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

function Item({ label, text }: { label: string; text?: string | null }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export function LorePanel({ world }: { world: WorldInfo }) {
  const { cosmology, fusionAxiom, epochConflict, styleCard } = world;

  return (
    <div className="grid gap-4">
      {/* 宇宙论 */}
      {cosmology ? (
        <Section title="宇宙论">
          <Item label="起源" text={cosmology.origin} />
          <Item label="力量体系" text={cosmology.powerSystem} />
          <Item label="法则" text={cosmology.laws} />
          <Item label="神之存在" text={cosmology.divinity} />
        </Section>
      ) : (
        <p className="fog-text text-center">宇宙论经卷佚失。</p>
      )}

      {/* 融合公理（仅多IP融合时有） */}
      {fusionAxiom && (
        <Section title="融合公理">
          {(fusionAxiom.sourceIps?.length ?? 0) > 0 && (
            <p className="text-xs text-ink-faint">
              缝合诸界：{fusionAxiom.sourceIps!.join(" × ")}
            </p>
          )}
          {(fusionAxiom.axioms?.length ?? 0) > 0 && (
            <ol className="grid list-decimal gap-1 pl-5">
              {fusionAxiom.axioms!.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          )}
          <Item label="力量对标" text={fusionAxiom.powerMapping} />
          <Item label="冲突裁决" text={fusionAxiom.conflictRule} />
        </Section>
      )}

      {/* 纪元冲突 */}
      <Section
        title={
          epochConflict?.epochName ? `纪元冲突 · ${epochConflict.epochName}` : "纪元冲突"
        }
      >
        {epochConflict ? (
          <>
            {epochConflict.yearLabel && (
              <p className="text-xs text-gilt">{epochConflict.yearLabel}</p>
            )}
            {(epochConflict.overtConflicts?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs text-ink-faint">时代矛盾</p>
                <ul className="grid list-disc gap-1 pl-5">
                  {epochConflict.overtConflicts!.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {(epochConflict.hiddenCurrents?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs text-ink-faint">暗流</p>
                <ul className="grid gap-1 pl-1">
                  {epochConflict.hiddenCurrents!.map((_, i) => (
                    <li key={i} className="fog-text">
                      ▓▓▓（暗流涌动，未可知）
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="fog-text">此卷残缺——时代的暗涌尚未誊录。</p>
        )}
      </Section>

      {/* 风格卡 */}
      {styleCard && (
        <Section title="叙事风格">
          {styleCard.presetName && (
            <p className="text-gilt">{styleCard.presetName}</p>
          )}
          <Item label="文风细则" text={styleCard.toneNotes} />
        </Section>
      )}
    </div>
  );
}
