import type { CSSProperties, ReactElement } from "react";
import { buildMaterialContentView } from "./material-content-view";

/* ═══════════ 藏库视觉共件 ═══════════
   素材界面（藏库网格 / 详情卷）共用的纯视觉基元：
   - KIND_LABELS / KindSigil / kind* 色调：每种素材类型一枚镌刻纹章与一缕淡彩；
   - humanizeMachineText：羊皮纸上不排印 UUID——机器铭牌折入 title 悬示。
   置于本文件以避免 MaterialLibrary ⇄ MaterialDetail 的循环引用。 */

export const KIND_LABELS: Record<string, string> = {
  player_god: "玩家神",
  major_god: "主神",
  character: "人物",
  race: "种族",
  faction: "势力",
  place: "地点",
  ability: "能力",
  cosmology: "宇宙论",
  fusion_axiom: "融合公理",
  epoch_conflict: "时代冲突",
  style: "文风",
  theme: "主题",
};

/* 每类素材的基调色（低透明度使用，日卷 / 烛光双主题皆可读） */
const KIND_HUES: Record<string, string> = {
  player_god: "#c9a356",
  major_god: "#b08430",
  character: "#a05a3c",
  race: "#7c703a",
  faction: "#96413a",
  place: "#5e7a4a",
  ability: "#b06a2a",
  cosmology: "#4e6079",
  fusion_axiom: "#6e5583",
  epoch_conflict: "#8c3f47",
  style: "#3f6e6a",
  theme: "#7d4a63",
};

export function kindHue(kind: string) {
  return KIND_HUES[kind] ?? "#a87f2e";
}

/* 卡头淡彩带：向右淡出的类型色晕 */
export function kindBandStyle(kind: string): CSSProperties {
  const hue = kindHue(kind);
  return {
    background: `linear-gradient(90deg, color-mix(in srgb, ${hue} 20%, transparent), color-mix(in srgb, ${hue} 7%, transparent) 55%, transparent)`,
  };
}

/* 类型标签墨色 / 纹章鎏金色：混入主题墨、金，随日烛自动换调 */
export function kindInkColor(kind: string) {
  return `color-mix(in srgb, ${kindHue(kind)} 42%, var(--ink))`;
}

export function kindGiltColor(kind: string) {
  return `color-mix(in srgb, ${kindHue(kind)} 55%, var(--gilt))`;
}

/* 十二类纹章，同一蚀刻笔致（细描线、圆角笔头），呼应背景星图 */
const KIND_SIGILS: Record<string, ReactElement> = {
  player_god: (
    <>
      <path d="M2.8 12C5.2 7.6 8.5 5.4 12 5.4s6.8 2.2 9.2 6.6c-2.4 4.4-5.7 6.6-9.2 6.6S5.2 16.4 2.8 12Z" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 2v1.7M12 20.3V22M3.6 4.8l1.2 1.2M20.4 4.8l-1.2 1.2" opacity=".55" />
    </>
  ),
  major_god: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 6.4l1.5 4.1 4.1 1.5-4.1 1.5-1.5 4.1-1.5-4.1L6.4 12l4.1-1.5Z" />
    </>
  ),
  character: (
    <>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5.6 19.6c1.2-4 3.8-6 6.4-6s5.2 2 6.4 6" />
    </>
  ),
  race: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="8.6" r="1.7" />
      <circle cx="8.6" cy="14.6" r="1.7" />
      <circle cx="15.4" cy="14.6" r="1.7" />
    </>
  ),
  faction: (
    <>
      <path d="M7 3.2v17.6" />
      <path d="M7 4.6h9.8l-2.6 3.2 2.6 3.2H7" />
    </>
  ),
  place: (
    <>
      <path d="M2.8 18.6 8.6 8.8l3.6 5.6 2.6-3.6 6.4 7.8" />
      <circle cx="17.2" cy="6" r="2.1" />
    </>
  ),
  ability: (
    <path d="M13.2 2.6 6.2 13.1h4.4l-1.7 8.3 7.9-11.2h-4.4Z" />
  ),
  cosmology: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <ellipse cx="12" cy="12" rx="9.2" ry="3.6" transform="rotate(-22 12 12)" />
      <circle cx="19" cy="7.6" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  fusion_axiom: (
    <>
      <circle cx="9.2" cy="12" r="5.4" />
      <circle cx="14.8" cy="12" r="5.4" />
    </>
  ),
  epoch_conflict: (
    <>
      <path d="M5 5l14 14M19 5 5 19" />
      <path d="M8.8 2.9 2.9 8.8M21.1 15.2l-5.9 5.9" opacity=".55" />
    </>
  ),
  style: (
    <>
      <path d="M19.8 4.2c-5.6.4-10 4.2-12.4 9.8l-2 6 6-2c5.6-2.4 9.4-6.8 9.8-12.4Z" />
      <path d="M6.6 17.4 13 11" opacity=".55" />
    </>
  ),
  theme: (
    <>
      <path d="M12 6.2C9.6 4.4 6.4 4 4 4.8v13.4c2.4-.8 5.6-.4 8 1.4 2.4-1.8 5.6-2.2 8-1.4V4.8c-2.4-.8-5.6-.4-8 1.4Z" />
      <path d="M12 6.2v13.4" opacity=".55" />
    </>
  ),
};

const FALLBACK_SIGIL: ReactElement = (
  <path d="M12 3.2l2 6.8 6.8 2-6.8 2-2 6.8-2-6.8L3.2 12l6.8-2Z" />
);

export function KindSigil({ kind, className, style }: { kind: string; className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {KIND_SIGILS[kind] ?? FALLBACK_SIGIL}
    </svg>
  );
}

/* 机器铭牌（UUID / cuid / 长十六进制）自正文剔除，残余分隔符并拢。
   调用侧以 title 属性保留原文，悬停即见「来源」全貌。 */
const MACHINE_ID_PATTERNS = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  /\bc[a-z0-9]{24}\b/g,
  /\b[0-9a-f]{16,}\b/gi,
];

export function humanizeMachineText(text: string): string {
  let cleaned = text;
  for (const pattern of MACHINE_ID_PATTERNS) cleaned = cleaned.replace(pattern, "");
  return cleaned
    .replace(/[-_·.:：]{2,}/g, "·")
    .replace(/^[\s\-_·.:：]+|[\s\-_·.:：]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function MaterialContentView({ content }: { content: unknown }) {
  const view = buildMaterialContentView(content);

  if (view.sections.length === 0) {
    return <p className="py-5 text-sm text-ink-faint">此版本没有可展示的正文内容。</p>;
  }

  return (
    <div className="grid gap-4">
      {view.origin && <p className="letterpress text-sm">档案来源：{view.origin}</p>}
      {view.sections.map((section, sectionIndex) => (
        <section
          key={`${section.title}-${sectionIndex}`}
          className={`rounded-lg border p-3 sm:p-4 ${section.private ? "border-gilt/35 bg-gilt/8 shadow-[inset_0_0_1.5rem_var(--gilt-glow)]" : "border-line bg-paper-sunken/40"}`}
        >
          <div className="flex items-center gap-2">
            <h4 className="illuminated-header min-w-0 flex-1 text-sm">{section.title}</h4>
            {section.private && (
              <span className="shrink-0 rounded-full border border-gilt/40 bg-gilt/10 px-2 py-0.5 text-[10px] tracking-[0.14em] text-gilt-strong">
                幕后档案
              </span>
            )}
          </div>
          {section.text && <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink-soft">{section.text}</p>}
          {section.values && (
            <ul className="mt-2 grid gap-1 text-sm leading-7 text-ink-soft">
              {section.values.map((value, index) => <li key={`${value}-${index}`} className="before:mr-2 before:text-gilt before:content-['◆']">{value}</li>)}
            </ul>
          )}
          {section.fields && (
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {section.fields.map((field, index) => (
                <div key={`${field.label}-${index}`}>
                  <dt className="text-xs tracking-[0.14em] text-ink-faint">{field.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{field.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {section.items && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {section.items.map((item, index) => (
                <article key={`${item.title}-${index}`} className="rounded-lg border border-gilt/25 bg-paper-raised/85 p-3 shadow-[0_2px_8px_var(--shadow-warm)]">
                  <h5 className="font-display text-sm font-bold tracking-[0.05em] text-ink">{item.title}</h5>
                  {item.subtitle && <p className="mt-0.5 text-xs text-gilt">{item.subtitle}</p>}
                  {item.fields.length > 0 && (
                    <dl className="mt-3 grid gap-2">
                      {item.fields.map((field, fieldIndex) => (
                        <div key={`${field.label}-${fieldIndex}`}>
                          <dt className="text-xs tracking-[0.14em] text-ink-faint">{field.label}</dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
