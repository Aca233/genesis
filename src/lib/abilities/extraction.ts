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

type AbilityExtractionTx = AbilityMutationTx & {
  ability: AbilityMutationTx["ability"] & {
    create(args: { data: LearnedAbilityCreateData }): Promise<AbilityStoredRecord>;
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

const TYPE_PATTERNS: Record<AbilityExtractionChange["type"], readonly RegExp[]> = {
  awakened: [/觉醒|苏醒|初(?:次|度).{0,4}(?:发动|显现)|终于能/],
  learned: [/习得|学会|掌握|传授|授予|传承|教导|拜师/, /终于(?:能|可以|会)(?:以|用|施展)?/],
  improved: [/提升|精进|纯熟|熟练|突破|苦修|训练|演练|磨炼|臻于|更(?:快|强|稳|熟)/],
  mutated: [/变异|异变|突变|蜕变|扭曲|变成|化作/],
  impaired: [/受损|受伤|削弱|衰退|失灵|残缺|不再灵便/],
  sealed: [/封印|封禁|禁锢|镇压|无法(?:发动|施展|使用)/],
  restored: [/恢复|复原|解封|治愈|重获|修复|重新(?:能|可以)/],
  lost: [/失去|遗失|丧失|忘却|废去|消散|再也不能/],
  revealed: [/揭示|显露|暴露|目击|确认|识破|真相|众人看见/],
  deprecated: [/废弃|废止|淘汰|弃用|失传|不再传承/],
};

const CLAUSE_SPLIT = /[。！？!?；;\n]+/u;
const OBSERVER_LINK = /(?:看见|看到|目睹|听说|发现|得知|见证).{0,16}(?:终于|已经|开始|能够|能以|学会|习得|掌握)/u;
const PRONOUN_LINK = /^(?:他|她|其|本人|自己).{0,10}(?:终于|已经|开始|能够|能以|学会|习得|掌握|觉醒|失去|封印)/u;

function identityNames(owner: AbilityExtractionOwner): string[] {
  return [owner.name, ...owner.aliases].filter(Boolean);
}

function assertRelevantEvidence(
  evidence: string,
  change: AbilityExtractionChange,
  owner: AbilityExtractionOwner,
  ability: AbilityStoredRecord,
  source: AbilityStoredRecord | null,
): void {
  const abilityNames = [...new Set([ability.name, source?.name].filter((value): value is string => Boolean(value)))];
  const clauses = evidence.split(CLAUSE_SPLIT).map((clause) => clause.trim()).filter(Boolean);
  const valid = clauses.some((clause, index) => {
    const fullAbility = abilityNames.some((name) => clause.includes(name));
    const ownerMention = identityNames(owner).find((name) => clause.includes(name));
    const previousOwnsPronoun = index > 0 && identityNames(owner).some((name) => clauses[index - 1]!.includes(name));
    const actorLinked = ownerMention !== undefined
      ? !OBSERVER_LINK.test(clause.slice(clause.indexOf(ownerMention) + ownerMention.length))
      : previousOwnsPronoun && PRONOUN_LINK.test(clause);
    const typeLinked = TYPE_PATTERNS[change.type].some((pattern) => pattern.test(clause));
    const structuredClue = Object.values(change.patch).some((value) =>
      typeof value === "string" && value.length >= 2 && clause.includes(value),
    );
    return fullAbility && actorLinked && (typeLinked || structuredClue);
  });
  if (!valid) {
    throw new AbilityValidationError("正文证据必须在同一子句明确连接拥有者行动、完整能力名与事件变化");
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

async function resolveAbility(
  tx: AbilityExtractionTx,
  change: AbilityExtractionChange,
  owner: AbilityExtractionOwner,
  timelineId: string,
): Promise<AbilityStoredRecord> {
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
    return ability;
  }

  if (
    change.type !== "learned" ||
    change.sourceAbilityId === undefined ||
    owner.type !== "character"
  ) {
    throw new AbilityValidationError("只有人物习得族群技艺时可仅提供 sourceAbilityId");
  }

  const existing = await findLearnedAbility(tx, owner.id, change.sourceAbilityId);
  if (existing !== null) return existing;

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

  return tx.ability.create({
    data: {
      timelineId,
      entityId: owner.id,
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
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies model-proposed ability deltas one at a time. Each item owns its
 * transaction, so an invalid proposal is rejected without rolling back valid
 * siblings. Evidence message IDs and scales always come from persisted prose,
 * never from model output.
 */
export async function applyAbilityExtraction(
  client: AbilityExtractionClient,
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
    try {
      const owner = owners.get(change.ownerName);
      if (owner === undefined) {
        throw new AbilityValidationError("能力拥有者不存在");
      }
      const message = messages.get(change.evidenceMessageIndex);
      assertEvidence(message, change.evidence);

      const result = await client.$transaction(async (tx) => {
        const ability = await resolveAbility(tx, change, owner, input.timelineId);
        const source = ability.sourceAbilityId
          ? await tx.ability.findUnique({ where: { id: ability.sourceAbilityId } })
          : change.sourceAbilityId
            ? await tx.ability.findUnique({ where: { id: change.sourceAbilityId } })
            : null;
        assertRelevantEvidence(change.evidence, change, owner, ability, source);
        const dedupeKey = [
          input.chapterId,
          ability.id,
          change.type,
          message.id,
        ].join(":");
        const existingEvent: AbilityEventRecord | null =
          await tx.abilityEvent.findUnique({ where: { dedupeKey } });

        return applyAbilityChangeInTransaction(tx, {
          abilityId: ability.id,
          version: existingEvent?.before.version ?? ability.version,
          patch: change.patch,
          event: {
            type: change.type,
            chapterId: input.chapterId,
            messageId: message.id,
            evidence: change.evidence,
            scale: message.scale,
            dedupeKey,
          },
        });
      });
      applied.push(result);
    } catch (error) {
      rejected.push({ index, change, reason: errorMessage(error) });
    }
  }

  return { applied, rejected };
}
