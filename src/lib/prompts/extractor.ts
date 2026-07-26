import { z } from "zod";
import {
  AbilityEventTypeSchema,
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
} from "@/lib/abilities/types";

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

export const EntityRelationLabelSchema = z.enum([
  "family",
  "spouse",
  "lover",
  "friend",
  "ally",
  "rival",
  "enemy",
  "mentor",
  "student",
  "colleague",
  "neutral",
]);

export const EntityRelationChangeSchema = z.object({
  target: z.string().trim().min(1).max(200).describe("目标人物的精确正名或别名"),
  label: EntityRelationLabelSchema,
  note: z.string().trim().min(1).max(1000),
}).strict();

export const IconConceptSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => !value.includes(":") && !/<\/?(?:svg|path)\b/iu.test(value),
    "iconConcept 必须是语义令牌或简短自然语言，不得包含 Iconify ID 或 SVG",
  );

export const AbilityExtractionPatchSchema = z.object({
  mastery: AbilityMasterySchema.optional(),
  state: AbilityStateSchema.optional(),
  visibility: AbilityVisibilitySchema.optional(),
  rumorText: z.string().nullable().optional(),
  effect: z.string().optional(),
  trigger: z.string().optional(),
  cost: z.string().optional(),
  limitations: z.string().optional(),
}).strict();

export const AbilityExtractionChangeSchema = z.object({
  abilityId: z.string().min(1).optional(),
  ownerName: z.string().min(1),
  sourceAbilityId: z.string().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  kind: AbilityKindSchema.optional(),
  effect: z.string().trim().min(1).optional(),
  trigger: z.string().trim().min(1).optional(),
  cost: z.string().trim().min(1).optional(),
  limitations: z.string().trim().min(1).optional(),
  lockedFields: z.array(z.string().min(1)).optional(),
  visibility: AbilityVisibilitySchema.optional(),
  rumorText: z.string().nullable().optional(),
  iconConcept: IconConceptSchema.optional(),
  type: AbilityEventTypeSchema,
  patch: AbilityExtractionPatchSchema,
  evidenceMessageIndex: z.number().int().nonnegative(),
  evidence: z.string().trim().min(12),
}).strict().superRefine((change, ctx) => {
  const createsNew = change.abilityId === undefined && change.sourceAbilityId === undefined;
  if (!createsNew) return;
  for (const field of ["name", "kind", "effect", "trigger", "cost", "limitations", "lockedFields"] as const) {
    if (change[field] === undefined) {
      ctx.addIssue({ code: "custom", path: [field], message: `新能力必须提供 ${field}` });
    }
  }
  if (change.type !== "learned" && change.type !== "awakened") {
    ctx.addIssue({ code: "custom", path: ["type"], message: "新能力只能以 learned 或 awakened 创建" });
  }
});

export type AbilityExtractionChange = z.infer<typeof AbilityExtractionChangeSchema>;

export type ExtractorChapterMessage = {
  id: string;
  index: number;
  role: string;
  content: string;
  scale: string;
};

export const ExtractionBaseSchema = z.object({
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
        isMajorCharacter: z.boolean().optional().default(false).describe("仅人物且正文明确成为主线关键人物时为 true"),
        raceName: z.string().trim().min(1).optional().describe("新人物的主种族正名或别名；仅 character 可填"),
        iconConcept: IconConceptSchema.optional().describe("优先使用目录语义令牌，也可使用简短中文视觉母题"),
      }),
    )
    .describe("值得入册的新实体——路人不入册：有名字且已影响或将影响剧情者才入"),
  newGods: z.array(z.object({
    name: z.string().trim().min(1),
    aliases: z.array(z.string()),
    tier: z.enum(["major", "minor"]),
    rank: z.enum(["fallen", "ember", "slumbering", "nascent", "ascended", "exalted", "sovereign"]),
    domains: z.array(z.string()),
    faithScope: z.string().nullish(),
    iconConcept: IconConceptSchema.optional().describe("优先使用目录语义令牌，也可使用简短中文视觉母题"),
  })).optional().default([]).describe("本章首次明确出现、值得入册的新神；不得创建玩家神"),
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
        relationChanges: z
          .array(EntityRelationChangeSchema)
          .max(30)
          .nullish()
          .describe("仅 character 可输出；正文明确变化的方向性人物关系"),
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
  majorCharacterPromotions: z.array(z.object({
    name: z.string().min(1).describe("既有 character 的正名"),
    evidenceMessageIndex: z.number().int().nonnegative(),
    evidence: z.string().trim().min(12),
  })).optional().default([]).describe("正文明确使既有人物成为主线关键人物时晋升；逐项提供正文证据"),
  abilityChanges: z
    .array(z.unknown())
    .max(50)
    .describe("逐项校验的能力变化候选；没有变化时为空数组"),
});

/** Lenient outer contract retained for windowed extraction; candidates are validated one by one. */
export const ExtractionSchema = ExtractionBaseSchema;

/** Strict contract used when the whole settlement must succeed in one model response. */
export const StrictExtractionSchema = ExtractionBaseSchema.extend({
  abilityChanges: z.array(AbilityExtractionChangeSchema).max(50),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ParsedExtraction = Omit<Extraction, "abilityChanges"> & {
  abilityChanges: AbilityExtractionChange[];
};

const extractionJsonSchema = JSON.stringify(z.toJSONSchema(ExtractionSchema), null, 2);
const abilityChangeJsonSchema = JSON.stringify(
  z.toJSONSchema(AbilityExtractionChangeSchema),
  null,
  2,
);

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

/** 非活跃路径：生产仅走 settlement.ts 的单次整理；规则变更须与 settlementSystem 同步。 */
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
- ENTITY SECTIONS: emit a sectionDelta only when the labelled prose explicitly changes that section. Each delta replaces the whole section, so preserve still-valid facts from the supplied existing section and return the complete updated whole section. Never invent missing details.
- CHARACTER RELATIONS: only a character entityUpdate may emit relationChanges. The target must be an exact known character name or alias. Each relation is directional from the updated character to the target; do not infer or emit the reverse direction. Emit only when the labelled prose explicitly changes or establishes that character relation, and never invent relationships from proximity or shared scenes.
- CHOSEN marks: if the player god granted a mark/blessing formally binding a mortal, set isChosen/becameChosen.
- MAJOR CHARACTERS: set newEntities.isMajorCharacter only for a new character explicitly established as plot-critical. For an existing character, emit majorCharacterPromotions with verbatim message evidence; do not promote merely for appearing.
- NEW OWNERS: a new character may set raceName only to an exact known race name/alias or a race created in the same extraction. Put newly introduced gods in newGods (never a player god). This lets an explicitly demonstrated new personal/divine/racial ability belong to its new owner in the same chapter.
- ICON CONCEPTS: for each new entity, new god, or genuinely new ability, emit iconConcept when a concise visual motif is supported. Prefer a supplied semantic catalog token such as time.reverse; otherwise use a short natural-language concept. Never output an Iconify ID, SVG, XML, HTML, or path data.
- Mortal lifespans: if the chapter spans years (era/epoch scale), reflect aging/succession in lifespan sections.
- Rank changes require in-chapter justification (a god diminished by mass apostasy, exalted by a miracle witnessed by nations...).
- scenePresent: true only for entities physically/narratively present at the chapter's end scene.
- Locked sections and ability fields (listed in input) must NOT appear in your deltas.
- ABILITY CHANGES: allowed event types are awakened, learned, improved, mutated, impaired, sealed, restored, lost, revealed, deprecated.
- Every ability change must cite exactly one labelled chapter message by evidenceMessageIndex and copy a verbatim evidence excerpt of at least 12 Chinese characters from that message. Never infer an upgrade without explicit training, awakening, injury, sealing, restoration, loss, revelation or mutation in the prose.
- For an existing ability, use its exact abilityId. For learning a racial tradition, use sourceAbilityId plus the character ownerName; never teach a racial_tradition from outside the character's primary race. Do not invent IDs.
- If prose explicitly establishes a genuinely new ability absent from ABILITIES, omit both IDs and provide ownerName, name, kind, effect, trigger, cost, limitations and lockedFields. Characters may create personal, gods divine, and races racial_innate/racial_tradition only. New abilities require learned or awakened evidence; do not backfill old lore in bulk.
- NEW ABILITY EVIDENCE: explicit successful research/development（成功研发）, formal naming（正式命名）, or first stable performance（首次稳定施展）of a reusable spell, combat technique, or engineering combat technology（工程战斗技术）must be registered as a new learned or awakened ability when absent from ABILITIES. A one-off environmental coincidence（单次环境偶发）, accidental external boost, mere attempt, proposal, blueprint, or failed test is not reusable mastery and 不得登记为能力.
- Ability patches may only contain mastery, state, visibility, rumorText, effect, trigger, cost, or limitations. Never change a listed locked field. Ordinary training advances mastery by at most one rank.
- Output ONLY a JSON object matching the schema. All user-facing strings in Chinese.

Overall extraction schema:
${extractionJsonSchema}

Every abilityChanges item must independently match:
${abilityChangeJsonSchema}`;
}

export function extractorUserPrompt(opts: {
  chapterMessages: ExtractorChapterMessage[];
  knownEntities: string; // 已入册实体（名+类型+别名+摘要+人物种族）
  knownGods: string;
  knownAbilities: string; // 本章可演化能力（ID、所有者、来源、锁字段）
  lockedPaths: string; // 实体名.栏目 列表
  scaleNote: string; // 本章主要尺度（仅辅助；能力证据使用逐消息 scale）
}): string {
  const labelledMessages = opts.chapterMessages
    .map((message) => {
      const content = message.role === "player"
        ? `【玩家神谕】${message.content}`
        : message.content;
      return `[${message.id} | ${message.index} | ${message.scale}]
${content}`;
    })
    .join("\n\n");

  return `== KNOWN ENTITIES (update these by exact name; do not re-create) ==
${opts.knownEntities || "—"}

== GODS ==
${opts.knownGods}

== ABILITIES (exact IDs, owners, sources and locked fields) ==
${opts.knownAbilities || "—"}

== PLAYER-LOCKED SECTIONS (never touch) ==
${opts.lockedPaths || "—"}

== CHAPTER DOMINANT SCALE (background only) ==
${opts.scaleNote}

== LABELLED CHAPTER MESSAGES ==
${labelledMessages || "—"}

For every ability change, set evidenceMessageIndex to the integer in the matching label and copy evidence verbatim from that same message. Extract the deltas. Output the JSON now.`;
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
  chapterTitle: z.string().describe("遗留兼容字段：恒返回空字符串"),
});

export type ChronicleOutput = z.infer<typeof ChronicleSchema>;

const chronicleJsonSchema = JSON.stringify(z.toJSONSchema(ChronicleSchema), null, 2);

/** 非活跃路径：生产仅走 settlement.ts 的单次整理；规则变更须与 settlementSystem 同步。 */
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
