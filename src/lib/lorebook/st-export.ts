import type { WorldDeck } from "@/lib/cards/schemas";
import type { ParsedLorebookEntry } from "./st-import";

/**
 * ST 世界书导出编译器（docs/03 §5）：
 * (a) 原样还原导入条目（stExtra 中保留的原始字段合并回去）
 * (b) 将世界卡组编译为 ST entries（name/aliases→keys，卡片文本→content）
 * 输出 SillyTavern worldbook v2 兼容 JSON。
 */

type StEntry = Record<string, unknown> & {
  uid: number;
  key: string[];
  keysecondary: string[];
  comment: string;
  content: string;
  disable: boolean;
};

function baseEntry(uid: number, keys: string[], comment: string, content: string): StEntry {
  return {
    uid,
    key: keys,
    keysecondary: [],
    comment,
    content,
    constant: false,
    selective: true,
    order: 100,
    position: 0,
    disable: false,
    addMemo: true,
    excludeRecursion: false,
    probability: 100,
    useProbability: true,
  };
}

/** 导入条目还原：stExtra 与现值合并 */
export function restoreImportedEntries(
  entries: { keys: string[]; content: string; enabled: boolean; stExtra: unknown }[],
  startUid = 0,
): StEntry[] {
  return entries.map((e, i) => ({
    ...baseEntry(startUid + i, e.keys, "imported", e.content),
    ...(typeof e.stExtra === "object" && e.stExtra !== null ? e.stExtra : {}),
    key: e.keys,
    content: e.content,
    disable: !e.enabled,
    uid: startUid + i,
  }));
}

/** 世界卡组 → ST entries 编译 */
export function compileDeckToEntries(deck: WorldDeck, startUid = 1000): StEntry[] {
  const out: StEntry[] = [];
  let uid = startUid;

  out.push(
    baseEntry(
      uid++,
      [deck.worldName, "宇宙论", "世界观"],
      `${deck.worldName} · 宇宙论`,
      [
        `【世界起源】${deck.cosmology.origin}`,
        `【力量体系】${deck.cosmology.powerSystem}`,
        `【法则】${deck.cosmology.laws}`,
        `【神之存在】${deck.cosmology.divinity}`,
      ].join("\n"),
    ),
  );

  if (deck.fusionAxiom) {
    out.push(
      baseEntry(
        uid++,
        [...deck.fusionAxiom.sourceIps, "融合公理"],
        "融合公理",
        [
          `【融合体系】${deck.fusionAxiom.sourceIps.join(" × ")}`,
          ...deck.fusionAxiom.axioms.map((a) => `· ${a}`),
          `【力量对标】${deck.fusionAxiom.powerMapping}`,
          `【冲突裁决】${deck.fusionAxiom.conflictRule}`,
        ].join("\n"),
      ),
    );
  }

  for (const god of deck.majorGods) {
    out.push(
      baseEntry(
        uid++,
        [god.name, ...god.aliases],
        `主神 · ${god.name}`,
        [
          `【${god.name}】领域：${god.domains.join("、")}`,
          `【性情】${god.persona}`,
          `【言语】称呼习惯：${god.voice.address}；口头禅：${god.voice.catchphrases.join("；")}`,
          `【信仰】${god.faithScope}`,
        ].join("\n"),
      ),
    );
  }

  for (const f of deck.factions) {
    out.push(
      baseEntry(
        uid++,
        [f.name, ...f.aliases],
        `势力 · ${f.name}`,
        [
          `【${f.name}】（${f.kind}）${f.overview}`,
          `【疆域】${f.territory}`,
          `【信仰】${f.faith}`,
          `【关键人物】${f.keyFigures.join("、")}`,
        ].join("\n"),
      ),
    );
  }

  for (const r of deck.races) {
    out.push(
      baseEntry(
        uid++,
        [r.name, ...r.aliases],
        `种族 · ${r.name}`,
        `【${r.name}】${r.traits}\n【寿命】${r.lifespan}\n【分布】${r.distribution}\n【神缘】${r.divineTies}`,
      ),
    );
  }

  for (const p of deck.places) {
    out.push(
      baseEntry(
        uid++,
        [p.name, ...p.aliases],
        `地理 · ${p.name}`,
        `【${p.name}】（${p.kind}）${p.overview}\n【归属】${p.allegiance}`,
      ),
    );
  }

  return out;
}

/** 组装 ST worldbook v2 JSON */
export function buildStWorldbook(
  imported: ParsedLorebookEntry[],
  deck: WorldDeck | null,
): { entries: Record<string, StEntry> } {
  const restored = restoreImportedEntries(imported);
  const compiled = deck ? compileDeckToEntries(deck, restored.length + 1000) : [];
  const entries: Record<string, StEntry> = {};
  for (const e of [...restored, ...compiled]) {
    entries[String(e.uid)] = e;
  }
  return { entries };
}
