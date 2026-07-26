import { z } from "zod";
import {
  AbilityKindSchema,
  AbilityMasterySchema,
  AbilityStateSchema,
  AbilityVisibilitySchema,
} from "@/lib/abilities/types";

/**
 * 世界卡组 Schema —— 全项目的数据契约锚点（docs/01 §2.2）。
 * Genesis 生成、卡片编辑器、Narrator 上下文、百科种子全部引用此文件。
 * 所有面向玩家的文本一律中文。
 */

// ───────────────────────── 基础 ─────────────────────────

/** 神力位阶内部枚举（主题卡负责世界观措辞映射） */
export const RANKS = [
  "fallen",     // 陨灭
  "ember",      // 余烬
  "slumbering", // 沉睡
  "nascent",    // 微末
  "ascended",   // 成神
  "exalted",    // 显赫
  "sovereign",  // 主宰
] as const;
export const RankSchema = z.enum(RANKS);

export const StanceSchema = z.enum([
  "hostility",   // 敌意
  "rivalry",     // 竞争
  "neutral",     // 中立
  "cooperation", // 合作
  "dependence",  // 依附
]);

export const RelationLabelSchema = z.enum([
  "enemy",    // 敌对
  "rival",    // 竞争
  "neutral",  // 中立
  "ally",     // 盟友
  "vassal",   // 隶属
  "unknown",  // 未知（星图不画线）
]);

/** 叙事尺度五档：瞬息/场景/数载/年代/纪元 */
export const ScaleSchema = z.enum(["moment", "scene", "years", "era", "epoch"]);
export type Scale = z.infer<typeof ScaleSchema>;

/** Trimmed non-empty reference key used for all cross-card and ability identities. */
export const StableRefSchema = z.string().trim().min(1, "ref 不能为空白");

// ───────────────────── 时间锚点（时间一致设计稿 §5，阶段 1 加法契约） ─────────────────────

/** 锚点/连续性判定依据（§5.1/§5.2 共用） */
export const TemporalSelectionSourceSchema = z.enum([
  "player_explicit", // 玩家明确指定
  "lorebook",        // 随行资料推断
  "model_inferred",  // 模型自行推断
]);

/**
 * 世界来源与连续性（§5.1 判别联合）。
 * basis=original 走降级档（§6.2）：无 canonCutoff、无正史还原义务。
 */
export const WorldSourceSchema = z.discriminatedUnion("basis", [
  z.object({
    basis: z.literal("original").describe("原创世界：没有既有原作正史，走降级档（canonCutoff 必须为 null）"),
    ambiguityNotes: z.array(z.string()).describe("来源判定中仍存的含糊之处，中文逐条；没有则为空数组"),
  }).strict(),
  z.object({
    basis: z.enum(["single_ip", "multi_ip"]).describe("single_ip=单一原作；multi_ip=多原作融合"),
    sourceIps: z.array(z.string().min(1)).min(1).describe("来源原作 IP 列表，使用通行名称"),
    continuity: z.string().min(1).describe("采用的连续性版本，如「原著小说线」「2003 年动画线」"),
    continuitySource: TemporalSelectionSourceSchema.describe("连续性版本的判定依据：玩家明示 / 资料推断 / 模型推断"),
    ambiguityNotes: z.array(z.string()).describe("来源与连续性判定中仍存的含糊之处，中文逐条；没有则为空数组"),
  }).strict(),
]);
export type WorldSource = z.infer<typeof WorldSourceSchema>;

/** 时间锚点（§5.2）：开局时刻的定位。时间标签只做展示，不参与任何机器校验。 */
export const TemporalAnchorSchema = z.object({
  anchorType: z.enum([
    "explicit_date",      // 明确日期
    "explicit_event",     // 明确事件
    "identity_period",    // 身份时期（如「主角还是学徒的年代」）
    "main_story_opening", // 原作主线正式开始前夕（未指定时期时的默认档）
    "original_present",   // 原创世界的当下
  ]).describe("锚点类型；玩家未指定时期时默认 main_story_opening（原作主线正式开始前夕）"),
  currentTimeLabel: z.string().min(1).describe("展示用当前时间标签，中文自由字符串（如「帝国历 998 年冬」）；不参与任何机器校验"),
  currentEraLabel: z.string().min(1).describe("展示用当前纪元标签，中文自由字符串；不参与任何机器校验"),
  anchorEvent: z.string().min(1).describe("把开局定位到具体时刻的锚点事件，中文一句话（如「就在黑船叩港的前夜」）"),
  canonCutoff: z.string().min(1).nullable().describe("原作知识截止点：截止点之后的原作事件在本世界尚未发生。basis=original 时必须为 null；IP 世界必填"),
  selectionSource: TemporalSelectionSourceSchema.describe("锚点的选定依据：玩家明示 / 资料推断 / 模型推断"),
  confidence: z.enum(["high", "medium", "low"]).describe("锚点判定的置信度"),
  assumptions: z.array(z.string()).describe("为选定该锚点所做的假设，中文逐条；没有则为空数组"),
}).strict();
export type TemporalAnchor = z.infer<typeof TemporalAnchorSchema>;

/**
 * 时间锚点顶层卡：来源 + 锚点 + 序数锚位。
 * anchorOrdinal 与 canonEvents.ordinal 同处一条全局序数时间轴（§5.3）：
 * 过去事件 ordinal < anchorOrdinal < 将临之事 ordinal。现行 canonEvents 契约以
 * 开局时刻为 0、将临之事自 1 起，故新卡组通常 anchorOrdinal=0。
 */
export const TemporalAnchorCardSchema = z.object({
  source: WorldSourceSchema.describe("世界来源与连续性"),
  anchor: TemporalAnchorSchema.describe("时间锚点：开局时刻的定位"),
  anchorOrdinal: z.number().int().min(0).describe(
    "锚点在全局序数时间轴上的位置。整数序数是唯一被机器校验的时间：过去事件 ordinal < anchorOrdinal，将临之事（canonEvents）ordinal > anchorOrdinal；时间标签只做展示。现行契约以开局时刻为 0、将临之事自 1 起，因此通常填 0",
  ),
}).strict().superRefine((card, ctx) => {
  if (card.source.basis === "original") {
    if (card.anchor.canonCutoff !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["anchor", "canonCutoff"],
        message: "basis=original 的原创世界必须将 canonCutoff 置为 null",
      });
    }
  } else if (card.anchor.canonCutoff === null) {
    ctx.addIssue({
      code: "custom",
      path: ["anchor", "canonCutoff"],
      message: "IP 世界（single_ip/multi_ip）必须给出 canonCutoff 原作知识截止点",
    });
  }
});
export type TemporalAnchorCard = z.infer<typeof TemporalAnchorCardSchema>;

// ───────────── 锚点瘦快照与卡级溯源（时间一致设计稿 §6.1/§7，阶段 2 加法契约） ─────────────

/**
 * 卡级溯源（§6.1）：标记条目与原作正史的关系。卡级而非逐字段；
 * basis=original 的原创世界整体省略（全部必然是 generated_original）。
 */
export const ProvenanceSchema = z.object({
  canonRelation: z.enum(["canon", "canon_inferred", "player_override", "generated_original"])
    .describe("条目与原作正史的关系：canon=原作既有；canon_inferred=由原作合理推断；player_override=玩家改写原作；generated_original=本世界原创。basis=original 的原创世界整体省略 provenance"),
  evidence: z.array(z.string()).max(3).optional()
    .describe("可选证据线索，中文，至多 3 条；模型伪造引用不可信，仅供审计线索"),
}).strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** 人物锚点瘦快照（§7 阶段 2）：只写锚点时刻的当前态，绝不写生平综述。 */
export const CharacterStateAtAnchorSchema = z.object({
  identity: z.string().min(1)
    .describe("锚点时刻的身份，中文一句话——此刻是谁，而非将来会成为谁"),
  locationRef: StableRefSchema.nullable()
    .describe("锚点时刻所在地点的稳定 ref；行踪不定或不在任何已立卡地点时为 null"),
  factionMemberships: z.array(z.object({
    factionRef: StableRefSchema.describe("势力稳定 ref"),
    role: z.string().describe("锚点时刻在该势力中的职务，中文"),
    status: z.enum(["active", "former", "secret"])
      .describe("成员关系状态：active=现任；former=已脱离；secret=秘密成员"),
  }).strict()).describe("锚点时刻的势力成员关系；没有则为空数组"),
  currentGoals: z.array(z.string()).max(3)
    .describe("锚点时刻正在追求的目标，中文，至多 3 条"),
  currentSituation: z.string().min(1)
    .describe("锚点时刻的处境，中文一句话"),
  knowledgeHints: z.array(z.string()).max(3).optional()
    .describe("锚点时刻已知晓之事的提示，中文，至多 3 条；提示性而非权威知识边界"),
}).strict();
export type CharacterStateAtAnchor = z.infer<typeof CharacterStateAtAnchorSchema>;

/** 势力锚点瘦快照（§7 阶段 2）。 */
export const FactionStateAtAnchorSchema = z.object({
  leaderRefs: z.array(StableRefSchema).optional()
    .describe("锚点时刻的现任领袖/掌权人物稳定 ref 列表；必须解析到既有人物卡"),
  territoryRefs: z.array(StableRefSchema).optional()
    .describe("锚点时刻实际控制的地点稳定 ref 列表；必须解析到既有地点卡"),
  currentStrength: z.string().optional()
    .describe("锚点时刻的实力概况，中文一句话"),
}).strict();
export type FactionStateAtAnchor = z.infer<typeof FactionStateAtAnchorSchema>;

/** 神明锚点瘦快照（§7 阶段 2）。 */
export const GodStateAtAnchorSchema = z.object({
  currentRank: RankSchema.optional()
    .describe("锚点时刻的当前位阶；与卡面 rank 不同时填写"),
  currentDomains: z.array(z.string()).optional()
    .describe("锚点时刻实际掌握的领域；与卡面 domains 不同时填写"),
}).strict();
export type GodStateAtAnchor = z.infer<typeof GodStateAtAnchorSchema>;

/**
 * 锚点关系（§7 阶段 2）：有界——每名 active 人物 1–4 条锚点相关关系。
 * 指向非 active 实体的追念关系（如「先王之子」）必须 memorial=true，
 * 消费者为 Narrator 关系块与导演工具查询（T3 豁免读取 memorial）。
 */
export const RelationAtAnchorSchema = z.object({
  sourceRef: StableRefSchema.describe("关系主体的稳定 ref（通常为 active 人物）；必须解析到既有卡"),
  targetRef: StableRefSchema.describe("关系客体的稳定 ref；必须解析到既有卡；指向锚点非 active 实体时必须 memorial=true"),
  status: z.enum(["ally", "enemy", "rival", "subordinate", "family", "unknown", "no_contact"])
    .describe("锚点时刻的关系状态：ally=盟友；enemy=敌对；rival=竞争；subordinate=从属；family=亲缘；unknown=未知；no_contact=尚无往来"),
  publicDescription: z.string().min(1).describe("公开可见的关系描述，中文一句话"),
  hiddenDescription: z.string().optional().describe("对玩家隐藏的关系真相，中文；无隐情则省略"),
  memorial: z.boolean().optional()
    .describe("追念关系标记：targetRef 指向锚点非 active 实体（已死/未生/已解散等）时必须为 true；现存关系省略"),
}).strict();
export type RelationAtAnchor = z.infer<typeof RelationAtAnchorSchema>;

// ───────────────────────── 单卡 ─────────────────────────

/** 卡组阶段使用的能力完整描述；ref 是草稿内的稳定关系键。 */
export const DeckAbilitySchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  kind: AbilityKindSchema,
  effect: z.string().describe("叙事中的实际效果"),
  trigger: z.string().describe("被动生效或主动发动条件"),
  cost: z.string().describe("代价；没有时写无"),
  limitations: z.string().describe("边界、克制方式及不能做到的事"),
  mastery: AbilityMasterySchema,
  state: AbilityStateSchema,
  timing: z.enum(["at_anchor", "future", "lost"]).optional()
    .describe("能力相对时间锚点的时序：at_anchor=锚点时刻已持有；future=原作中锚点之后才会获得（statusAtAnchor=active 的实体不得已持有）；lost=锚点之前已失去。与 state/visibility/继承机制正交；缺省视为 at_anchor（旧卡组兼容）"),
  visibility: AbilityVisibilitySchema,
  rumorText: z.string().nullable(),
  lockedFields: z.array(z.string()).default([]),
});

export const RaceDeckAbilitySchema = DeckAbilitySchema.refine(
  (ability) => ability.kind === "racial_innate" || ability.kind === "racial_tradition",
  "种族能力只能是 racial_innate 或 racial_tradition",
);
export const DivineDeckAbilitySchema = DeckAbilitySchema.refine(
  (ability) => ability.kind === "divine",
  "神权能力只能是 divine",
);
export const PersonalDeckAbilitySchema = DeckAbilitySchema.refine(
  (ability) => ability.kind === "personal",
  "人物个人技能只能是 personal",
);

export const FactionMembershipSchema = z.object({
  factionRef: StableRefSchema,
  role: z.string().describe("人物在势力中的职务"),
  isPrimary: z.boolean().describe("是否为主要归属"),
});

export const RacialOverrideSchema = DeckAbilitySchema.extend({
  sourceAbilityRef: StableRefSchema,
  bloodlineJustification: z.string().min(1).nullable(),
}).refine(
  (ability) => ability.kind === "racial_innate",
  "先天覆写只能是 racial_innate",
);

export const MajorCharacterCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  aliases: z.array(z.string()),
  identity: z.string().describe("身份与社会角色"),
  ageStage: z.string().describe("年龄阶段"),
  raceRef: StableRefSchema.describe("主种族稳定引用"),
  factionMemberships: z.array(FactionMembershipSchema),
  personality: z.string(),
  goals: z.string(),
  situation: z.string().describe("当前处境"),
  divineTies: z.string().describe("与诸神的关系"),
  conflictTies: z.string().describe("与时代冲突的关系"),
  statusAtAnchor: z.enum(["active", "unborn", "dead", "missing", "sealed", "historical"]).optional()
    .describe("锚点时刻的人物状态：active=在世且可活动；unborn=尚未出生；dead=已死亡；missing=失踪；sealed=被封印；historical=只存在于历史记载。缺省视为 active（旧卡组兼容）"),
  anchorNote: z.string().optional()
    .describe("一句话说明该锚点状态的来由（如「三年前战死于北境」）；active 且无须说明时留空"),
  stateAtAnchor: CharacterStateAtAnchorSchema.optional()
    .describe("锚点瘦快照（阶段 2）：只写锚点时刻的当前态（身份/所在/成员关系/目标/处境/已知提示），绝不写生平综述"),
  provenance: ProvenanceSchema.optional()
    .describe("卡级溯源（阶段 2）：IP 世界标记条目与原作正史的关系；basis=original 世界整体省略"),
  learnedTraditionRefs: z.array(z.object({ sourceAbilityRef: StableRefSchema })),
  racialOverrides: z.array(RacialOverrideSchema),
  abilities: z.array(PersonalDeckAbilitySchema).min(2).max(5).describe("个人技能"),
});

export const CosmologyCardSchema = z.object({
  origin: z.string().describe("世界起源"),
  powerSystem: z.string().describe("力量体系"),
  laws: z.string().describe("天道/物理法则"),
  divinity: z.string().describe("神之存在方式：位格来源、信仰依赖等"),
});

export const FusionAxiomCardSchema = z.object({
  sourceIps: z.array(z.string()).min(2).describe("融合的IP列表"),
  axioms: z.array(z.string()).min(1).describe("缝合公理，逐条"),
  powerMapping: z.string().describe("力量对标表"),
  conflictRule: z.string().describe("设定冲突时以谁为准"),
});

export const GodVoiceSchema = z.object({
  verbalTics: z.array(z.string()).describe("语癖"),
  address: z.string().describe("称呼习惯"),
  catchphrases: z.array(z.string()).describe("口头禅"),
  neverSays: z.array(z.string()).describe("绝不会说的话"),
});

export const GodAgendaSchema = z.object({
  longTermGoal: z.string(),
  shortTermGoals: z.array(z.string()),
  methods: z.string().describe("手段偏好"),
  stanceToPlayer: z.object({
    level: StanceSchema,
    motive: z.string().describe("一句话动机"),
  }),
  schemes: z.array(z.string()).describe("进行中的密谋"),
});

export const CreatorGodAgendaSchema = GodAgendaSchema
  .omit({ stanceToPlayer: true })
  .strict();

export const MajorGodCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用，供跨卡关系与开局物化使用"),
  name: z.string(),
  aliases: z.array(z.string()).describe("别名与称号"),
  domains: z.array(z.string()).describe("领域"),
  rank: RankSchema,
  persona: z.string().describe("性情与外显形象"),
  voice: GodVoiceSchema,
  agenda: GodAgendaSchema.describe("对玩家默认隐藏"),
  initialRelationToPlayer: z.object({
    label: RelationLabelSchema,
    note: z.string(),
  }),
  faithScope: z.string().describe("信仰范围一句话"),
  statusAtAnchor: z.enum(["active", "dormant", "sealed", "dead", "fragmented", "not_yet_ascended"]).optional()
    .describe("锚点时刻的神明状态：active=活跃临世；dormant=沉眠；sealed=被封印；dead=已死亡；fragmented=神格破碎；not_yet_ascended=尚未成神。缺省视为 active（旧卡组兼容）"),
  anchorNote: z.string().optional()
    .describe("一句话说明该锚点状态的来由（如「诸神黄昏中陨落」）；active 且无须说明时留空"),
  stateAtAnchor: GodStateAtAnchorSchema.optional()
    .describe("锚点瘦快照（阶段 2）：锚点时刻的当前位阶与领域，与卡面不同时填写"),
  provenance: ProvenanceSchema.optional()
    .describe("卡级溯源（阶段 2）：IP 世界标记条目与原作正史的关系；basis=original 世界整体省略"),
  abilities: z.array(DivineDeckAbilitySchema).min(3).max(6).describe("神权能力"),
});

export const PantheonMajorGodCardSchema = MajorGodCardSchema;

export const CreatorMajorGodCardSchema = MajorGodCardSchema
  .omit({ agenda: true, initialRelationToPlayer: true })
  .extend({
    agenda: CreatorGodAgendaSchema,
    relations: z.array(z.object({
      targetGodRef: StableRefSchema,
      label: RelationLabelSchema,
      note: z.string(),
    }).strict()).default([]),
  }).strict();

export const MinorGodSchema = z.object({
  name: z.string(),
  brief: z.string().describe("一句话设定"),
});

export const PlayerGodCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用，供开局物化使用"),
  name: z.string(),
  origin: z.string().describe("出身：新神/既有神/转生神/篡位者等，从玩家输入推断"),
  domains: z.array(z.string()),
  rank: RankSchema,
  faithBase: z.string().describe("初始信仰势力"),
  situation: z.string().describe("开局处境与钩子"),
  statusAtAnchor: z.enum(["active", "dormant", "sealed", "dead", "fragmented", "not_yet_ascended"]).optional()
    .describe("锚点时刻的玩家神状态；玩家神同样受锚点约束，不是时间规则的例外。开局可操作的玩家神应为 active。缺省视为 active（旧卡组兼容）"),
  anchorNote: z.string().optional()
    .describe("一句话说明该锚点状态的来由；active 且无须说明时留空"),
  stateAtAnchor: GodStateAtAnchorSchema.optional()
    .describe("锚点瘦快照（阶段 2）：锚点时刻的当前位阶与领域，与卡面不同时填写；玩家神同样受锚点约束"),
  abilities: z.array(DivineDeckAbilitySchema).min(3).max(6).describe("玩家神权"),
});

export const FactionCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  aliases: z.array(z.string()),
  kind: z.string().describe("国家/宗门/教团/军团等"),
  overview: z.string(),
  territory: z.string(),
  faith: z.string().describe("信仰归属与浓度"),
  statusAtAnchor: z.enum(["active", "forming", "dissolved", "destroyed", "historical"]).optional()
    .describe("锚点时刻的势力状态：active=正常运转；forming=正在成形；dissolved=已解散；destroyed=已被摧毁；historical=只存在于历史记载。缺省视为 active（旧卡组兼容）"),
  anchorNote: z.string().optional()
    .describe("一句话说明该锚点状态的来由（如「十年前于内战中解散」）；active 且无须说明时留空"),
  stateAtAnchor: FactionStateAtAnchorSchema.optional()
    .describe("锚点瘦快照（阶段 2）：锚点时刻的现任领袖、实控疆域与实力概况"),
  provenance: ProvenanceSchema.optional()
    .describe("卡级溯源（阶段 2）：IP 世界标记条目与原作正史的关系；basis=original 世界整体省略"),
  keyCharacterRefs: z.array(z.object({ ref: StableRefSchema })).describe("关键人物稳定引用"),
  // 旧草稿兼容字段；新的运行时关系以 keyCharacterRefs 为准。
  keyFigures: z.array(z.string()).optional().default([]).describe("旧草稿关键人物名"),
});

export const RaceCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  aliases: z.array(z.string()),
  traits: z.string(),
  lifespan: z.string(),
  distribution: z.string(),
  divineTies: z.string().describe("与诸神的渊源"),
  statusAtAnchor: z.enum(["active", "declining", "extinct", "not_yet_emerged"]).optional()
    .describe("锚点时刻的种族状态：active=繁盛存续；declining=衰落中；extinct=已灭绝；not_yet_emerged=尚未出现。缺省视为 active（旧卡组兼容）"),
  anchorNote: z.string().optional()
    .describe("一句话说明该锚点状态的来由（如「大寂灭后仅余孑遗」）；active 且无须说明时留空"),
  provenance: ProvenanceSchema.optional()
    .describe("卡级溯源（阶段 2）：IP 世界标记条目与原作正史的关系；basis=original 世界整体省略"),
  abilities: z.array(RaceDeckAbilitySchema).min(2).max(5).describe("先天能力与族群技艺"),
});

export const PlaceCardSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  name: z.string(),
  aliases: z.array(z.string()),
  kind: z.string().describe("大陆/城市/秘境/圣地"),
  overview: z.string(),
  allegiance: z.string().describe("归属"),
  statusAtAnchor: z.enum(["accessible", "hidden", "sealed", "destroyed", "not_yet_created"]).optional()
    .describe("锚点时刻的地点状态：accessible=可以抵达；hidden=隐匿未显；sealed=被封锁；destroyed=已毁灭；not_yet_created=尚未出现。缺省视为 accessible（旧卡组兼容）"),
  anchorNote: z.string().optional()
    .describe("一句话说明该锚点状态的来由（如「沉入海底已两百年」）；accessible 且无须说明时留空"),
  provenance: ProvenanceSchema.optional()
    .describe("卡级溯源（阶段 2）：IP 世界标记条目与原作正史的关系；basis=original 世界整体省略"),
});

export const EpochConflictCardSchema = z.object({
  epochName: z.string().describe("当前纪元名"),
  yearLabel: z.string().describe("当前纪年"),
  overtConflicts: z.array(z.string()).describe("公开的时代矛盾"),
  hiddenCurrents: z.array(z.string()).describe("暗流（对玩家隐藏，作为诸神议程种子）"),
});

export const EventConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("entity_status"),
    entityRef: StableRefSchema,
    requiredStatus: z.array(z.string().min(1)).min(1).max(4),
  }).strict(),
  z.object({
    kind: z.literal("relation_status"),
    sourceRef: StableRefSchema,
    targetRef: StableRefSchema,
    requiredStatus: z.array(z.string().min(1)).min(1).max(4),
  }).strict(),
  z.object({
    kind: z.literal("prior_event_occurred"),
    canonEventRef: StableRefSchema,
  }).strict(),
  z.object({
    kind: z.literal("ordinal_window"),
    notBeforeOrdinal: z.number().int().min(0).optional(),
    notAfterOrdinal: z.number().int().min(0).optional(),
  }).strict(),
  z.object({
    kind: z.literal("custom"),
    description: z.string().min(1).describe("AI 判定条件，判定时必须给出依据"),
  }).strict(),
]);

export const EventConsequenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("status_change"),
    targetRef: StableRefSchema,
    toStatus: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("relation_change"),
    sourceRef: StableRefSchema,
    targetRef: StableRefSchema,
    toStatus: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("custom"),
    description: z.string().min(1),
  }).strict(),
]);

/**
 * 将临之事（CanonFutureEvent）：作者侧未来候选事件，对玩家隐藏。
 * 形状严格遵循时间一致设计稿的 future 档 CanonEvent
 * （docs/superpowers/specs/2026-07-26-temporal-consistent-world-generation-design.md §5.3/§8.4）：
 * 整数 ordinal 承担全部先后序（timeLabel 仅展示），开局时刻为隐式 ordinal 0，
 * 所有条目 ordinal >= 1；epoch 固定 "future"，status 恒 "pending"，visibility 恒 "author_only"。
 * 注：阶段 1 已引入可选的 temporalAnchor 卡（source.basis / anchorOrdinal）。卡组携带锚点时，
 * 每个 ordinal 还必须大于 anchorOrdinal（epoch=future ⇔ ordinal > anchorOrdinal，见
 * validateCanonFutureAxis）。设计稿 §6.2 的降级档（basis=original 关闭未来正史事件生成）
 * 尚未启用——已批准的将临之事提案明确覆盖原创世界（候选自 epochConflict 派生），关闭与否留待后续裁决。
 */
export const CanonFutureEventSchema = z.object({
  ref: StableRefSchema.describe("稳定引用"),
  title: z.string().min(1),
  timeLabel: z.string().describe("展示用自由时间标签，如「三年后的血月」"),
  ordinal: z.number().int().min(1).describe("全局唯一整数先后序；开局时刻为 0。卡组携带 temporalAnchor 时还必须大于其 anchorOrdinal（过去 < anchorOrdinal < 将临之事）"),
  epoch: z.literal("future"),
  summary: z.string().describe("作者侧事件概要（中文）"),
  participantRefs: z.array(StableRefSchema).max(8),
  prerequisites: z.array(EventConditionSchema).min(1).max(3),
  blockers: z.array(EventConditionSchema).max(3).default([]),
  expectedConsequences: z.array(EventConsequenceSchema).max(3).default([]),
  status: z.literal("pending"),
  visibility: z.literal("author_only"),
}).strict();
export type CanonFutureEvent = z.infer<typeof CanonFutureEventSchema>;

export const StyleCardSchema = z.object({
  preset: z.enum(["epic", "webnovel", "grimdark", "lightnovel", "canon"]),
  presetName: z.string().describe("预设中文名"),
  toneNotes: z.string().describe("文风细则"),
  narrationNotes: z.string().optional().describe("叙述视角与人称约定：『你』的指向、凡人段落的视角选择"),
  rhythm: z.string().optional().describe("句法节奏细则：长短句配比、段落长度倾向、对白密度"),
  dictionExamples: z.array(z.string()).max(3).optional().describe("2-3句符合本世界腔调的锚点例句；仅作语感锚，不得原样进入正文"),
  tabooPhrases: z.array(z.string()).max(12).optional().describe("本世界应回避或限量的套语与滥用词，如：一丝、一抹、眼中闪过、空气仿佛凝固、极度"),
});

export const ThemeCardSchema = z.object({
  eraSystem: z.string().describe("纪年体系名，如「帝国历」「天元纪」"),
  rankNames: z
    .record(RankSchema, z.string())
    .describe("位阶的世界观措辞映射，如 nascent→散仙"),
  typeNames: z
    .record(
      z.enum(["faction", "character", "race", "place", "artifact", "cult"]),
      z.string(),
    )
    .describe(
      "众生录六类的世界观措辞，如修仙界 faction→宗门势力、cult→道统；哥特帝国 faction→军团诸侯",
    ),
  addressStyle: z.string().describe("称谓习惯"),
});

// ───────────────────────── 卡组 ─────────────────────────

const SharedWorldDeckShape = {
  worldName: z.string(),
  temporalAnchor: TemporalAnchorCardSchema.optional()
    .describe("时间锚点卡：世界来源、开局时刻与序数锚位。新世界必填，且必须先于一切实体卡确定；旧卡组（无此卡）按旧行为解析"),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable().describe("仅多IP融合时非空"),
  minorGods: z.array(MinorGodSchema),
  factions: z.array(FactionCardSchema).min(2).max(8),
  races: z.array(RaceCardSchema),
  majorCharacters: z.array(MajorCharacterCardSchema).min(4).max(12),
  relationsAtAnchor: z.array(RelationAtAnchorSchema).optional()
    .describe("锚点关系（阶段 2，有界）：每名 active 人物 1–4 条锚点相关关系；指向非 active 实体的追念关系必须 memorial=true；所有 ref 必须解析到既有卡。旧卡组（无此键）按旧行为解析"),
  places: z.array(PlaceCardSchema),
  epochConflict: EpochConflictCardSchema,
  canonEvents: z.array(CanonFutureEventSchema).min(3).max(5).optional()
    .describe("将临之事：作者侧未来候选事件，对玩家隐藏"),
  style: StyleCardSchema,
  theme: ThemeCardSchema,
};

const PantheonWorldDeckObjectSchema = z.object({
  mode: z.literal("pantheon"),
  ...SharedWorldDeckShape,
  playerGod: PlayerGodCardSchema,
  majorGods: z.array(MajorGodCardSchema).min(4).max(10),
}).strict();

const CreatorWorldDeckObjectSchema = z.object({
  mode: z.literal("creator"),
  ...SharedWorldDeckShape,
  majorGods: z.array(CreatorMajorGodCardSchema).min(4).max(10),
}).strict();

/** Compatibility-only cards used after a positively identified pre-ability draft. */
const LegacyPlayerGodCardSchema = PlayerGodCardSchema.extend({
  abilities: z.array(DivineDeckAbilitySchema).max(6),
});
const LegacyMajorGodCardSchema = MajorGodCardSchema.extend({
  abilities: z.array(DivineDeckAbilitySchema).max(6),
});
const LegacyRaceCardSchema = RaceCardSchema.extend({
  abilities: z.array(RaceDeckAbilitySchema).max(5),
});
const LegacyMajorCharacterCardSchema = MajorCharacterCardSchema.extend({
  abilities: z.array(PersonalDeckAbilitySchema).max(5),
});

const LegacyWorldDeckObjectSchema = z.object({
  mode: z.literal("pantheon"),
  worldName: z.string(),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable().describe("仅多IP融合时非空"),
  playerGod: LegacyPlayerGodCardSchema,
  majorGods: z.array(LegacyMajorGodCardSchema).min(4).max(10),
  minorGods: z.array(MinorGodSchema),
  factions: z.array(FactionCardSchema).min(2).max(8),
  races: z.array(LegacyRaceCardSchema),
  majorCharacters: z.array(LegacyMajorCharacterCardSchema).max(12),
  places: z.array(PlaceCardSchema),
  epochConflict: EpochConflictCardSchema,
  style: StyleCardSchema,
  theme: ThemeCardSchema,
});

type DeckReferenceGraph = {
  mode: "pantheon" | "creator";
  playerGod?: { ref: string; abilities: Array<{ ref: string }> };
  majorGods: Array<{ ref: string; abilities: Array<{ ref: string }> }>;
  races: Array<{ ref: string; abilities: Array<{ ref: string }> }>;
  factions: Array<{ ref: string }>;
  majorCharacters: Array<{
    ref: string;
    abilities: Array<{ ref: string }>;
    racialOverrides: Array<{ ref: string }>;
  }>;
  places: Array<{ ref: string }>;
  canonEvents?: Array<{ ref: string }>;
};

function addUniqueRef(
  ctx: z.RefinementCtx,
  seen: Map<string, (string | number)[]>,
  ref: string,
  path: (string | number)[],
): void {
  if (ref.trim() === "") return;
  const firstPath = seen.get(ref);
  if (firstPath !== undefined) {
    ctx.addIssue({
      code: "custom",
      path,
      message: `稳定 ref "${ref}" 与 ${firstPath.join(".")} 重复`,
    });
    return;
  }
  seen.set(ref, path);
}

/** Every card ref and ability ref has one unambiguous namespace. */
function validateModeAwareDeckReferenceUniqueness(
  deck: DeckReferenceGraph,
  ctx: z.RefinementCtx,
): void {
  const cardRefs = new Map<string, (string | number)[]>();
  const abilityRefs = new Map<string, (string | number)[]>();
  const addAbility = (ability: { ref: string }, path: (string | number)[]) =>
    addUniqueRef(ctx, abilityRefs, ability.ref, path);

  if (deck.mode === "pantheon" && deck.playerGod) {
    addUniqueRef(ctx, cardRefs, deck.playerGod.ref, ["playerGod", "ref"]);
    deck.playerGod.abilities.forEach((ability, index) =>
      addAbility(ability, ["playerGod", "abilities", index, "ref"]),
    );
  }
  deck.majorGods.forEach((god, godIndex) => {
    addUniqueRef(ctx, cardRefs, god.ref, ["majorGods", godIndex, "ref"]);
    god.abilities.forEach((ability, abilityIndex) =>
      addAbility(ability, ["majorGods", godIndex, "abilities", abilityIndex, "ref"]),
    );
  });
  deck.races.forEach((race, raceIndex) => {
    addUniqueRef(ctx, cardRefs, race.ref, ["races", raceIndex, "ref"]);
    race.abilities.forEach((ability, abilityIndex) =>
      addAbility(ability, ["races", raceIndex, "abilities", abilityIndex, "ref"]),
    );
  });
  deck.factions.forEach((faction, index) =>
    addUniqueRef(ctx, cardRefs, faction.ref, ["factions", index, "ref"]),
  );
  deck.places.forEach((place, index) =>
    addUniqueRef(ctx, cardRefs, place.ref, ["places", index, "ref"]),
  );
  deck.majorCharacters.forEach((character, characterIndex) => {
    addUniqueRef(ctx, cardRefs, character.ref, ["majorCharacters", characterIndex, "ref"]);
    character.abilities.forEach((ability, abilityIndex) =>
      addAbility(ability, ["majorCharacters", characterIndex, "abilities", abilityIndex, "ref"]),
    );
    character.racialOverrides.forEach((override, overrideIndex) =>
      addAbility(override, ["majorCharacters", characterIndex, "racialOverrides", overrideIndex, "ref"]),
    );
  });
  deck.canonEvents?.forEach((event, index) =>
    addUniqueRef(ctx, cardRefs, event.ref, ["canonEvents", index, "ref"]),
  );
}

/** Structural view of the deck fields the canon future axis validator reads. */
type CanonAxisDeckView = {
  temporalAnchor?: { anchorOrdinal: number };
  playerGod?: { ref: string };
  majorGods: Array<{ ref: string }>;
  races: Array<{ ref: string }>;
  factions: Array<{ ref: string }>;
  places: Array<{ ref: string }>;
  majorCharacters: Array<{ ref: string }>;
  canonEvents?: CanonFutureEvent[];
};

/**
 * 将临之事整轴校验：ordinal 严格递增（同时保证唯一）、每个参与者与条件引用
 * 都必须解析到既有卡组稳定 ref、prior_event_occurred 只准指向数组中更早的事件。
 * 卡组携带 temporalAnchor 时，epoch=future ⇔ ordinal > anchorOrdinal（§5.3 序数时间轴）。
 */
function validateCanonFutureAxis(deck: CanonAxisDeckView, ctx: z.RefinementCtx): void {
  const events = deck.canonEvents;
  if (events === undefined) return;

  const anchorOrdinal = deck.temporalAnchor?.anchorOrdinal;

  const cardRefs = new Set<string>([
    ...(deck.playerGod === undefined ? [] : [deck.playerGod.ref]),
    ...deck.majorGods.map((god) => god.ref),
    ...deck.races.map((race) => race.ref),
    ...deck.factions.map((faction) => faction.ref),
    ...deck.places.map((place) => place.ref),
    ...deck.majorCharacters.map((character) => character.ref),
  ]);
  const requireCardRef = (ref: string, path: (string | number)[]) => {
    if (cardRefs.has(ref)) return;
    ctx.addIssue({
      code: "custom",
      path,
      message: `将临之事引用 "${ref}" 未解析到任何卡组稳定 ref`,
    });
  };

  let previousOrdinal: number | null = null;
  const earlierEventRefs = new Set<string>();
  events.forEach((event, index) => {
    if (previousOrdinal !== null && event.ordinal <= previousOrdinal) {
      ctx.addIssue({
        code: "custom",
        path: ["canonEvents", index, "ordinal"],
        message: `将临之事 ordinal 必须按数组顺序严格递增：${previousOrdinal} 之后出现 ${event.ordinal}`,
      });
    }
    if (anchorOrdinal !== undefined && event.ordinal <= anchorOrdinal) {
      ctx.addIssue({
        code: "custom",
        path: ["canonEvents", index, "ordinal"],
        message: `epoch=future 的将临之事 ordinal 必须大于锚点 anchorOrdinal ${anchorOrdinal}：收到 ${event.ordinal}`,
      });
    }
    previousOrdinal = event.ordinal;

    event.participantRefs.forEach((ref, refIndex) =>
      requireCardRef(ref, ["canonEvents", index, "participantRefs", refIndex]),
    );
    for (const [groupKey, group] of [
      ["prerequisites", event.prerequisites],
      ["blockers", event.blockers],
    ] as const) {
      group.forEach((condition, conditionIndex) => {
        const path = ["canonEvents", index, groupKey, conditionIndex] as (string | number)[];
        if (condition.kind === "entity_status") {
          requireCardRef(condition.entityRef, [...path, "entityRef"]);
        } else if (condition.kind === "relation_status") {
          requireCardRef(condition.sourceRef, [...path, "sourceRef"]);
          requireCardRef(condition.targetRef, [...path, "targetRef"]);
        } else if (
          condition.kind === "prior_event_occurred"
          && !earlierEventRefs.has(condition.canonEventRef)
        ) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "canonEventRef"],
            message: `prior_event_occurred 只能引用数组中更早的将临之事："${condition.canonEventRef}"`,
          });
        }
      });
    }
    event.expectedConsequences.forEach((consequence, consequenceIndex) => {
      const path = ["canonEvents", index, "expectedConsequences", consequenceIndex] as (string | number)[];
      if (consequence.kind === "status_change") {
        requireCardRef(consequence.targetRef, [...path, "targetRef"]);
      } else if (consequence.kind === "relation_change") {
        requireCardRef(consequence.sourceRef, [...path, "sourceRef"]);
        requireCardRef(consequence.targetRef, [...path, "targetRef"]);
      }
    });
    earlierEventRefs.add(event.ref);
  });
}

/** Structural view of the deck fields the anchor-relations validator reads. */
type RelationsAtAnchorDeckView = {
  playerGod?: { ref: string };
  majorGods: Array<{ ref: string }>;
  races: Array<{ ref: string }>;
  factions: Array<{ ref: string }>;
  places: Array<{ ref: string }>;
  majorCharacters: Array<{ ref: string; statusAtAnchor?: string }>;
  relationsAtAnchor?: Array<{ sourceRef: string; targetRef: string }>;
};

/** §7 阶段 2 有界关系：每名 active 人物至多 4 条（下限 1 条由提示词与审计把守）。 */
const MAX_RELATIONS_PER_ACTIVE_CHARACTER = 4;

/**
 * 锚点关系校验（§7 阶段 2）：sourceRef/targetRef 必须解析到既有卡组稳定 ref；
 * 每名 active 人物（statusAtAnchor 缺省视为 active）作为关系主体至多 4 条。
 */
function validateRelationsAtAnchor(deck: RelationsAtAnchorDeckView, ctx: z.RefinementCtx): void {
  const relations = deck.relationsAtAnchor;
  if (relations === undefined) return;

  const cardRefs = new Set<string>([
    ...(deck.playerGod === undefined ? [] : [deck.playerGod.ref]),
    ...deck.majorGods.map((god) => god.ref),
    ...deck.races.map((race) => race.ref),
    ...deck.factions.map((faction) => faction.ref),
    ...deck.places.map((place) => place.ref),
    ...deck.majorCharacters.map((character) => character.ref),
  ]);
  const activeCharacterRefs = new Set(
    deck.majorCharacters
      .filter((character) => (character.statusAtAnchor ?? "active") === "active")
      .map((character) => character.ref),
  );

  const relationCountBySource = new Map<string, number>();
  relations.forEach((relation, index) => {
    for (const [key, ref] of [
      ["sourceRef", relation.sourceRef],
      ["targetRef", relation.targetRef],
    ] as const) {
      if (cardRefs.has(ref)) continue;
      ctx.addIssue({
        code: "custom",
        path: ["relationsAtAnchor", index, key],
        message: `锚点关系引用 "${ref}" 未解析到任何卡组稳定 ref`,
      });
    }
    if (!activeCharacterRefs.has(relation.sourceRef)) return;
    const count = (relationCountBySource.get(relation.sourceRef) ?? 0) + 1;
    relationCountBySource.set(relation.sourceRef, count);
    if (count === MAX_RELATIONS_PER_ACTIVE_CHARACTER + 1) {
      ctx.addIssue({
        code: "custom",
        path: ["relationsAtAnchor", index, "sourceRef"],
        message: `active 人物 "${relation.sourceRef}" 的锚点关系超过上限 ${MAX_RELATIONS_PER_ACTIVE_CHARACTER} 条——每名 active 人物 1–4 条锚点相关关系`,
      });
    }
  });
}

/** Single superRefine entry combining reference uniqueness and the canon future axis. */
function validateDeckIntegrity(
  deck: DeckReferenceGraph & {
    canonEvents?: CanonFutureEvent[];
    temporalAnchor?: { anchorOrdinal: number };
    relationsAtAnchor?: Array<{ sourceRef: string; targetRef: string }>;
  },
  ctx: z.RefinementCtx,
): void {
  validateModeAwareDeckReferenceUniqueness(deck, ctx);
  validateCanonFutureAxis(deck, ctx);
  validateRelationsAtAnchor(deck, ctx);
}

/** Strict contracts for new Genesis output and rerolls. */
export const PantheonWorldDeckSchema = PantheonWorldDeckObjectSchema.superRefine(
  validateDeckIntegrity,
);
export const CreatorWorldDeckSchema = CreatorWorldDeckObjectSchema.superRefine(
  validateDeckIntegrity,
);
const StrictWorldDeckSchema = z.discriminatedUnion("mode", [
  PantheonWorldDeckSchema,
  CreatorWorldDeckSchema,
]);

/** Compatibility parser used only after isLegacyWorldDeck() positively identifies an old draft. */
export const LegacyWorldDeckSchema = LegacyWorldDeckObjectSchema.superRefine(
  validateModeAwareDeckReferenceUniqueness,
);

export type PantheonWorldDeck = z.infer<typeof PantheonWorldDeckSchema>;
export type CreatorWorldDeck = z.infer<typeof CreatorWorldDeckSchema>;
export type LegacyWorldDeck = z.infer<typeof LegacyWorldDeckSchema>;
export type MajorGodCard = z.infer<typeof MajorGodCardSchema>;
export type CreatorMajorGodCard = z.infer<typeof CreatorMajorGodCardSchema>;
export type PlayerGodCard = z.infer<typeof PlayerGodCardSchema>;
export type WorldDeck = PantheonWorldDeck | CreatorWorldDeck;
export const WorldDeckSchema = StrictWorldDeckSchema;

type LooseRecord = Record<string, unknown>;

function isLooseRecord(value: unknown): value is LooseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asLooseRecord(value: unknown): LooseRecord {
  return isLooseRecord(value) ? value : {};
}

function hasOwn(value: LooseRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function lacksOwnFields(value: unknown, fields: readonly string[]): boolean {
  return isLooseRecord(value) && fields.every((field) => !hasOwn(value, field));
}

function allRecordsLackFields(value: unknown, fields: readonly string[]): boolean {
  return Array.isArray(value) && value.every((record) => lacksOwnFields(record, fields));
}

function normalizeAbilities(value: unknown, prefix: string): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((rawAbility, index) => {
    const ability = asLooseRecord(rawAbility);
    return {
      ...ability,
      ...(hasOwn(ability, "ref") ? {} : { ref: `${prefix}-ability-${index + 1}` }),
    };
  });
}

function normalizeRacialOverrides(value: unknown, prefix: string): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((rawOverride, index) => {
    const override = asLooseRecord(rawOverride);
    return {
      ...override,
      ...(hasOwn(override, "ref") ? {} : { ref: `${prefix}-override-${index + 1}` }),
      ...(hasOwn(override, "name") ? {} : { name: `先天覆写${index + 1}` }),
      ...(hasOwn(override, "kind") ? {} : { kind: "racial_innate" }),
      ...(hasOwn(override, "effect") ? {} : { effect: "沿用来源能力的效果" }),
      ...(hasOwn(override, "trigger") ? {} : { trigger: "沿用来源能力的触发条件" }),
      ...(hasOwn(override, "cost") ? {} : { cost: "沿用来源能力的代价" }),
      ...(hasOwn(override, "limitations") ? {} : { limitations: "沿用来源能力的限制" }),
      ...(hasOwn(override, "mastery") ? {} : { mastery: "adept" }),
      ...(hasOwn(override, "state") ? {} : { state: "normal" }),
      ...(hasOwn(override, "visibility") ? {} : { visibility: "known" }),
      ...(hasOwn(override, "rumorText") ? {} : { rumorText: null }),
      ...(hasOwn(override, "bloodlineJustification") ? {} : { bloodlineJustification: null }),
    };
  });
}

/**
 * Returns true only for a complete pre-ability-era fingerprint.
 *
 * Compatibility normalization may synthesize stable refs and empty collections, so
 * it must never run for partially migrated or damaged current decks. A legacy
 * draft therefore has no majorCharacters and no ability-era field on any entity.
 */
export function isLegacyWorldDeck(raw: unknown): boolean {
  if (!isLooseRecord(raw)) {
    return false;
  }

  return (
    (!hasOwn(raw, "mode") || raw.mode === "pantheon") &&
    !hasOwn(raw, "majorCharacters") &&
    lacksOwnFields(raw.playerGod, ["ref", "abilities"]) &&
    allRecordsLackFields(raw.majorGods, ["ref", "abilities"]) &&
    allRecordsLackFields(raw.factions, ["ref", "keyCharacterRefs"]) &&
    allRecordsLackFields(raw.races, ["ref", "abilities"])
  );
}

/**
 * Parses a persisted draft strictly unless its missing fields positively identify
 * it as pre-ability legacy data.
 */
function normalizePersistedPantheonDeck(raw: unknown): unknown {
  if (!isLooseRecord(raw)) return raw;
  const withMode = hasOwn(raw, "mode") ? raw : { mode: "pantheon", ...raw };
  if (!Array.isArray(withMode.places)) return withMode;
  return {
    ...withMode,
    places: withMode.places.map((rawPlace, index) => {
      const place = asLooseRecord(rawPlace);
      return hasOwn(place, "ref") ? place : { ...place, ref: `place-${index + 1}` };
    }),
  };
}

export function parsePersistedWorldDeck(raw: unknown): WorldDeck | LegacyWorldDeck {
  return isLegacyWorldDeck(raw)
    ? normalizeLegacyWorldDeck(raw)
    : WorldDeckSchema.parse(normalizePersistedPantheonDeck(raw));
}

/**
 * Migrates a persisted pre-ability draft into the compatibility card format.
 * It only supplies deterministic references and empty relationship/ability
 * collections; it never creates characters or abilities that were absent.
 */
export function normalizeLegacyWorldDeck(raw: unknown): LegacyWorldDeck {
  if (!isLegacyWorldDeck(raw)) {
    throw new Error("草稿不属于旧版兼容格式");
  }
  const deck = asLooseRecord(raw);
  const playerGod = asLooseRecord(deck.playerGod);
  const majorGods = Array.isArray(deck.majorGods) ? deck.majorGods : [];
  const factions = Array.isArray(deck.factions) ? deck.factions : [];
  const races = Array.isArray(deck.races) ? deck.races : [];
  const majorCharacters = Array.isArray(deck.majorCharacters) ? deck.majorCharacters : [];

  return LegacyWorldDeckSchema.parse({
    ...deck,
    mode: "pantheon",
    playerGod: {
      ...playerGod,
      ...(hasOwn(playerGod, "ref") ? {} : { ref: "player-god-1" }),
      ...(hasOwn(playerGod, "abilities") ? { abilities: normalizeAbilities(playerGod.abilities, "player-god-1") } : { abilities: [] }),
    },
    majorGods: majorGods.map((rawGod, index) => {
      const god = asLooseRecord(rawGod);
      const prefix = `major-god-${index + 1}`;
      return {
        ...god,
        ...(hasOwn(god, "ref") ? {} : { ref: prefix }),
        ...(hasOwn(god, "abilities") ? { abilities: normalizeAbilities(god.abilities, prefix) } : { abilities: [] }),
      };
    }),
    factions: factions.map((rawFaction, index) => {
      const faction = asLooseRecord(rawFaction);
      return {
        ...faction,
        ...(hasOwn(faction, "ref") ? {} : { ref: `faction-${index + 1}` }),
        ...(hasOwn(faction, "keyCharacterRefs") ? {} : { keyCharacterRefs: [] }),
      };
    }),
    races: races.map((rawRace, index) => {
      const race = asLooseRecord(rawRace);
      const prefix = `race-${index + 1}`;
      return {
        ...race,
        ...(hasOwn(race, "ref") ? {} : { ref: prefix }),
        ...(hasOwn(race, "abilities") ? { abilities: normalizeAbilities(race.abilities, prefix) } : { abilities: [] }),
      };
    }),
    places: Array.isArray(deck.places)
      ? deck.places.map((rawPlace, index) => {
        const place = asLooseRecord(rawPlace);
        return hasOwn(place, "ref") ? place : { ...place, ref: `place-${index + 1}` };
      })
      : [],
    majorCharacters: majorCharacters.map((rawCharacter, index) => {
      const character = asLooseRecord(rawCharacter);
      const prefix = `major-character-${index + 1}`;
      return {
        ...character,
        ...(hasOwn(character, "ref") ? {} : { ref: prefix }),
        ...(hasOwn(character, "factionMemberships") ? {} : { factionMemberships: [] }),
        ...(hasOwn(character, "learnedTraditionRefs") ? {} : { learnedTraditionRefs: [] }),
        ...(hasOwn(character, "racialOverrides")
          ? { racialOverrides: normalizeRacialOverrides(character.racialOverrides, prefix) }
          : { racialOverrides: [] }),
        ...(hasOwn(character, "abilities")
          ? { abilities: normalizeAbilities(character.abilities, prefix) }
          : { abilities: [] }),
      };
    }),
  });
}

/**
 * 卡片键（重掷粒度）。temporalAnchor/relationsAtAnchor 参与重掷 API 粒度；
 * 其编辑器 UI（时间校准卡、关系卡）随后续批次交付。
 */
export const DECK_CARD_KEYS = [
  "temporalAnchor",
  "cosmology",
  "fusionAxiom",
  "playerGod",
  "majorGods",
  "minorGods",
  "factions",
  "races",
  "majorCharacters",
  "relationsAtAnchor",
  "places",
  "epochConflict",
  "style",
  "theme",
] as const;
/**
 * 编辑器 UI 消费的卡片键：与 DECK_CARD_KEYS 同宽（阶段 1 只读时间校准卡落地后恢复全量）。
 * temporalAnchor/relationsAtAnchor 已进入 CARD_KEY_LABELS 等穷举映射；
 * 二者在确认页均无编辑/重掷入口——修改时间锚点 = 以同一神谕重新创世（设计稿 §13）。
 */
export type DeckCardKey = (typeof DECK_CARD_KEYS)[number];
