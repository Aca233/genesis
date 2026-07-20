import type {
  AbilityEventView,
  AbilityKind,
  AbilityMastery,
  AbilityState,
  AbilityView,
} from "./types";

export type { AbilityView } from "./types";

type AbilityGroup = {
  kind: AbilityKind;
  label: string;
  abilities: AbilityView[];
};

type AbilityDetailLine = { label: string; value: string };

const ABILITY_KINDS: AbilityKind[] = [
  "racial_innate",
  "racial_tradition",
  "personal",
  "divine",
];

const ABILITY_KIND_LABELS: Record<AbilityKind, string> = {
  racial_innate: "先天能力（族人默认继承）",
  racial_tradition: "族群技艺（需学习或传承）",
  personal: "个人技能",
  divine: "神权",
};

const MASTERY_LABELS: Record<AbilityMastery, string> = {
  unawakened: "未觉醒",
  novice: "初学",
  adept: "娴熟",
  expert: "精通",
  master: "登峰",
};

const STATE_LABELS: Record<AbilityState, string> = {
  normal: "完好",
  enhanced: "增益",
  impaired: "受损",
  sealed: "封印",
  lost: "失去",
  deprecated: "废弃",
};

const EVENT_LABELS: Record<string, string> = {
  awakened: "觉醒",
  learned: "习得",
  improved: "精进",
  mutated: "蜕变",
  impaired: "受损",
  sealed: "封印",
  restored: "恢复",
  lost: "失去",
  revealed: "揭示",
  deprecated: "废弃",
};

/** 按用户可读的固定顺序分组；隐藏项不会抵达此组件。 */
export function groupAbilities(
  abilities: readonly AbilityView[],
  kinds: readonly AbilityKind[] = ABILITY_KINDS,
  labels: Partial<Record<AbilityKind, string>> = {},
): AbilityGroup[] {
  const displayable = abilities.filter(
    (ability) => ability.visibility === "known" || ability.visibility === "rumored",
  );
  return kinds.flatMap((kind) => {
    const grouped = displayable.filter((ability) => ability.kind === kind);
    return grouped.length === 0
      ? []
      : [{ kind, label: labels[kind] ?? ABILITY_KIND_LABELS[kind], abilities: grouped }];
  });
}

/** 将完整能力与传闻能力转换为安全的展示行。 */
export function abilityDetailLines(ability: AbilityView): AbilityDetailLine[] {
  if (ability.visibility === "rumored") {
    return [{ label: "传闻", value: ability.rumorText || "此术详情尚不可考" }];
  }
  if (ability.visibility !== "known") return [];

  return [
    { label: "效果", value: ability.effect },
    { label: "触发", value: ability.trigger },
    { label: "代价", value: ability.cost },
    { label: "限制", value: ability.limitations },
    { label: "掌握", value: MASTERY_LABELS[ability.mastery] },
    { label: "状态", value: STATE_LABELS[ability.state] },
  ];
}

function sourceLabel(ability: AbilityView): string | null {
  if (ability.visibility !== "known") return null;
  if (ability.inherited) return "族裔先天继承";
  if (ability.sourceAbilityId && ability.kind === "racial_tradition") {
    return "承自族群技艺";
  }
  if (ability.sourceAbilityId && ability.kind === "racial_innate") {
    return "血脉覆写";
  }
  return null;
}

function eventDate(event: AbilityEventView): string | null {
  const raw = "createdAt" in event ? event.createdAt : event.revealedAt;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function AbilityHistory({ history }: { history: AbilityEventView[] }) {
  if (history.length === 0) return null;

  return (
    <div className="mt-3 border-t border-line/80 pt-2">
      <p className="mb-1 text-[10px] tracking-widest text-ink-faint">沿革</p>
      <ul className="grid gap-1.5">
        {history.map((event, index) => {
          const rumored = "revealedAt" in event;
          const date = eventDate(event);
          return (
            <li key={event.id ?? `${event.type ?? "revealed"}-${index}`} className="text-xs leading-relaxed text-ink-soft">
              <span className="mr-1.5 text-gilt/75">{date ?? "旧录"}</span>
              <span>{rumored ? "揭示" : event.type ? EVENT_LABELS[event.type] ?? event.type : "变迁"}</span>
              {rumored ? (
                event.rumorText && <span className="fog-text">：{event.rumorText}</span>
              ) : (
                event.evidence && <span>：{event.evidence}</span>
              )}
              {!rumored && event.scale && (
                <span className="ml-1 text-ink-faint">（{event.scale}）</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AbilityCard({
  ability,
  history,
}: {
  ability: AbilityView;
  history: AbilityEventView[];
}) {
  const source = sourceLabel(ability);
  return (
    <li className={`rounded-md border p-3 ${ability.visibility === "rumored" ? "border-line bg-paper-sunken" : "border-line bg-paper-raised"}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h5 className="text-sm text-ink">{ability.name}</h5>
        {ability.visibility === "rumored" && (
          <span className="fog-text text-[10px] tracking-widest">传闻</span>
        )}
      </header>
      {source && <p className="mt-1 text-xs text-gilt/75">来源：{source}</p>}
      {ability.visibility === "known" && ability.bloodlineJustification && (
        <p className="mt-1 text-xs text-ink-faint">血脉依据：{ability.bloodlineJustification}</p>
      )}
      <dl className="mt-2 grid gap-1 text-xs leading-relaxed">
        {abilityDetailLines(ability).map((line) => (
          <div key={line.label} className="grid grid-cols-[3rem_1fr] gap-2">
            <dt className="text-ink-faint">{line.label}</dt>
            <dd className={ability.visibility === "rumored" ? "fog-text" : "text-ink-soft"}>{line.value}</dd>
          </div>
        ))}
      </dl>
      <AbilityHistory history={history} />
    </li>
  );
}

export function AbilityList({
  abilities,
  historyByAbilityId = {},
  kinds,
  labels,
  emptyText = "尚无已载能力",
}: {
  abilities: readonly AbilityView[];
  historyByAbilityId?: Readonly<Record<string, AbilityEventView[]>>;
  kinds?: readonly AbilityKind[];
  labels?: Partial<Record<AbilityKind, string>>;
  emptyText?: string;
}) {
  const groups = groupAbilities(abilities, kinds, labels);
  if (groups.length === 0) return <p className="fog-text text-sm">{emptyText}</p>;

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section key={group.kind}>
          <h4 className="mb-2 text-xs tracking-widest text-ink-faint">{group.label}</h4>
          <ul className="grid gap-2">
            {group.abilities.map((ability) => (
              <AbilityCard
                key={ability.id}
                ability={ability}
                history={historyByAbilityId[ability.id] ?? []}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
