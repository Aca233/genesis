import type { Scale } from "@/lib/cards/schemas";

/**
 * 对局界面前端类型 —— 对应 GET /api/worlds/[id]/state 契约。
 * 后端 Json 字段（persona/agenda/themeCard 等）以宽松可选结构承接，缺省容忍。
 */

/** 消息 meta（叙事契约 + 朱批标记） */
export type MessageMeta = {
  suggestions?: string[];
  chapterBreakHint?: boolean;
  edited?: boolean;
};

/** 异文候选 */
export type Variant = {
  content: string;
  meta?: MessageMeta;
  chosen: boolean;
};

/** Message 行（prisma shape，Json 已具体化） */
export type MessageRow = {
  id: string;
  chapterId: string;
  index: number;
  role: "player" | "narrator";
  content: string;
  scale: Scale | string;
  variants: Variant[] | null;
  meta: MessageMeta | null;
  createdAt: string;
};

export type AbilityKind = "racial_innate" | "racial_tradition" | "personal" | "divine";
export type AbilityMastery = "unawakened" | "novice" | "adept" | "expert" | "master";
export type AbilityState = "normal" | "enhanced" | "impaired" | "sealed" | "lost" | "deprecated";

/** 对玩家可见的能力 DTO：已知项完整，传闻项绝不含机制字段。 */
export type KnownAbilityView = {
  id: string;
  name: string;
  kind: AbilityKind;
  visibility: "known";
  effect: string;
  trigger: string;
  cost: string;
  limitations: string;
  mastery: AbilityMastery;
  state: AbilityState;
  rumorText: string | null;
  bloodlineJustification: string | null;
  sourceAbilityId: string | null;
  lockedFields: string[];
  version: number;
  /** 人物有效能力由种族模板默认继承时，详情接口附带。 */
  inherited?: boolean;
};

export type RumoredAbilityView = {
  id: string;
  name: string;
  kind: AbilityKind;
  visibility: "rumored";
  rumorText: string | null;
  state: AbilityState;
};

export type AbilityView = KnownAbilityView | RumoredAbilityView;

/** 能力沿革 DTO；传闻沿革仅提供揭示时间与传闻文本。 */
export type AbilityEventView = {
  abilityId: string;
  id?: string;
  type?: string;
  before?: unknown;
  after?: unknown;
  evidence?: string;
  scale?: string;
  createdAt?: string;
  revealedAt?: string;
  rumorText?: string | null;
};

export type CharacterMembershipView = {
  id: string;
  role: string;
  isPrimary: boolean;
  faction: { id: string; name: string; summary: string };
};

/** 神明关系：Pantheon 的 player 键或 Creator 的真实目标 God ID。 */
export type GodRelation = { label: string; note?: string };
export type GodRelations = {
  [targetGodId: string]: GodRelation | undefined;
  player?: GodRelation;
};

/** 议程卡（仅揭示后下发） */
export type GodAgenda = {
  longTermGoal?: string;
  shortTermGoals?: string[];
  methods?: string;
  stanceToPlayer?: { level?: string; motive?: string };
  schemes?: string[];
};

export type GodRow = {
  id: string;
  name: string;
  tier: "major" | "minor" | "player";
  isPlayer: boolean;
  rank: string;
  domains: string[];
  /** 玩家神 {origin, situation}；主神/次神 {text} */
  persona: { text?: string; origin?: string; situation?: string } | null;
  voice: unknown;
  faithScope: string | null;
  /** Pantheon uses `player`; creator worlds use persisted target God IDs. */
  relations: GodRelations | null;
  agenda: GodAgenda | null;
  agendaRevealed: boolean;
  abilities: AbilityView[];
};

// ── 世界核心卡（Json 宽松结构） ──

export type ThemeCard = {
  eraSystem?: string;
  rankNames?: Partial<Record<string, string>>;
  /** 众生录六类的世界观措辞（LLM 生成），如 faction→宗门势力 */
  typeNames?: Partial<Record<string, string>>;
  addressStyle?: string;
};

export type StyleCard = { preset?: string; presetName?: string; toneNotes?: string };

export type Cosmology = {
  origin?: string;
  powerSystem?: string;
  laws?: string;
  divinity?: string;
};

export type FusionAxiom = {
  sourceIps?: string[];
  axioms?: string[];
  powerMapping?: string;
  conflictRule?: string;
};

export type EpochConflict = {
  epochName?: string;
  yearLabel?: string;
  overtConflicts?: string[];
  hiddenCurrents?: string[];
};

export type WorldInfo = {
  id: string;
  name: string;
  mode: "pantheon" | "creator";
  status: string; // draft | playing | concluded
  genesisInput: string;
  themeCard: ThemeCard | null;
  styleCard: StyleCard | null;
  cosmology: Cosmology | null;
  fusionAxiom: FusionAxiom | null;
  /** 后端 state 暂未下发此卡（M1）；防御性预留，缺省时设定集页显示残卷占位 */
  epochConflict?: EpochConflict | null;
};

/** GET /api/worlds/[id]/state 全量 */
export type PlayState = {
  world: WorldInfo;
  timeline: {
    id: string;
    branchName: string;
    branchSummary: string | null;
    observerState: {
      focusType: "world" | "place" | "entity" | "god" | "avatar";
      focusId: string | null;
      timeLabel: string;
      viewpoint: "omniscient" | "limited";
      activeAvatarId: string | null;
    };
  };
  gods: GodRow[];
  currentChapter: { id: string; index: number; title: string | null };
  messages: MessageRow[];
  prevChapterTail: MessageRow[];
  recentRewrite: {
    id: string;
    decree: string;
    scope: string;
    status: string;
    summary: string | null;
    sourceTimelineId: string;
    resultTimelineId: string | null;
    createdAt: string;
  } | null;
};

/** 右缘符文抽屉页签（香炉为独立 Link，不在此列） */
export type DrawerTab = "starmap" | "chronicle" | "god" | "lore" | "codex";
