import { z } from "zod";

/**
 * 状态抽取器（Extractor）提示词与输出契约（docs/04 §4）。
 * 章末一次（长章分片合并），幕后槽。
 */

const EntityTypeSchema = z.enum([
  "faction",
  "character",
  "race",
  "place",
  "artifact",
  "cult",
]);

export const ExtractionSchema = z.object({
  newEntities: z
    .array(
      z.object({
        type: EntityTypeSchema,
        name: z.string(),
        aliases: z.array(z.string()),
        summary: z.string().describe("一句话摘要（120字内）"),
        sections: z
          .array(
            z.object({
              key: z.string(),
              title: z.string().describe("栏目标题，按世界观措辞的中文"),
              text: z.string(),
            }),
          )
          .describe("按类型模板的栏目，仅写有据可依的"),
        isChosen: z.boolean().describe("是否玩家神选者（获赐印记）"),
      }),
    )
    .describe("值得入册的新实体——路人不入册：有名字且已影响或将影响剧情者才入"),
  entityUpdates: z
    .array(
      z.object({
        name: z.string().describe("已入册实体名（用正名）"),
        sectionDeltas: z
          .array(
            z.object({
              key: z.string(),
              title: z.string().describe("栏目标题，按世界观措辞的中文"),
              text: z.string(),
            }),
          )
          .describe("栏目级更新（整栏覆写文本）"),
        summary: z.string().nullish().describe("摘要变化时更新"),
        newAliases: z.array(z.string()).nullish(),
        becameChosen: z.boolean().nullish(),
        died: z.boolean().nullish(),
        scenePresent: z.boolean().describe("本章结束时是否仍在场"),
      }),
    )
    .describe("既有实体的增量"),
  godUpdates: z
    .array(
      z.object({
        name: z.string(),
        relationChanges: z
          .array(
            z.object({
              target: z.string(),
              label: z.enum(["enemy", "rival", "neutral", "ally", "vassal", "unknown"]),
              note: z.string(),
            }),
          )
          .nullish(),
        rankChange: z
          .object({
            to: z.enum([
              "fallen",
              "ember",
              "slumbering",
              "nascent",
              "ascended",
              "exalted",
              "sovereign",
            ]),
            justification: z.string(),
          })
          .nullish()
          .describe("位阶变更提案（含玩家神），须有本章剧情依据"),
        faithScope: z.string().nullish(),
      }),
    )
    .describe("诸神状态变化（含玩家神，仅写有变化者）"),
  revealSections: z
    .array(z.object({ entityName: z.string(), sectionKey: z.string() }))
    .describe("本章叙事已揭开迷雾的栏目"),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const extractionJsonSchema = JSON.stringify(z.toJSONSchema(ExtractionSchema), null, 2);

/** 六类实体的栏目模板（约束 sections.key 取值） */
export const SECTION_TEMPLATES: Record<string, string[]> = {
  faction: ["overview", "territory", "polity", "faith", "keyFigures", "military"],
  character: [
    "overview",
    "identity",
    "affiliation",
    "lifespan",
    "personality",
    "faithHistory",
    "relationToPlayer",
  ],
  race: ["overview", "lifespan", "distribution", "divineTies", "innerFactions"],
  place: ["overview", "kind", "allegiance", "geography", "majorEvents"],
  artifact: ["overview", "kind", "holder", "powers", "origin", "whereabouts"],
  cult: ["overview", "deity", "doctrine", "holySites", "structure", "heresies", "secularTies"],
};

export function extractorSystem(): string {
  return `You are the Archivist — you read a chapter of narrative and extract structured state deltas for the world codex.

Rules:
- INCLUSION BAR for new entities: named AND has influenced (or will influence) the story. Nameless passersby, one-line scenery NPCs do NOT get cards.
- Section keys must come from the type's template:
${Object.entries(SECTION_TEMPLATES)
  .map(([t, keys]) => `  ${t}: ${keys.join(", ")}`)
  .join("\n")}
- Every section carries a "title": a short Chinese heading phrased in THIS world's voice (a cultivation world might title "military" as 「道兵战力」, a gothic empire as 「军团武备」). Keep titles stable for the same entity across chapters unless the world's framing shifts.
- Write ONLY what the narrative supports; never invent facts to fill sections.
- CHOSEN marks: if the player god granted a mark/blessing formally binding a mortal, set isChosen/becameChosen.
- Mortal lifespans: if the chapter spans years (era/epoch scale), reflect aging/succession in lifespan sections.
- Rank changes require in-chapter justification (a god diminished by mass apostasy, exalted by a miracle witnessed by nations...).
- scenePresent: true only for entities physically/narratively present at the chapter's end scene.
- Locked sections (listed in input) must NOT appear in your deltas.
- Output ONLY a JSON object matching the schema. All user-facing strings in Chinese.

${extractionJsonSchema}`;
}

export function extractorUserPrompt(opts: {
  chapterProse: string;
  knownEntities: string; // 已入册实体（名+类型+别名+摘要）
  knownGods: string;
  lockedPaths: string; // 实体名.栏目 列表
  scaleNote: string; // 本章主要尺度
}): string {
  return `== KNOWN ENTITIES (update these by exact name; do not re-create) ==
${opts.knownEntities || "—"}

== GODS ==
${opts.knownGods}

== PLAYER-LOCKED SECTIONS (never touch) ==
${opts.lockedPaths || "—"}

== CHAPTER SCALE ==
${opts.scaleNote}

== CHAPTER PROSE ==
${opts.chapterProse}

Extract the deltas. Output the JSON now.`;
}

// ───────────────────────── 编年史压缩 ─────────────────────────

export const ChronicleSchema = z.object({
  entries: z
    .array(
      z.object({
        yearLabel: z.string().describe("纪年（用主题卡的纪年体系）"),
        text: z.string().describe("史官笔法一句（40-80字）"),
        entityNames: z.array(z.string()),
        godNames: z.array(z.string()),
      }),
    )
    .min(1)
    .max(4),
  epilogue: z.string().describe("章末小结一段（100-200字，史官口吻）"),
  chapterTitle: z.string().describe("本章标题（4-8字）"),
});

export type ChronicleOutput = z.infer<typeof ChronicleSchema>;

const chronicleJsonSchema = JSON.stringify(z.toJSONSchema(ChronicleSchema), null, 2);

export function chronicleSystem(): string {
  return `You are the Court Historian (史官). Compress a chapter of narrative into chronicle entries.

Rules:
- 2-3 entries (max 4), each in a historian's register (史官笔法): terse, factual, consequential. 40-80 Chinese characters each.
- Use the world's own era-naming for yearLabel (given in input).
- Do NOT record the gods' hidden offstage actions — only what the world could know.
- epilogue: one closing paragraph (100-200 chars), the historian's reflection on the chapter.
- chapterTitle: 4-8 characters, evocative, in the world's diction.
- Output ONLY a JSON object matching the schema. Chinese output.

${chronicleJsonSchema}`;
}

export function chronicleUserPrompt(opts: {
  chapterProse: string;
  eraSystem: string;
  currentYearLabel: string;
  scaleNote: string;
}): string {
  return `== ERA SYSTEM ==
${opts.eraSystem}（当前：${opts.currentYearLabel}）

== CHAPTER SCALE ==
${opts.scaleNote}

== CHAPTER PROSE ==
${opts.chapterProse}

Compress into chronicle entries. Output the JSON now.`;
}
