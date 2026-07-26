/**
 * 确定性时间一致性验证器（时间一致设计稿 §10.3，阶段 1 错误码 T1–T7）。
 *
 * 设计要点：
 * - 只有携带 temporalAnchor 卡的新契约卡组才会被检查；旧卡组（无该卡）跳过
 *   全部检查，行为字节不变（§17 迁移守护）。
 * - 所有谓词只在整数序数与闭合枚举上进行，零字符串时间比较（§5.3/§18.3）。
 * - 错误信息为中文并点名违规 ref，供现有 genesisRepairPrompt 修复路径直接消费
 *   （generate.ts 的 validationError 会整段进入修复提示词）。
 * - 输入采用结构化视图类型（先例：abilities/validator.ts 的
 *   WorldDeckReferenceGraph），既接受解析后的 WorldDeck，也允许阶段 3 的
 *   past 档正史事件与阶段 2 的追念成员标记（memorial）提前接入而无需改动本文件。
 */

export type TemporalIssueCode =
  | "ANCHOR_MISSING"                // T1
  | "DEAD_LEADER"                   // T2
  | "INACTIVE_FACTION_WITH_MEMBERS" // T3
  | "FUTURE_ABILITY_HELD"           // T4
  | "EVENT_ORDER_INVALID"           // T5
  | "TRADITION_NOT_YET_EXTANT"      // T6
  | "DANGLING_TEMPORAL_REF";        // T7

export interface TemporalIssue {
  code: TemporalIssueCode;
  message: string;
}

/** 展示用的「Tn 码名」前缀，修复提示词以此定位时间码。 */
const CODE_LABELS: Record<TemporalIssueCode, string> = {
  ANCHOR_MISSING: "T1 ANCHOR_MISSING",
  DEAD_LEADER: "T2 DEAD_LEADER",
  INACTIVE_FACTION_WITH_MEMBERS: "T3 INACTIVE_FACTION_WITH_MEMBERS",
  FUTURE_ABILITY_HELD: "T4 FUTURE_ABILITY_HELD",
  EVENT_ORDER_INVALID: "T5 EVENT_ORDER_INVALID",
  TRADITION_NOT_YET_EXTANT: "T6 TRADITION_NOT_YET_EXTANT",
  DANGLING_TEMPORAL_REF: "T7 DANGLING_TEMPORAL_REF",
};

export function formatTemporalIssues(issues: readonly TemporalIssue[]): string {
  const lines = issues.map((issue) => `[${CODE_LABELS[issue.code]}] ${issue.message}`);
  return `时间一致性校验失败（共 ${issues.length} 处）：\n${lines.join("\n")}`;
}

export class TemporalConsistencyError extends Error {
  override name = "TemporalConsistencyError";
  /**
   * 刻意不命名为 issues：generate.ts 的 describeValidationError 会把携带
   * issues 属性的错误按 zod 错误序列化，从而丢失聚合中文信息里的
   * 「[Tn 码名]」前缀与失败标题——修复提示词要消费的是 message 全文。
   */
  readonly temporalIssues: readonly TemporalIssue[];

  constructor(issues: readonly TemporalIssue[]) {
    super(formatTemporalIssues(issues));
    this.temporalIssues = issues;
  }
}

// ───────────────────────── 结构化视图类型 ─────────────────────────

interface TimedAbilityView {
  ref: string;
  name: string;
  /** 缺省视为 at_anchor（旧卡组兼容，与 DeckAbilitySchema 描述一致）。 */
  timing?: string;
}

interface AnchoredCardView {
  ref: string;
  name: string;
  statusAtAnchor?: string;
}

interface GodCardView extends AnchoredCardView {
  abilities: TimedAbilityView[];
}

interface FactionCardView extends AnchoredCardView {
  keyCharacterRefs: Array<{ ref: string }>;
}

interface RaceCardView extends AnchoredCardView {
  abilities: Array<{ ref: string; name: string }>;
}

interface CharacterCardView extends AnchoredCardView {
  factionMemberships: Array<{
    factionRef: string;
    role?: string;
    /** 阶段 2 追念关系标记；当前 schema 尚未携带，结构上先行兼容（§7/§10.3 豁免）。 */
    memorial?: boolean;
  }>;
  learnedTraditionRefs: Array<{ sourceAbilityRef: string }>;
  racialOverrides: TimedAbilityView[];
  abilities: TimedAbilityView[];
}

/**
 * 阶段 2 锚点关系视图（§7 relationsAtAnchor）：T3 追念豁免读取 memorial，
 * T7 解析 sourceRef/targetRef。其余字段（status/描述）与时间校验无关，不在此列。
 */
interface RelationAtAnchorView {
  sourceRef: string;
  targetRef: string;
  memorial?: boolean;
}

type TemporalConditionView =
  | { kind: "entity_status"; entityRef: string }
  | { kind: "relation_status"; sourceRef: string; targetRef: string }
  | { kind: "prior_event_occurred"; canonEventRef: string }
  | { kind: "ordinal_window" }
  | { kind: "custom" };

type TemporalConsequenceView =
  | { kind: "status_change"; targetRef: string }
  | { kind: "relation_change"; sourceRef: string; targetRef: string }
  | { kind: "custom" };

/**
 * 统一序数时间轴上的正史事件（§5.3）。现行卡组契约只产出 epoch="future" 的
 * 将临之事；epoch="past" 供阶段 3 全量 CanonEvent 入库后复用同一验证器。
 */
interface CanonEventView {
  ref: string;
  title: string;
  ordinal: number;
  epoch: "past" | "future";
  participantRefs: string[];
  prerequisites?: TemporalConditionView[];
  blockers?: TemporalConditionView[];
  expectedConsequences?: TemporalConsequenceView[];
}

export interface TemporalConsistencyDeckView {
  temporalAnchor?: {
    source: { basis: "original" | "single_ip" | "multi_ip" };
    anchor: { canonCutoff: string | null };
    anchorOrdinal: number;
  };
  playerGod?: GodCardView;
  majorGods: GodCardView[];
  factions: FactionCardView[];
  races: RaceCardView[];
  places: AnchoredCardView[];
  majorCharacters: CharacterCardView[];
  relationsAtAnchor?: RelationAtAnchorView[];
  canonEvents?: CanonEventView[];
}

// ───────────────────────── 谓词常量 ─────────────────────────

/** T2 只检查现役势力（active/forming）的领袖/关键人物。 */
const LEADER_CHECKED_FACTION_STATUSES = new Set(["active", "forming"]);
/** T3 只对已不复存在的势力检查现任成员。 */
const INACTIVE_FACTION_STATUSES = new Set(["dissolved", "destroyed", "historical"]);
/**
 * 「锚点时刻尚不存在」的状态集合（T5 past 事件参与者检查）。
 * 刻意不含 not_yet_ascended：尚未成神者以凡人身份存在，可以参与过去事件。
 */
const NOT_YET_EXISTING_STATUSES = new Set(["unborn", "not_yet_emerged", "not_yet_created"]);

/** statusAtAnchor 缺省视为 active（地点为 accessible），与 schema 描述一致。 */
function effectiveStatus(card: AnchoredCardView, fallback = "active"): string {
  return card.statusAtAnchor ?? fallback;
}

function label(card: { ref: string; name?: string; title?: string }): string {
  return `「${card.name ?? card.title ?? card.ref}」(${card.ref})`;
}

/** 追念豁免查询用的实体对键（JSON 编码避免 ref 内容造成歧义）。 */
function pairKey(left: string, right: string): string {
  return JSON.stringify([left, right]);
}

// ───────────────────────── 主入口 ─────────────────────────

/**
 * 收集卡组的全部时间一致性问题（不抛出）。
 * 卡组未携带 temporalAnchor 时视为旧契约，跳过全部检查并返回空数组。
 */
export function collectTemporalIssues(deck: TemporalConsistencyDeckView): TemporalIssue[] {
  const anchorCard = deck.temporalAnchor;
  if (anchorCard === undefined) return [];

  const issues: TemporalIssue[] = [];
  const push = (code: TemporalIssueCode, message: string) => issues.push({ code, message });

  const characters = new Map(deck.majorCharacters.map((card) => [card.ref, card]));
  const factions = new Map(deck.factions.map((card) => [card.ref, card]));

  /** 全卡 ref → 锚点状态视图（events 参与者可指向任意实体类型）。 */
  const allCards = new Map<string, { label: string; status: string }>();
  const registerCards = (cards: AnchoredCardView[], fallback = "active") => {
    for (const card of cards) {
      allCards.set(card.ref, { label: label(card), status: effectiveStatus(card, fallback) });
    }
  };
  if (deck.playerGod !== undefined) registerCards([deck.playerGod]);
  registerCards(deck.majorGods);
  registerCards(deck.races);
  registerCards(deck.factions);
  registerCards(deck.majorCharacters);
  registerCards(deck.places, "accessible");

  /** 种族模板能力 ref → 所属种族（T6/T7 传承来源解析）。 */
  const abilityToRace = new Map<string, RaceCardView>();
  for (const race of deck.races) {
    for (const ability of race.abilities) abilityToRace.set(ability.ref, race);
  }

  // ── T1 ANCHOR_MISSING：basis≠original ∧ canonCutoff=null（原创降级档豁免） ──
  if (anchorCard.source.basis !== "original" && anchorCard.anchor.canonCutoff === null) {
    push(
      "ANCHOR_MISSING",
      `IP 世界（basis=${anchorCard.source.basis}）缺少原作知识截止点 canonCutoff——必须给出截止点，截止点之后的原作事件在本世界视为尚未发生`,
    );
  }

  // ── T2 DEAD_LEADER：现役势力的领袖/关键人物必须锚点 active ──
  for (const faction of deck.factions) {
    const factionStatus = effectiveStatus(faction);
    if (!LEADER_CHECKED_FACTION_STATUSES.has(factionStatus)) continue;
    for (const { ref } of faction.keyCharacterRefs) {
      const character = characters.get(ref);
      if (character === undefined) continue; // 悬空引用由 T7 报告
      const characterStatus = effectiveStatus(character);
      if (characterStatus === "active") continue;
      push(
        "DEAD_LEADER",
        `势力${label(faction)}锚点状态为 ${factionStatus}，但其领袖/关键人物${label(character)}锚点状态为 ${characterStatus}——非 active 的人物不能担任现役势力的现任关键人物`,
      );
    }
  }

  // ── T3 INACTIVE_FACTION_WITH_MEMBERS：已消亡势力不得再有现任成员 ──
  // 豁免（§10.3 追念）：memorial=true 的成员关系；relationsAtAnchor 中人物与该势力
  // 之间的追念关系（阶段 2，memorial=true）；以及人物自身锚点非 active
  // （其成员关系属于历史记载，如「先王之子」的追念，而非现任关系）。
  const memorialPairs = new Set<string>();
  for (const relation of deck.relationsAtAnchor ?? []) {
    if (relation.memorial !== true) continue;
    memorialPairs.add(pairKey(relation.sourceRef, relation.targetRef));
    memorialPairs.add(pairKey(relation.targetRef, relation.sourceRef));
  }
  for (const character of deck.majorCharacters) {
    const characterStatus = effectiveStatus(character);
    for (const membership of character.factionMemberships) {
      const faction = factions.get(membership.factionRef);
      if (faction === undefined) continue; // 悬空引用由 T7 报告
      const factionStatus = effectiveStatus(faction);
      if (!INACTIVE_FACTION_STATUSES.has(factionStatus)) continue;
      if (membership.memorial === true) continue;
      if (memorialPairs.has(pairKey(character.ref, membership.factionRef))) continue;
      if (characterStatus !== "active") continue;
      push(
        "INACTIVE_FACTION_WITH_MEMBERS",
        `势力${label(faction)}锚点状态为 ${factionStatus}，但人物${label(character)}仍保持对它的现任成员关系（职务「${membership.role ?? "成员"}」）——已解散/覆灭/成为历史的势力不能再有现任成员`,
      );
    }
  }

  // ── T4 FUTURE_ABILITY_HELD：锚点 active 的人物/神不得持有 timing≠at_anchor 的能力 ──
  const checkHeldAbilities = (
    ownerKind: string,
    owner: AnchoredCardView,
    abilities: TimedAbilityView[],
  ) => {
    if (effectiveStatus(owner) !== "active") return;
    for (const ability of abilities) {
      const timing = ability.timing ?? "at_anchor";
      if (timing === "at_anchor") continue;
      const reason = timing === "future"
        ? "该能力在原作中于锚点之后才会获得，锚点时刻不能已持有"
        : "该能力在锚点之前已失去，不能仍列为现持能力";
      push(
        "FUTURE_ABILITY_HELD",
        `${ownerKind}${label(owner)}锚点状态为 active，但其能力${label(ability)}的 timing=${timing}——${reason}`,
      );
    }
  };
  if (deck.playerGod !== undefined) {
    checkHeldAbilities("玩家神", deck.playerGod, deck.playerGod.abilities);
  }
  for (const god of deck.majorGods) checkHeldAbilities("神明", god, god.abilities);
  for (const character of deck.majorCharacters) {
    checkHeldAbilities("人物", character, [...character.abilities, ...character.racialOverrides]);
  }

  // ── T5 EVENT_ORDER_INVALID：序数时间轴整数谓词 + 按事件时点判定的参与者检查 ──
  const events = deck.canonEvents ?? [];
  const anchorOrdinal = anchorCard.anchorOrdinal;
  const seenOrdinals = new Map<number, string>();
  for (const event of events) {
    const firstRef = seenOrdinals.get(event.ordinal);
    if (firstRef !== undefined) {
      push(
        "EVENT_ORDER_INVALID",
        `正史事件${label(event)}的 ordinal ${event.ordinal} 与事件 "${firstRef}" 重复——全局序数必须唯一`,
      );
    } else {
      seenOrdinals.set(event.ordinal, event.ref);
    }
    if (event.epoch === "past" && event.ordinal >= anchorOrdinal) {
      push(
        "EVENT_ORDER_INVALID",
        `epoch=past 的正史事件${label(event)}的 ordinal ${event.ordinal} 必须小于锚点 anchorOrdinal ${anchorOrdinal}——过去事件只能排在锚点之前`,
      );
    }
    if (event.epoch === "future" && event.ordinal <= anchorOrdinal) {
      push(
        "EVENT_ORDER_INVALID",
        `epoch=future 的正史事件${label(event)}的 ordinal ${event.ordinal} 必须大于锚点 anchorOrdinal ${anchorOrdinal}——将临之事只能排在锚点之后`,
      );
    }
    // 参与者按事件时点判定（§10.3 修订）：past 事件允许锚点已死的参与者（事发时
    // 尚在世）；future 事件允许锚点未生的参与者（事发时已出生），且不做其余状态
    // 检查（复活/回归等由前置条件与 AI 审计裁决）。唯一铁定矛盾：past 事件的参与
    // 者在锚点仍「尚不存在」——它发生在更早的过去，参与者当时必然也不存在。
    if (event.epoch === "past") {
      for (const ref of event.participantRefs) {
        const card = allCards.get(ref);
        if (card === undefined) continue; // 悬空引用由 T7 报告
        if (!NOT_YET_EXISTING_STATUSES.has(card.status)) continue;
        push(
          "EVENT_ORDER_INVALID",
          `epoch=past 的正史事件${label(event)}的参与者${card.label}在锚点状态为 ${card.status}——过去事件发生时该参与者尚不存在（past 事件允许已死参与者，但不允许尚未出现的参与者）`,
        );
      }
    }
  }

  // ── T6 TRADITION_NOT_YET_EXTANT：已习得传承的来源种族/传统在锚点必须已出现 ──
  for (const character of deck.majorCharacters) {
    for (const { sourceAbilityRef } of character.learnedTraditionRefs) {
      const race = abilityToRace.get(sourceAbilityRef);
      if (race === undefined) continue; // 悬空引用由 T7 报告
      if (effectiveStatus(race) !== "not_yet_emerged") continue;
      push(
        "TRADITION_NOT_YET_EXTANT",
        `人物${label(character)}已习得传承能力 "${sourceAbilityRef}"，但其来源种族${label(race)}在锚点状态为 not_yet_emerged——尚未出现的种族的传统不可能已被习得`,
      );
    }
  }

  // ── T7 DANGLING_TEMPORAL_REF：事件/关系/成员引用必须解析到既有 ref ──
  const requireCardRef = (ref: string, where: string) => {
    if (allCards.has(ref)) return;
    push("DANGLING_TEMPORAL_REF", `${where}引用了不存在的稳定 ref "${ref}"`);
  };
  const eventRefs = new Set(events.map((event) => event.ref));
  for (const event of events) {
    const where = `正史事件${label(event)}`;
    for (const ref of event.participantRefs) requireCardRef(ref, `${where}的参与者`);
    for (const [groupLabel, group] of [
      ["前置条件", event.prerequisites ?? []],
      ["阻断条件", event.blockers ?? []],
    ] as const) {
      for (const condition of group) {
        if (condition.kind === "entity_status") {
          requireCardRef(condition.entityRef, `${where}的${groupLabel}`);
        } else if (condition.kind === "relation_status") {
          requireCardRef(condition.sourceRef, `${where}的${groupLabel}`);
          requireCardRef(condition.targetRef, `${where}的${groupLabel}`);
        } else if (
          condition.kind === "prior_event_occurred"
          && !eventRefs.has(condition.canonEventRef)
        ) {
          push(
            "DANGLING_TEMPORAL_REF",
            `${where}的${groupLabel} prior_event_occurred 引用了不存在的正史事件 "${condition.canonEventRef}"`,
          );
        }
      }
    }
    for (const consequence of event.expectedConsequences ?? []) {
      if (consequence.kind === "status_change") {
        requireCardRef(consequence.targetRef, `${where}的预期后果`);
      } else if (consequence.kind === "relation_change") {
        requireCardRef(consequence.sourceRef, `${where}的预期后果`);
        requireCardRef(consequence.targetRef, `${where}的预期后果`);
      }
    }
  }
  // 阶段 2 锚点关系（§7 relationsAtAnchor）：主客体都必须解析到既有实体卡。
  deck.relationsAtAnchor?.forEach((relation, index) => {
    const where = `锚点关系 relationsAtAnchor[${index}]`;
    requireCardRef(relation.sourceRef, `${where}的主体`);
    requireCardRef(relation.targetRef, `${where}的客体`);
  });
  for (const faction of deck.factions) {
    for (const { ref } of faction.keyCharacterRefs) {
      if (characters.has(ref)) continue;
      push(
        "DANGLING_TEMPORAL_REF",
        `势力${label(faction)}的关键人物引用了不存在的人物 ref "${ref}"`,
      );
    }
  }
  for (const character of deck.majorCharacters) {
    for (const membership of character.factionMemberships) {
      if (factions.has(membership.factionRef)) continue;
      push(
        "DANGLING_TEMPORAL_REF",
        `人物${label(character)}的成员关系引用了不存在的势力 ref "${membership.factionRef}"`,
      );
    }
    for (const { sourceAbilityRef } of character.learnedTraditionRefs) {
      if (abilityToRace.has(sourceAbilityRef)) continue;
      push(
        "DANGLING_TEMPORAL_REF",
        `人物${label(character)}的已习得传承引用了不存在的种族能力 ref "${sourceAbilityRef}"`,
      );
    }
  }

  return issues;
}

/**
 * 确定性时间一致性校验（设计稿 §10.3）。发现问题时抛出聚合全部问题的
 * TemporalConsistencyError，错误信息整体进入现有创世修复路径。
 */
export function validateTemporalConsistency(deck: TemporalConsistencyDeckView): void {
  const issues = collectTemporalIssues(deck);
  if (issues.length > 0) {
    throw new TemporalConsistencyError(issues);
  }
}
