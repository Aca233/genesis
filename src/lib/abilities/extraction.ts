import {
  AbilityExtractionChangeSchema,
  type AbilityExtractionChange,
} from "@/lib/prompts/extractor";
import {
  applyAbilityChangeInTransaction,
  type AbilityEventRecord,
  type AbilityMutationClient,
  type AbilityMutationTx,
  type AbilityStoredRecord,
  type AppliedAbilityChange,
} from "./mutations";
import { z } from "zod";
import { AbilityOptimisticConflictError } from "./mutations";
import { AbilityValidationError } from "./validator";

export type AbilityExtractionOwner = {
  id: string;
  type: "race" | "character" | "god";
  name: string;
  aliases: string[];
  raceId: string | null;
};

export type AbilityEvidenceMessage = {
  id: string;
  index: number;
  content: string;
  scale: string;
};

type LearnedAbilityCreateData = Omit<AbilityStoredRecord, "id" | "version">;

export type AbilityExtractionTx = AbilityMutationTx & {
  ability: AbilityMutationTx["ability"] & {
    create(args: { data: LearnedAbilityCreateData }): Promise<AbilityStoredRecord>;
    delete(args: { where: { id: string } }): Promise<AbilityStoredRecord>;
  };
};

export interface AbilityExtractionClient
  extends Omit<AbilityMutationClient, "$transaction"> {
  $transaction<T>(
    operation: (tx: AbilityExtractionTx) => Promise<T>,
  ): Promise<T>;
}

export type AbilityExtractionInput = {
  timelineId: string;
  chapterId: string;
  owners: AbilityExtractionOwner[];
  messages: AbilityEvidenceMessage[];
  changes: unknown[];
  knownEntityNames?: string[];
};

export type RejectedAbilityExtraction = {
  index: number;
  change: unknown;
  reason: string;
};

export type AbilityExtractionResult = {
  applied: AppliedAbilityChange[];
  rejected: RejectedAbilityExtraction[];
};

function normalizedEvidence(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function assertEvidence(
  message: AbilityEvidenceMessage | undefined,
  evidence: string,
): asserts message is AbilityEvidenceMessage {
  if (message === undefined) {
    throw new AbilityValidationError("证据消息 index 不属于本章正文");
  }
  const excerpt = normalizedEvidence(evidence);
  if (excerpt.length < 12 || !normalizedEvidence(message.content).includes(excerpt)) {
    throw new AbilityValidationError("能力变化证据必须是所引消息中的连续正文摘录");
  }
}

function hasCompleteNewAbilityFields(
  change: AbilityExtractionChange,
): boolean {
  return (
    change.sourceAbilityId === undefined &&
    (change.type === "learned" || change.type === "awakened") &&
    change.name !== undefined &&
    change.kind !== undefined &&
    change.effect !== undefined &&
    change.trigger !== undefined &&
    change.cost !== undefined &&
    change.limitations !== undefined &&
    change.lockedFields !== undefined
  );
}

const TYPE_PATTERNS: Record<AbilityExtractionChange["type"], readonly RegExp[]> = {
  awakened: [
    /觉醒|苏醒|初(?:次|度).{0,6}(?:发动|显现)|终于(?:能|可以)/u,
    /首次稳定施展/u,
  ],
  learned: [
    /习得|学会|掌握|传授|授予|获授|传承|教导|拜师/u,
    /施展.{0,24}(?:越过|完成|成功|击败|抵达|救下|打开|穿过|登上)/u,
    /成功(?:研发|研制|创制|创造)|(?:研发|研制|创制|创造).{0,48}(?:正式命名|命名|定型|标准化|可反复|可复用)/u,
  ],
  improved: [/提升|精进|纯熟|熟练|突破|苦修|训练|演练|磨炼|臻于|更(?:快|强|稳|熟)/u],
  mutated: [/变异|异变|突变|蜕变|扭曲|变成|化作|转化为|改造成/u],
  impaired: [/受损|受伤|削弱|衰退|失灵|残缺|不再灵便/u],
  sealed: [/封印|封禁|禁锢|镇压|无法(?:发动|施展|使用)/u],
  restored: [/恢复|复原|解封|治愈|重获|修复|重新(?:能|可以)/u],
  lost: [/失去|遗失|丧失|忘却|废去|消散|再也不能/u],
  revealed: [/揭示|显露|暴露|目击|确认|识破|真相|众人看见/u],
  deprecated: [/废弃|废止|淘汰|弃用|失传|不再传承/u],
};

const SENTENCE_SPLIT = /[。！？!?；;\n]+/u;
const CLAUSE_SPLIT = /[，,：:]+/u;
const EXPLICIT_OBSERVER = /(?:在旁|一旁|旁边).{0,6}(?:观看|观望|旁观|目睹|听闻)|(?:观看|观望|旁观|目睹|听闻).{0,6}(?:在旁|一旁|旁边)|(?:看见|看到|目睹|听闻|听说|见证).{0,20}(?:终于|已经|开始|能够|能以|学会|习得|掌握)/u;
const SUBJECT_PRONOUN = /^(?:他|她|其|此人)(?:的)?/u;
const CONTINUED_SUBJECT = /^(?:今日|如今|此刻|随后|继而|并|又|且|现下)/u;
const CAUSATIVE = /(?:命令|让|令|指使|看着)/u;
const PERSON_NOUN = /师父|师傅|长老|导师|老师|族长|首领|祭司|弟子|徒弟|同伴|侍从|守卫|父亲|母亲|兄长|弟弟|姐姐|妹妹/u;
const CAPABILITY_RESULT = /(?:已能|终于能|可以|成功|独自)/u;
const MUTATION_RESULT = /(?:发生|产生|出现|开始|已然|彻底)?.{0,8}(?:变异|异变|突变|蜕变|扭曲|变成|化作|转化为|改造成)/u;
const EXTERNAL_EVENT_TYPES = new Set<AbilityExtractionChange["type"]>([
  "sealed", "lost", "impaired", "deprecated", "revealed",
]);

function firstPatternIndex(sentence: string, patterns: readonly RegExp[]): number {
  let result = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(sentence);
    if (match && (result < 0 || match.index < result)) result = match.index;
  }
  return result;
}

function identityNames(owner: AbilityExtractionOwner): string[] {
  return [owner.name, ...owner.aliases].filter(Boolean);
}

type EvidenceClause = { text: string; sentence: number };

function evidenceClauses(evidence: string): EvidenceClause[] {
  return evidence
    .split(SENTENCE_SPLIT)
    .flatMap((sentence, sentenceIndex) => sentence
      .split(CLAUSE_SPLIT)
      .map((text) => ({ text: text.trim(), sentence: sentenceIndex })))
    .filter((clause) => clause.text.length > 0);
}

function startsWithIdentity(text: string, names: readonly string[]): boolean {
  return names.some((name) => text.startsWith(name));
}

function learnedResultIndex(text: string): number {
  const explicit = firstPatternIndex(text, TYPE_PATTERNS.learned);
  const result = CAPABILITY_RESULT.exec(text);
  if (result === null) return explicit;
  const demonstrated = text.slice(result.index + result[0].length).replace(/^(?:独自|以|用|凭借|靠着)/u, "");
  if (!/[\p{Script=Han}]{2,}/u.test(demonstrated)) return explicit;
  return explicit < 0 ? result.index : Math.min(explicit, result.index);
}

function structuredValueIndex(text: string, change: AbilityExtractionChange): number {
  return Object.values(change.patch)
    .filter((value): value is string => typeof value === "string" && value.length >= 2)
    .map((value) => text.indexOf(value))
    .filter((position) => position >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
}

function changeResultIndex(text: string, change: AbilityExtractionChange): number {
  if (change.type === "learned") return learnedResultIndex(text);
  const action = firstPatternIndex(text, TYPE_PATTERNS[change.type]);
  if (change.type === "mutated") {
    const mutation = MUTATION_RESULT.exec(text);
    const changedValue = structuredValueIndex(text, change);
    if (mutation === null || changedValue < mutation.index) return -1;
    return mutation.index;
  }
  return action;
}

const INVALID_EVENT_CLAUSE = /(?:并没有|并未|从未|未能|没有|未(?!来)|失败|尝试|误会|证实[^，,。！？!?；;\n]{0,12}并非|后来[^，,。！？!?；;\n]{0,12}(?:恢复|仍在)|仍在)/u;
const EXTERNAL_ACTION: Partial<Record<AbilityExtractionChange["type"], string>> = {
  sealed: "(?:封印|封禁|禁锢|镇压)",
  lost: "(?:废去|夺去|剥夺|摧毁|抹去)",
  impaired: "(?:重击|重创|削弱|损伤|破坏)",
  deprecated: "(?:废弃|废止|淘汰|弃用)",
};
const EXTERNAL_RESULT: Partial<Record<AbilityExtractionChange["type"], string>> = {
  sealed: "(?:封印|封禁|禁锢|镇压|无法施展)",
  lost: "(?:失去|遗失|丧失|忘却|废去|消散)",
  impaired: "(?:受损|削弱|衰退|失灵|残缺)",
  deprecated: "(?:废弃|废止|淘汰|弃用|失传)",
};
const RELATION_GAP = "[^，,。！？!?；;\\n]{0,12}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function alternatives(values: readonly string[]): string {
  return `(?:${values.map(escapeRegExp).join("|")})`;
}

const TEMPORAL_CONNECTOR = /(?=之后|以后|后|但|却|终于|最终|随后)/u;

function hasAnyEventPattern(text: string): boolean {
  return Object.values(TYPE_PATTERNS).some((patterns) => firstPatternIndex(text, patterns) >= 0);
}

function finalRelevantSegment(text: string, abilityNames: readonly string[]): string | null {
  const relevant = text
    .split(TEMPORAL_CONNECTOR)
    .map((segment) => segment.trim())
    .filter((segment) =>
      abilityNames.some((name) => segment.includes(name)) || hasAnyEventPattern(segment),
    );
  return relevant.at(-1) ?? null;
}

function externalEventSupported(
  evidence: string,
  change: AbilityExtractionChange,
  ownerNames: readonly string[],
  abilityNames: readonly string[],
): boolean {
  if (!EXTERNAL_EVENT_TYPES.has(change.type)) return false;
  const owner = alternatives(ownerNames);
  const ability = alternatives(abilityNames);
  const ownedAbility = `${owner}的?${ability}`;
  return evidence.split(SENTENCE_SPLIT).map((sentence) => sentence.trim()).filter(Boolean).some((sentence) => {
    const eventSegment = finalRelevantSegment(sentence, abilityNames);
    if (eventSegment === null || INVALID_EVENT_CLAUSE.test(eventSegment)) return false;
    if (change.type === "revealed") {
      return new RegExp(
        `(?:确认|发现|查明|证实|揭示|识破)${RELATION_GAP}${owner}${RELATION_GAP}(?:拥有|会|掌握|身怀|会使用)${RELATION_GAP}${ability}`,
        "u",
      ).test(eventSegment);
    }
    const action = EXTERNAL_ACTION[change.type];
    const result = EXTERNAL_RESULT[change.type];
    if (action === undefined || result === undefined) return false;
    const particles = "(?:了|掉|彻底){0,3}";
    const actionToAbility = new RegExp(
      `${action}${particles}(?:被|将)?${ownedAbility}`,
      "u",
    );
    const abilityToResult = new RegExp(
      `${ownedAbility}(?:被|遭|受到|已)${particles}${result}`,
      "u",
    );
    return actionToAbility.test(eventSegment) || abilityToResult.test(eventSegment);
  });
}

function hasCompetingActor(
  textBeforeResult: string,
  ownerNames: readonly string[],
  knownEntityNames: readonly string[],
): boolean {
  const afterOwner = ownerNames.reduce((text, name) => text.startsWith(name) ? text.slice(name.length) : text, textBeforeResult);
  if (CAUSATIVE.test(afterOwner)) return true;
  if (PERSON_NOUN.test(afterOwner)) return true;
  return knownEntityNames.some((name) =>
    name.length > 0 && !ownerNames.includes(name) && afterOwner.includes(name),
  );
}

function assertRelevantEvidence(
  evidence: string,
  change: AbilityExtractionChange,
  owner: AbilityExtractionOwner,
  ability: Pick<AbilityStoredRecord, "name">,
  source: Pick<AbilityStoredRecord, "name"> | null,
  knownEntityNames: readonly string[],
): void {
  const abilityNames = [...new Set([ability.name, source?.name].filter((value): value is string => Boolean(value)))];
  const clauses = evidenceClauses(evidence);
  const ownerNames = identityNames(owner);
  const ownerSubjectSupported = clauses.some((clause, start) => {
    if (!startsWithIdentity(clause.text, ownerNames)) return false;

    const chain: EvidenceClause[] = [clause];
    for (let offset = 1; offset <= 2 && start + offset < clauses.length; offset += 1) {
      const next = clauses[start + offset]!;
      if (next.sentence - clause.sentence > 1) break;
      const subjectContinues = SUBJECT_PRONOUN.test(next.text) || CONTINUED_SUBJECT.test(next.text) || next.sentence === clause.sentence;
      if (!subjectContinues) break;
      chain.push(next);
    }
    const text = chain.map((part) => part.text).join("。");
    if (!abilityNames.some((name) => text.includes(name))) return false;
    const eventSegment = finalRelevantSegment(text, abilityNames);
    if (eventSegment === null) return false;
    const resultIndex = changeResultIndex(eventSegment, change);
    if (resultIndex < 0 || INVALID_EVENT_CLAUSE.test(eventSegment)) return false;
    const eventOffset = text.lastIndexOf(eventSegment);
    const beforeResult = text.slice(0, Math.max(0, eventOffset) + resultIndex);
    if (EXPLICIT_OBSERVER.test(beforeResult)) return false;
    if (hasCompetingActor(beforeResult, ownerNames, knownEntityNames)) return false;
    return true;
  });
  const valid = ownerSubjectSupported || externalEventSupported(
    evidence, change, ownerNames, abilityNames,
  );
  if (!valid) {
    throw new AbilityValidationError("正文证据必须以非否定的完整能力事件证明拥有者是行动主体，或明确证明拥有者能力受到外部事件影响，不能把命令者或他人误作行动者");
  }
}

const NEW_ABILITY_RECOVERY_PATTERNS: Record<"learned" | "awakened", RegExp> = {
  learned: /成功(?:研发|研制|创制|创造)|(?:研发|研制|创制|创造).{0,64}(?:正式命名|命名|定型|标准化|可反复|可复用)/u,
  awakened: /首次稳定施展/u,
};
const EVIDENCE_SENTENCE_PATTERN = /[^\n。！？!?；;]+(?:[。！？!?；;]+|$)/gu;
const TRAILING_SENTENCE_MARKS = /[。！？!?；;]+$/u;

function recoverNewAbilityEvidence(
  message: AbilityEvidenceMessage,
  change: AbilityExtractionChange,
  owner: AbilityExtractionOwner,
  knownEntityNames: readonly string[],
): string | null {
  if (!hasCompleteNewAbilityFields(change) || change.name === undefined) return null;
  const type = change.type;
  if (type !== "learned" && type !== "awakened") return null;
  const chunks = message.content.match(EVIDENCE_SENTENCE_PATTERN) ?? [message.content];
  const ownerNames = identityNames(owner);

  for (let width = 1; width <= 2; width += 1) {
    for (let start = 0; start + width <= chunks.length; start += 1) {
      const candidate = chunks
        .slice(start, start + width)
        .join("")
        .trim()
        .replace(TRAILING_SENTENCE_MARKS, "");
      if (
        normalizedEvidence(candidate).length < 12 ||
        !ownerNames.some((name) => candidate.includes(name)) ||
        !candidate.includes(change.name) ||
        !NEW_ABILITY_RECOVERY_PATTERNS[type].test(candidate)
      ) {
        continue;
      }
      try {
        assertEvidence(message, candidate);
        assertRelevantEvidence(
          candidate,
          change,
          owner,
          { name: change.name },
          null,
          knownEntityNames,
        );
        return candidate;
      } catch (error) {
        if (!(error instanceof AbilityValidationError)) throw error;
      }
    }
  }
  return null;
}

function resolveExtractionEvidence(
  message: AbilityEvidenceMessage | undefined,
  change: AbilityExtractionChange,
  owner: AbilityExtractionOwner,
  allowNewAbilityRecovery: boolean,
  knownEntityNames: readonly string[],
): string {
  try {
    assertEvidence(message, change.evidence);
    return change.evidence;
  } catch (error) {
    if (
      !(error instanceof AbilityValidationError) ||
      !allowNewAbilityRecovery ||
      message === undefined
    ) {
      throw error;
    }
    const recovered = recoverNewAbilityEvidence(
      message,
      change,
      owner,
      knownEntityNames,
    );
    if (recovered === null) throw error;
    return recovered;
  }
}

function ownerMap(owners: readonly AbilityExtractionOwner[]) {
  const byName = new Map<string, AbilityExtractionOwner>();
  for (const owner of owners) {
    byName.set(owner.name, owner);
    for (const alias of owner.aliases) byName.set(alias, owner);
  }
  return byName;
}

function assertAbilityOwner(
  ability: AbilityStoredRecord,
  owner: AbilityExtractionOwner,
  timelineId: string,
): void {
  if (ability.timelineId !== timelineId) {
    throw new AbilityValidationError("能力与本章必须处于同一时间线");
  }
  const belongsToOwner = owner.type === "god"
    ? ability.godId === owner.id && ability.entityId === null
    : ability.entityId === owner.id && ability.godId === null;
  if (!belongsToOwner) {
    throw new AbilityValidationError("能力不属于抽取项指定的拥有者");
  }
}

async function findLearnedAbility(
  tx: AbilityExtractionTx,
  ownerId: string,
  sourceAbilityId: string,
): Promise<AbilityStoredRecord | null> {
  return tx.ability.findFirst({
    where: {
      entityId: ownerId,
      sourceAbilityId,
      kind: { in: ["racial_innate", "racial_tradition"] },
      state: { notIn: ["lost", "deprecated"] },
      id: { not: sourceAbilityId },
    },
  });
}

const ABILITY_LOCK_FIELDS = new Set([
  "name", "kind", "effect", "trigger", "cost", "limitations", "mastery", "state",
  "visibility", "rumorText", "bloodlineJustification", "sourceAbilityId", "lockedFields",
]);

function newAbilityVisibility(change: AbilityExtractionChange): "known" | "rumored" | "hidden" {
  const inferred = /据说|传闻|听闻/u.test(change.evidence)
    ? "rumored"
    : /秘密|暗中|无人知晓|未被察觉/u.test(change.evidence)
      ? "hidden"
      : "known";
  if (change.visibility !== undefined && change.visibility !== inferred) {
    throw new AbilityValidationError("新能力 visibility 必须由正文证据支持");
  }
  return change.visibility ?? inferred;
}

function assertNewAbilityKind(owner: AbilityExtractionOwner, kind: string): void {
  const allowed = owner.type === "character"
    ? ["personal"]
    : owner.type === "god"
      ? ["divine"]
      : ["racial_innate", "racial_tradition"];
  if (!allowed.includes(kind)) {
    throw new AbilityValidationError(`${owner.type} 拥有者不能创建 kind=${kind}；允许 ${allowed.join("/")}`);
  }
}

async function findOwnedAbilityByName(
  tx: AbilityExtractionTx,
  owner: AbilityExtractionOwner,
  name: string,
): Promise<AbilityStoredRecord | null> {
  return (tx.ability as unknown as {
    findFirst(args: { where: { entityId?: string; godId?: string; name: string } }): Promise<AbilityStoredRecord | null>;
  }).findFirst({ where: owner.type === "god" ? { godId: owner.id, name } : { entityId: owner.id, name } });
}

function newAbilityData(
  timelineId: string,
  owner: AbilityExtractionOwner,
  change: AbilityExtractionChange,
): LearnedAbilityCreateData {
  if (change.type !== "learned" && change.type !== "awakened") {
    throw new AbilityValidationError("新能力只能以 learned 或 awakened 创建");
  }
  if (
    change.name === undefined || change.kind === undefined || change.effect === undefined ||
    change.trigger === undefined || change.cost === undefined || change.limitations === undefined ||
    change.lockedFields === undefined
  ) {
    throw new AbilityValidationError("新能力缺少完整字段");
  }
  assertNewAbilityKind(owner, change.kind);
  if (new Set(change.lockedFields).size !== change.lockedFields.length || change.lockedFields.some((field) => !ABILITY_LOCK_FIELDS.has(field))) {
    throw new AbilityValidationError("新能力 lockedFields 包含重复或未知字段");
  }
  const visibility = newAbilityVisibility(change);
  return {
    timelineId,
    entityId: owner.type === "god" ? null : owner.id,
    godId: owner.type === "god" ? owner.id : null,
    sourceAbilityId: null,
    name: change.name,
    kind: change.kind,
    effect: change.effect,
    trigger: change.trigger,
    cost: change.cost,
    limitations: change.limitations,
    mastery: "unawakened",
    state: "normal",
    visibility,
    rumorText: visibility === "rumored" ? change.rumorText ?? change.evidence : null,
    bloodlineJustification: null,
    lockedFields: change.lockedFields,
  };
}

async function normalizeMissingAbilityId(
  tx: AbilityExtractionTx,
  change: AbilityExtractionChange,
): Promise<{
  change: AbilityExtractionChange;
  recoveredMissingId: boolean;
}> {
  if (change.abilityId === undefined) {
    return { change, recoveredMissingId: false };
  }
  const ability = await tx.ability.findUnique({ where: { id: change.abilityId } });
  if (ability !== null || !hasCompleteNewAbilityFields(change)) {
    return { change, recoveredMissingId: false };
  }
  return {
    change: { ...change, abilityId: undefined },
    recoveredMissingId: true,
  };
}

async function resolveAbility(
  tx: AbilityExtractionTx,
  change: AbilityExtractionChange,
  owner: AbilityExtractionOwner,
  timelineId: string,
): Promise<{ ability: AbilityStoredRecord; created: boolean; reusedNew?: boolean }> {
  if (change.abilityId === undefined && change.sourceAbilityId === undefined) {
    const data = newAbilityData(timelineId, owner, change);
    const existing = await findOwnedAbilityByName(tx, owner, data.name);
    if (existing !== null) {
      assertAbilityOwner(existing, owner, timelineId);
      if (existing.kind !== data.kind) throw new AbilityValidationError("拥有者已存在同名不同 kind 能力");
      return { ability: existing, created: false, reusedNew: true };
    }
    return { ability: await tx.ability.create({ data }), created: true };
  }

  if (change.abilityId !== undefined) {
    const ability = await tx.ability.findUnique({ where: { id: change.abilityId } });
    if (ability === null) throw new AbilityValidationError("能力不存在");
    assertAbilityOwner(ability, owner, timelineId);
    if (
      change.sourceAbilityId !== undefined &&
      ability.sourceAbilityId !== change.sourceAbilityId
    ) {
      throw new AbilityValidationError("能力来源与抽取项 sourceAbilityId 不一致");
    }
    return { ability, created: false };
  }

  if (
    change.type !== "learned" ||
    change.sourceAbilityId === undefined ||
    owner.type !== "character"
  ) {
    throw new AbilityValidationError("只有人物习得族群技艺时可仅提供 sourceAbilityId");
  }

  const existing = await findLearnedAbility(tx, owner.id, change.sourceAbilityId);
  if (existing !== null) return { ability: existing, created: false };

  const source = await tx.ability.findUnique({
    where: { id: change.sourceAbilityId },
  });
  if (
    source === null ||
    source.timelineId !== timelineId ||
    source.entityId === null ||
    source.godId !== null ||
    source.sourceAbilityId !== null ||
    source.kind !== "racial_tradition"
  ) {
    throw new AbilityValidationError("learned 来源必须是本时间线的族群技艺模板");
  }
  if (owner.raceId === null || source.entityId !== owner.raceId) {
    throw new AbilityValidationError("族群技艺来源必须属于人物主种族，禁止跨种族习得");
  }

  return {
    ability: await tx.ability.create({
      data: learnedAbilityData(timelineId, owner.id, source),
    }),
    created: true,
  };
}

function learnedAbilityData(
  timelineId: string,
  ownerId: string,
  source: AbilityStoredRecord,
): LearnedAbilityCreateData {
  return {
    timelineId,
    entityId: ownerId,
    godId: null,
    sourceAbilityId: source.id,
    name: source.name,
    kind: source.kind,
    effect: source.effect,
    trigger: source.trigger,
    cost: source.cost,
    limitations: source.limitations,
    mastery: "unawakened",
    state: source.state,
    visibility: source.visibility,
    rumorText: source.rumorText,
    bloodlineJustification: null,
    lockedFields: source.lockedFields,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Applies all candidates in a caller-owned transaction. Known invalid items are rejected; infrastructure errors abort the transaction. */
export async function applyAbilityExtractionInTransaction(
  tx: AbilityExtractionTx,
  input: AbilityExtractionInput,
): Promise<AbilityExtractionResult> {
  const owners = ownerMap(input.owners);
  const messages = new Map(input.messages.map((message) => [message.index, message]));
  const applied: AppliedAbilityChange[] = [];
  const rejected: RejectedAbilityExtraction[] = [];

  for (const [index, rawChange] of input.changes.entries()) {
    const parsed = AbilityExtractionChangeSchema.safeParse(rawChange);
    if (!parsed.success) {
      rejected.push({ index, change: rawChange, reason: `能力变化格式校验失败：${parsed.error.issues[0]?.message ?? "字段无效"}` });
      continue;
    }
    const change: AbilityExtractionChange = parsed.data;
    let createdAbilityId: string | null = null;
    try {
      const owner = owners.get(change.ownerName);
      if (owner === undefined) throw new AbilityValidationError("能力拥有者不存在");
      const message = messages.get(change.evidenceMessageIndex);
      const normalized = await normalizeMissingAbilityId(tx, change);
      const allowNewAbilityRecovery = (
        normalized.recoveredMissingId ||
        (normalized.change.abilityId === undefined &&
          normalized.change.sourceAbilityId === undefined)
      );
      const evidence = resolveExtractionEvidence(
        message,
        normalized.change,
        owner,
        allowNewAbilityRecovery,
        input.knownEntityNames ?? [],
      );
      if (message === undefined) {
        throw new AbilityValidationError("证据消息 index 不属于本章正文");
      }
      const effectiveChange = { ...normalized.change, evidence };

      const resolved = await resolveAbility(tx, effectiveChange, owner, input.timelineId);
      const ability = resolved.ability;
      if (resolved.created) createdAbilityId = ability.id;
      const source: AbilityStoredRecord | null = ability.sourceAbilityId
        ? await tx.ability.findUnique({ where: { id: ability.sourceAbilityId } })
        : effectiveChange.sourceAbilityId
          ? await tx.ability.findUnique({ where: { id: effectiveChange.sourceAbilityId } })
          : null;
      assertRelevantEvidence(evidence, effectiveChange, owner, ability, source, input.knownEntityNames ?? []);
      const dedupeKey = [input.chapterId, ability.id, effectiveChange.type, message.id].join(":");
      const existingEvent: AbilityEventRecord | null = await tx.abilityEvent.findUnique({ where: { dedupeKey } });
      if (resolved.reusedNew === true && existingEvent === null) {
        throw new AbilityValidationError("拥有者已存在同名能力，不能重复创建");
      }
      const result = await applyAbilityChangeInTransaction(tx, {
        abilityId: ability.id,
        version: existingEvent?.before.version ?? ability.version,
        patch: effectiveChange.patch,
        event: {
          type: effectiveChange.type,
          chapterId: input.chapterId,
          messageId: message.id,
          evidence,
          scale: message.scale,
          dedupeKey,
        },
      });
      applied.push(result);
    } catch (error) {
      if (error instanceof AbilityValidationError || error instanceof AbilityOptimisticConflictError || error instanceof z.ZodError) {
        if (createdAbilityId !== null) await tx.ability.delete({ where: { id: createdAbilityId } });
        rejected.push({ index, change, reason: errorMessage(error) });
        continue;
      }
      throw error;
    }
  }
  return { applied, rejected };
}

/** Public boundary retaining per-call transaction semantics for non-pipeline callers. */
export async function applyAbilityExtraction(
  client: AbilityExtractionClient,
  input: AbilityExtractionInput,
): Promise<AbilityExtractionResult> {
  return client.$transaction((tx) => applyAbilityExtractionInTransaction(tx, input));
}
