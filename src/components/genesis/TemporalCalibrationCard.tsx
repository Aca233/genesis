import type { ReactNode } from "react";
import type { TemporalAnchorCard } from "@/lib/cards/schemas";

/**
 * 时间校准卡（只读，时间一致设计稿 §13 阶段 1）：
 * 卡组携带 temporalAnchor 时置于卡片墙顶端，陈列来源、锚点、原作截止点、
 * 置信度与假设清单、将临之事条数。无编辑与重掷入口——修改时间锚点 =
 * 以同一神谕 + 修改后锚点重新创世（诚实计费，零新机制）。
 */

const BASIS_LABELS = {
  original: "原创世界",
  single_ip: "单一原作",
  multi_ip: "多原作融合",
} as const;

const ANCHOR_TYPE_LABELS = {
  explicit_date: "明确日期",
  explicit_event: "明确事件",
  identity_period: "身份时期",
  main_story_opening: "主线开幕前夕",
  original_present: "原创当下",
} as const;

const SELECTION_SOURCE_LABELS = {
  player_explicit: "玩家明示",
  lorebook: "资料推断",
  model_inferred: "模型推断",
} as const;

const CONFIDENCE_LABELS = {
  high: "高",
  medium: "中",
  low: "低",
} as const;

/** 铅印小签 + 内容行 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1">
      <span className="letterpress text-xs">{label}</span>
      <div className="grid gap-0.5 text-sm leading-relaxed text-ink">{children}</div>
    </div>
  );
}

export function TemporalCalibrationCard({
  card,
  canonEventCount,
}: {
  card: TemporalAnchorCard;
  /** 将临之事条数（deck.canonEvents 长度；旧卡组无此卡则为 0） */
  canonEventCount: number;
}) {
  const { source, anchor } = card;
  return (
    <section aria-label="时间校准" className="mb-4 mt-10 first:mt-0">
      {/* 泥金节题：与卡片墙组头同构，但无重掷印章——此卡只读 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="display-md text-ink">时间校准</h2>
        <span className="text-xs text-ink-faint">
          只读定盘星——欲改时间锚点，须以同一神谕重新创世
        </span>
        <span
          aria-hidden="true"
          className="h-px min-w-8 flex-1 [background:linear-gradient(90deg,color-mix(in_srgb,var(--gilt)_50%,transparent),transparent)]"
        />
      </div>

      <div className="tome-plate grid gap-x-6 gap-y-4 p-5 md:grid-cols-2 xl:grid-cols-3">
        <Field label="来源">
          {source.basis === "original" ? (
            <p>{BASIS_LABELS.original}</p>
          ) : (
            <>
              <p>
                {BASIS_LABELS[source.basis]} · {source.sourceIps.join("、")}
              </p>
              <p className="text-xs text-ink-soft">连续性：{source.continuity}</p>
            </>
          )}
        </Field>

        <Field label="锚点">
          <p>{anchor.anchorEvent}</p>
          <p className="text-xs text-gilt/90">
            {anchor.currentEraLabel} · {anchor.currentTimeLabel}
          </p>
        </Field>

        <Field label="原作截止点">
          {anchor.canonCutoff !== null ? (
            <>
              <p>{anchor.canonCutoff}</p>
              <p className="text-xs text-ink-soft">截止点之后的原作事件，在此界尚未发生</p>
            </>
          ) : (
            <p className="text-ink-soft">原创世界无截止点</p>
          )}
        </Field>

        <Field label="置信度">
          <p>
            {CONFIDENCE_LABELS[anchor.confidence]} ·{" "}
            {ANCHOR_TYPE_LABELS[anchor.anchorType]} ·{" "}
            {SELECTION_SOURCE_LABELS[anchor.selectionSource]}
          </p>
        </Field>

        <Field label="假设清单">
          {anchor.assumptions.length > 0 ? (
            <ul className="grid list-disc gap-0.5 pl-4">
              {anchor.assumptions.map((assumption, index) => (
                <li key={index}>{assumption}</li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">（锚点判定未附加假设）</p>
          )}
        </Field>

        <Field label="将临之事">
          {canonEventCount > 0 ? (
            <p>
              {canonEventCount} 条<span className="text-xs text-ink-soft">（作者侧隐藏，届时自应验或改道）</span>
            </p>
          ) : (
            <p className="text-ink-soft">（此界未录将临之事）</p>
          )}
        </Field>
      </div>
    </section>
  );
}
