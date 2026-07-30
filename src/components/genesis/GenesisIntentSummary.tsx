import type { ReactNode } from "react";
import type { GenesisIntentContract } from "@/lib/genesis/intent";

const PLAYER_ROLE_LABELS = {
  independent_god: "独立玩家神",
  external_creator: "外部创世主",
} as const;

const NARRATIVE_FUNCTION_LABELS = {
  observer_patron: "观察与庇护",
  limited_intervener: "有限干预",
  external_author: "外部作者",
} as const;

function IntentField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1">
      <dt className="letterpress text-xs">{label}</dt>
      <dd className="grid gap-1 text-sm leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

function IntentList({ items, maximum }: { items: readonly string[]; maximum: number }) {
  const visibleItems = items.slice(0, maximum);
  if (visibleItems.length === 0) {
    return <p className="text-ink-soft">（无额外约束）</p>;
  }

  return (
    <details>
      <summary className="cursor-pointer text-ink-soft">
        {visibleItems[0]}
        {visibleItems.length > 1 ? `（另 ${visibleItems.length - 1} 项）` : ""}
      </summary>
      <ul className="mt-2 grid list-disc gap-1 pl-5">
        {visibleItems.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </details>
  );
}

export function GenesisIntentSummary({ intent }: { intent: GenesisIntentContract }) {
  return (
    <section aria-labelledby="genesis-intent-title" className="mb-4 mt-10 first:mt-0">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 id="genesis-intent-title" className="display-md text-ink">神谕理解</h2>
        <span className="text-xs text-ink-faint">
          只读契约 · {intent.sourceIps.length > 0 ? intent.sourceIps.join(" × ") : "原创世界"}
        </span>
        <span
          aria-hidden="true"
          className="h-px min-w-8 flex-1 [background:linear-gradient(90deg,color-mix(in_srgb,var(--gilt)_50%,transparent),transparent)]"
        />
      </div>

      <dl className="tome-plate grid gap-x-6 gap-y-4 p-5 md:grid-cols-2 xl:grid-cols-3">
        <IntentField label="叙事中心">
          <p>{intent.narrativeCenter.identity}</p>
          <p className="text-xs text-ink-soft">{intent.narrativeCenter.role}</p>
        </IntentField>

        <IntentField label="玩家身份与干预">
          <p>
            {PLAYER_ROLE_LABELS[intent.playerRole.type]} ·{" "}
            {NARRATIVE_FUNCTION_LABELS[intent.playerRole.narrativeFunction]}
          </p>
          {intent.playerRole.mustNotReplaceProtagonist && (
            <p className="text-xs text-ink-soft">不得替代叙事主角</p>
          )}
        </IntentField>

        <IntentField label="开局状态">
          <p>{intent.narrativeCenter.startState}</p>
          <details className="text-xs text-ink-soft">
            <summary className="cursor-pointer">锚点边界</summary>
            <p className="mt-2">已成立：{intent.factsAtAnchor.slice(0, 12).join("；") || "无"}</p>
            <p>仅属未来：{intent.futureOnly.slice(0, 12).join("；") || "无"}</p>
          </details>
        </IntentField>

        <IntentField label="融合边界">
          <IntentList items={intent.fusionBoundaries} maximum={10} />
        </IntentField>

        <IntentField label="禁止扩张">
          <IntentList items={intent.forbiddenExpansions} maximum={12} />
        </IntentField>

        <IntentField label="核心压力">
          <IntentList items={intent.corePressures} maximum={8} />
        </IntentField>
      </dl>
    </section>
  );
}
