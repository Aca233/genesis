import { Prisma } from "@prisma/client";
import { validateAbilityReferenceGraph } from "@/lib/abilities/validator";
import {
  ObserverStateSchema,
  RealityStateSchema,
  RewritePlanSchema,
  type RewritePlan,
} from "./schemas";

const RESERVED_GOD_RELATION_KEYS = new Set(["player"]);

type ApplyRewritePlanInput = {
  worldId: string;
  timelineId: string;
  rewriteId: string;
  plan: RewritePlan;
};

type ApplyRewritePlanResult = {
  summary: string;
  consequenceLines: string[];
};

type ParsedPlan = ReturnType<typeof RewritePlanSchema.parse>;
type GodPatch = ParsedPlan["godPatches"][number];
type EntityPatch = ParsedPlan["entityPatches"][number];
type AbilityPatch = ParsedPlan["abilityPatches"][number];
type ChroniclePatch = ParsedPlan["chroniclePatches"][number];
type OmenPatch = ParsedPlan["omenPatches"][number];
type ObserverPatch = NonNullable<ParsedPlan["observerPatch"]>;

type ReferenceMaps = {
  god: Map<string, string>;
  entity: Map<string, string>;
  ability: Map<string, string>;
  chronicle: Map<string, string>;
};

function json(value: unknown) {
  return value === null
    ? Prisma.JsonNull
    : structuredClone(value) as Prisma.InputJsonValue;
}

function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null
    ? Prisma.DbNull
    : structuredClone(value) as Prisma.InputJsonValue;
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireRecord(value: Prisma.JsonValue | null, label: string): Record<string, Prisma.JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`);
  }
  return value as Record<string, Prisma.JsonValue>;
}

function requireTimelineTarget(
  ids: ReadonlySet<string>,
  id: string,
  label: string,
): string {
  if (!ids.has(id)) {
    throw new Error(`${label}不在目标时间线或不存在：${id}`);
  }
  return id;
}

function resolveRef(
  refs: ReadonlyMap<string, string>,
  existingIds: ReadonlySet<string>,
  ref: string,
  label: string,
): string {
  return refs.get(ref) ?? requireTimelineTarget(existingIds, ref, label);
}

function mapGodRelations(
  relations: Array<{ targetRef: string; label: string; note: string }>,
  refs: ReadonlyMap<string, string>,
  godIds: ReadonlySet<string>,
): Prisma.InputJsonValue {
  const mapped: Record<string, Prisma.InputJsonValue> = {};
  for (const relation of relations) {
    const targetId = resolveRef(refs, godIds, relation.targetRef, "神明关系目标");
    if (mapped[targetId] !== undefined) {
      throw new Error(`神明关系目标重复：${relation.targetRef}`);
    }
    mapped[targetId] = { label: relation.label, note: relation.note };
  }
  return mapped;
}

function godScalarData(value: {
  name?: string;
  aliases?: string[];
  tier?: string;
  rank?: string;
  domains?: string[];
  persona?: unknown | null;
  voice?: unknown | null;
  faithScope?: string | null;
}) {
  return {
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(value.aliases !== undefined ? { aliases: [...value.aliases] } : {}),
    ...(value.tier !== undefined ? { tier: value.tier } : {}),
    ...(value.rank !== undefined ? { rank: value.rank } : {}),
    ...(value.domains !== undefined ? { domains: [...value.domains] } : {}),
    ...(hasOwn(value, "persona") ? { persona: nullableJson(value.persona) } : {}),
    ...(hasOwn(value, "voice") ? { voice: nullableJson(value.voice) } : {}),
    ...(hasOwn(value, "faithScope") ? { faithScope: value.faithScope } : {}),
  };
}

function entityScalarData(value: {
  type?: string;
  name?: string;
  aliases?: string[];
  summary?: string;
  heat?: string;
  isMajorCharacter?: boolean;
  isCreatorAvatar?: boolean;
}) {
  return {
    ...(value.type !== undefined ? { type: value.type } : {}),
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(value.aliases !== undefined ? { aliases: [...value.aliases] } : {}),
    ...(value.summary !== undefined ? { summary: value.summary } : {}),
    ...(value.heat !== undefined ? { heat: value.heat } : {}),
    ...(value.isMajorCharacter !== undefined
      ? { isMajorCharacter: value.isMajorCharacter }
      : {}),
    ...(value.isCreatorAvatar !== undefined
      ? { isCreatorAvatar: value.isCreatorAvatar }
      : {}),
  };
}

function abilityScalarData(value: {
  name?: string;
  kind?: string;
  effect?: string;
  trigger?: string;
  cost?: string;
  limitations?: string;
  mastery?: string;
  state?: string;
  visibility?: string;
  rumorText?: string | null;
  bloodlineJustification?: string | null;
  lockedFields?: string[];
}) {
  return {
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(value.kind !== undefined ? { kind: value.kind } : {}),
    ...(value.effect !== undefined ? { effect: value.effect } : {}),
    ...(value.trigger !== undefined ? { trigger: value.trigger } : {}),
    ...(value.cost !== undefined ? { cost: value.cost } : {}),
    ...(value.limitations !== undefined ? { limitations: value.limitations } : {}),
    ...(value.mastery !== undefined ? { mastery: value.mastery } : {}),
    ...(value.state !== undefined ? { state: value.state } : {}),
    ...(value.visibility !== undefined ? { visibility: value.visibility } : {}),
    ...(hasOwn(value, "rumorText") ? { rumorText: value.rumorText } : {}),
    ...(hasOwn(value, "bloodlineJustification")
      ? { bloodlineJustification: value.bloodlineJustification }
      : {}),
    ...(value.lockedFields !== undefined ? { lockedFields: [...value.lockedFields] } : {}),
  };
}

function chronicleScalarData(value: {
  chapterIndex?: number;
  yearLabel?: string;
  text?: string;
  revealed?: boolean;
  revealedAtChapter?: number | null;
  source?: string;
}) {
  return {
    ...(value.chapterIndex !== undefined ? { chapterIndex: value.chapterIndex } : {}),
    ...(value.yearLabel !== undefined ? { yearLabel: value.yearLabel } : {}),
    ...(value.text !== undefined ? { text: value.text } : {}),
    ...(value.revealed !== undefined ? { revealed: value.revealed } : {}),
    ...(hasOwn(value, "revealedAtChapter")
      ? { revealedAtChapter: value.revealedAtChapter }
      : {}),
    ...(value.source !== undefined ? { source: value.source } : {}),
  };
}

async function assertEntityRemovalsAreExplicit(
  tx: Prisma.TransactionClient,
  timelineId: string,
  patches: readonly EntityPatch[],
  abilityPatches: readonly AbilityPatch[],
  chroniclePatches: readonly ChroniclePatch[],
  observerPatch: ObserverPatch | null,
): Promise<void> {
  const removals = new Set(
    patches.filter((patch) => patch.op === "remove").map((patch) => patch.targetId),
  );
  if (removals.size === 0) return;

  const entityPatchById = new Map(
    patches.filter((patch) => patch.op !== "create").map((patch) => [patch.targetId, patch]),
  );
  const abilityPatchById = new Map(
    abilityPatches.filter((patch) => patch.op !== "create").map((patch) => [patch.targetId, patch]),
  );
  const chroniclePatchById = new Map(
    chroniclePatches.filter((patch) => patch.op !== "create").map((patch) => [patch.targetId, patch]),
  );

  const [entities, memberships, abilities, chronicles, timeline] = await Promise.all([
    tx.entity.findMany({ where: { timelineId }, select: { id: true, raceId: true } }),
    tx.entityMembership.findMany({
      where: {
        OR: [
          { characterId: { in: [...removals] } },
          { factionId: { in: [...removals] } },
        ],
      },
    }),
    tx.ability.findMany({
      where: {
        timelineId,
        OR: [
          { entityId: { in: [...removals] } },
          { sourceAbility: { entityId: { in: [...removals] } } },
        ],
      },
      select: { id: true, entityId: true, sourceAbility: { select: { entityId: true } } },
    }),
    tx.chronicleEntry.findMany({ where: { timelineId } }),
    tx.timeline.findUniqueOrThrow({ where: { id: timelineId }, select: { observerState: true } }),
  ]);

  for (const entity of entities) {
    if (entity.raceId === null || !removals.has(entity.raceId) || removals.has(entity.id)) continue;
    const patch = entityPatchById.get(entity.id);
    if (patch?.op !== "update" || !hasOwn(patch.changes, "raceRef")) {
      throw new Error(`实体种族仍引用待删除实体：${entity.raceId}`);
    }
  }

  for (const membership of memberships) {
    if (!removals.has(membership.characterId) || !removals.has(membership.factionId)) {
      throw new Error(`成员关系仍引用待删除实体：${membership.id}`);
    }
  }

  for (const ability of abilities) {
    const patch = abilityPatchById.get(ability.id);
    const ownerRemoved = ability.entityId !== null && removals.has(ability.entityId);
    const sourceOwnerRemoved = ability.sourceAbility?.entityId !== null
      && ability.sourceAbility?.entityId !== undefined
      && removals.has(ability.sourceAbility.entityId);
    const repaired = patch?.op === "remove"
      || (patch?.op === "update" && (
        (ownerRemoved && patch.ownerRef !== undefined)
        || (sourceOwnerRemoved && hasOwn(patch.changes, "sourceAbilityRef"))
      ));
    if (!repaired) {
      throw new Error(`能力仍引用待删除实体：${ability.id}`);
    }
  }

  for (const chronicle of chronicles) {
    const referenced = chronicle.entityIds.some((id) => removals.has(id));
    if (!referenced) continue;
    const patch = chroniclePatchById.get(chronicle.id);
    if (patch?.op !== "remove" && (patch?.op !== "update" || patch.changes.entityRefs === undefined)) {
      throw new Error(`编年史仍引用待删除实体：${chronicle.id}`);
    }
  }

  if (timeline.observerState !== null) {
    const observer = ObserverStateSchema.parse(timeline.observerState);
    const repairsFocus = observerPatch?.focus !== undefined;
    const repairsAvatar = observerPatch !== null
      && hasOwn(observerPatch, "activeAvatarRef");
    if (
      (observer.focusId !== null && removals.has(observer.focusId) && !repairsFocus)
      || (observer.activeAvatarId !== null && removals.has(observer.activeAvatarId) && !repairsAvatar)
    ) {
      throw new Error("观察状态仍引用待删除实体");
    }
  }
}

async function assertGodRemovalsAreExplicit(
  tx: Prisma.TransactionClient,
  timelineId: string,
  patches: readonly GodPatch[],
  abilityPatches: readonly AbilityPatch[],
  chroniclePatches: readonly ChroniclePatch[],
  omenPatches: readonly OmenPatch[],
  observerPatch: ObserverPatch | null,
): Promise<void> {
  const removals = new Set(
    patches.filter((patch) => patch.op === "remove").map((patch) => patch.targetId),
  );
  if (removals.size === 0) return;

  const godPatchById = new Map(
    patches.filter((patch) => patch.op !== "create").map((patch) => [patch.targetId, patch]),
  );
  const abilityPatchById = new Map(
    abilityPatches.filter((patch) => patch.op !== "create").map((patch) => [patch.targetId, patch]),
  );
  const chroniclePatchById = new Map(
    chroniclePatches.filter((patch) => patch.op !== "create").map((patch) => [patch.targetId, patch]),
  );
  const omenPatchById = new Map(
    omenPatches.filter((patch) => patch.op !== "create").map((patch) => [patch.targetId, patch]),
  );
  const [gods, abilities, chronicles, omens, timeline] = await Promise.all([
    tx.god.findMany({ where: { timelineId }, select: { id: true, relations: true } }),
    tx.ability.findMany({ where: { timelineId, godId: { in: [...removals] } }, select: { id: true } }),
    tx.chronicleEntry.findMany({ where: { timelineId } }),
    tx.omenQueue.findMany({ where: { timelineId, godId: { in: [...removals] } } }),
    tx.timeline.findUniqueOrThrow({ where: { id: timelineId }, select: { observerState: true } }),
  ]);

  for (const god of gods) {
    if (removals.has(god.id) || god.relations === null) continue;
    const relations = requireRecord(god.relations, "神明关系");
    if (![...removals].some((id) => relations[id] !== undefined)) continue;
    const patch = godPatchById.get(god.id);
    if (patch?.op !== "update" || patch.changes.relations === undefined) {
      throw new Error(`神明关系仍引用待删除神明：${god.id}`);
    }
  }
  for (const ability of abilities) {
    if (abilityPatchById.get(ability.id)?.op !== "remove") {
      throw new Error(`能力仍属于待删除神明：${ability.id}`);
    }
  }
  for (const chronicle of chronicles) {
    if (!chronicle.godIds.some((id) => removals.has(id))) continue;
    const patch = chroniclePatchById.get(chronicle.id);
    if (patch?.op !== "remove" && (patch?.op !== "update" || patch.changes.godRefs === undefined)) {
      throw new Error(`编年史仍引用待删除神明：${chronicle.id}`);
    }
  }
  for (const omen of omens) {
    const patch = omenPatchById.get(omen.id);
    const repaired = patch?.op === "remove"
      || (patch?.op === "update" && patch.changes.godRef !== undefined);
    if (!repaired) throw new Error(`征兆仍引用待删除神明：${omen.id}`);
  }
  if (timeline.observerState !== null) {
    const observer = ObserverStateSchema.parse(timeline.observerState);
    if (
      observer.focusType === "god"
      && observer.focusId !== null
      && removals.has(observer.focusId)
      && observerPatch?.focus === undefined
    ) {
      throw new Error("观察状态仍引用待删除神明");
    }
  }
}

async function applyRealityCards(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
) {
  const timeline = await tx.timeline.findUniqueOrThrow({
    where: { id: timelineId },
    select: { realityState: true },
  });
  const state = RealityStateSchema.parse(timeline.realityState);
  for (const patch of plan.realityCardPatches) {
    state[patch.section] = patch.value as never;
  }
  const parsed = RealityStateSchema.parse(state);
  await tx.timeline.update({
    where: { id: timelineId },
    data: { realityState: json(parsed) },
  });
  return parsed;
}

async function applyGodPatches(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
  refs: ReferenceMaps,
): Promise<Set<string>> {
  const existing = await tx.god.findMany({ where: { timelineId }, select: { id: true } });
  const godIds = new Set(existing.map(({ id }) => id));

  await assertGodRemovalsAreExplicit(
    tx,
    timelineId,
    plan.godPatches,
    plan.abilityPatches,
    plan.chroniclePatches,
    plan.omenPatches,
    plan.observerPatch,
  );

  for (const patch of plan.godPatches) {
    if (patch.op !== "create") continue;
    const created = await tx.god.create({
      data: {
        timelineId,
        name: patch.value.name,
        aliases: [...patch.value.aliases],
        tier: patch.value.tier,
        isPlayer: false,
        rank: patch.value.rank,
        domains: [...patch.value.domains],
        persona: nullableJson(patch.value.persona),
        voice: nullableJson(patch.value.voice),
        agenda: Prisma.DbNull,
        relations: {},
        faithScope: patch.value.faithScope,
      },
    });
    refs.god.set(patch.tempRef, created.id);
    godIds.add(created.id);
  }

  for (const patch of plan.godPatches) {
    if (patch.op === "create") {
      const id = refs.god.get(patch.tempRef)!;
      await tx.god.update({
        where: { id },
        data: { relations: mapGodRelations(patch.value.relations, refs.god, godIds) },
      });
    } else if (patch.op === "update") {
      requireTimelineTarget(godIds, patch.targetId, "待更新神明");
      await tx.god.update({
        where: { id: patch.targetId },
        data: {
          ...godScalarData(patch.changes),
          ...(patch.changes.relations !== undefined
            ? { relations: mapGodRelations(patch.changes.relations, refs.god, godIds) }
            : {}),
        },
      });
    }
  }

  for (const patch of plan.godPatches) {
    if (patch.op !== "remove") continue;
    requireTimelineTarget(godIds, patch.targetId, "待删除神明");
    await tx.god.delete({ where: { id: patch.targetId } });
    godIds.delete(patch.targetId);
  }
  return godIds;
}

async function replaceEntitySections(
  tx: Prisma.TransactionClient,
  entityId: string,
  sections: Array<{ key: string; content: unknown; revealed: boolean; rumorText: string | null }>,
): Promise<void> {
  await tx.entitySection.deleteMany({ where: { entityId } });
  for (const section of sections) {
    await tx.entitySection.create({
      data: {
        entityId,
        key: section.key,
        content: json(section.content),
        revealed: section.revealed,
        rumorText: section.rumorText,
      },
    });
  }
}

async function applyAgendaPatches(
  tx: Prisma.TransactionClient,
  plan: ParsedPlan,
  refs: ReferenceMaps,
): Promise<void> {
  for (const patch of plan.godPatches) {
    if (patch.op === "remove") continue;
    const id = patch.op === "create" ? refs.god.get(patch.tempRef) : patch.targetId;
    if (id === undefined) throw new Error("神明议程缺少已解析目标");
    const agenda = patch.op === "create" ? patch.value.agenda : patch.changes.agenda;
    if (patch.op === "create" || hasOwn(patch.changes, "agenda")) {
      await tx.god.update({
        where: { id },
        data: { agenda: nullableJson(agenda) },
      });
    }
  }
}
async function applyEntityPatches(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
  refs: ReferenceMaps,
): Promise<Set<string>> {
  const existing = await tx.entity.findMany({ where: { timelineId }, select: { id: true } });
  const entityIds = new Set(existing.map(({ id }) => id));

  await assertEntityRemovalsAreExplicit(
    tx,
    timelineId,
    plan.entityPatches,
    plan.abilityPatches,
    plan.chroniclePatches,
    plan.observerPatch,
  );

  for (const patch of plan.entityPatches) {
    if (patch.op !== "create") continue;
    const created = await tx.entity.create({
      data: {
        timelineId,
        type: patch.value.type,
        name: patch.value.name,
        aliases: [...patch.value.aliases],
        emblemSeed: `rewrite:${patch.tempRef}`,
        isMajorCharacter: patch.value.isMajorCharacter,
        isCreatorAvatar: patch.value.isCreatorAvatar,
        raceId: null,
        heat: patch.value.heat,
        summary: patch.value.summary,
        lockedPaths: [],
      },
    });
    refs.entity.set(patch.tempRef, created.id);
    entityIds.add(created.id);
  }

  for (const patch of plan.entityPatches) {
    if (patch.op === "create") {
      const id = refs.entity.get(patch.tempRef)!;
      await tx.entity.update({
        where: { id },
        data: {
          raceId: patch.value.raceRef === null
            ? null
            : resolveRef(refs.entity, entityIds, patch.value.raceRef, "实体种族"),
        },
      });
      await replaceEntitySections(tx, id, patch.value.sections);
    } else if (patch.op === "update") {
      requireTimelineTarget(entityIds, patch.targetId, "待更新实体");
      await tx.entity.update({
        where: { id: patch.targetId },
        data: {
          ...entityScalarData(patch.changes),
          ...(patch.changes.raceRef !== undefined
            ? {
                raceId: patch.changes.raceRef === null
                  ? null
                  : resolveRef(refs.entity, entityIds, patch.changes.raceRef, "实体种族"),
              }
            : {}),
        },
      });
      if (patch.changes.sections !== undefined) {
        await replaceEntitySections(tx, patch.targetId, patch.changes.sections);
      }
    }
  }

  for (const patch of plan.entityPatches) {
    if (patch.op !== "remove") continue;
    requireTimelineTarget(entityIds, patch.targetId, "待删除实体");
    await tx.entity.delete({ where: { id: patch.targetId } });
    entityIds.delete(patch.targetId);
  }
  return entityIds;
}

function resolveAbilityOwner(
  ownerRef: string,
  refs: ReferenceMaps,
  entityIds: ReadonlySet<string>,
  godIds: ReadonlySet<string>,
): { entityId: string | null; godId: string | null } {
  const entityId = refs.entity.get(ownerRef) ?? (entityIds.has(ownerRef) ? ownerRef : null);
  const godId = refs.god.get(ownerRef) ?? (godIds.has(ownerRef) ? ownerRef : null);
  if (Number(entityId !== null) + Number(godId !== null) !== 1) {
    throw new Error(`能力 ownerRef 不在目标时间线或不唯一：${ownerRef}`);
  }
  return { entityId, godId };
}

async function applyAbilityPatches(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
  refs: ReferenceMaps,
  entityIds: ReadonlySet<string>,
  godIds: ReadonlySet<string>,
): Promise<Set<string>> {
  const existing = await tx.ability.findMany({ where: { timelineId }, select: { id: true } });
  const abilityIds = new Set(existing.map(({ id }) => id));

  for (const patch of plan.abilityPatches) {
    if (patch.op !== "create") continue;
    const owner = resolveAbilityOwner(patch.ownerRef, refs, entityIds, godIds);
    const created = await tx.ability.create({
      data: {
        timelineId,
        ...owner,
        name: patch.value.name,
        kind: patch.value.kind,
        effect: patch.value.effect,
        trigger: patch.value.trigger,
        cost: patch.value.cost,
        limitations: patch.value.limitations,
        mastery: patch.value.mastery,
        state: patch.value.state,
        visibility: patch.value.visibility,
        rumorText: patch.value.rumorText,
        bloodlineJustification: patch.value.bloodlineJustification,
        sourceAbilityId: null,
        lockedFields: [...patch.value.lockedFields],
      },
    });
    refs.ability.set(patch.tempRef, created.id);
    abilityIds.add(created.id);
  }

  for (const patch of plan.abilityPatches) {
    if (patch.op === "create") {
      const id = refs.ability.get(patch.tempRef)!;
      await tx.ability.update({
        where: { id },
        data: {
          sourceAbilityId: patch.value.sourceAbilityRef === null
            ? null
            : resolveRef(refs.ability, abilityIds, patch.value.sourceAbilityRef, "能力来源"),
        },
      });
    } else if (patch.op === "update") {
      requireTimelineTarget(abilityIds, patch.targetId, "待更新能力");
      await tx.ability.update({
        where: { id: patch.targetId },
        data: {
          ...abilityScalarData(patch.changes),
          ...(patch.ownerRef !== undefined
            ? resolveAbilityOwner(patch.ownerRef, refs, entityIds, godIds)
            : {}),
          ...(patch.changes.sourceAbilityRef !== undefined
            ? {
                sourceAbilityId: patch.changes.sourceAbilityRef === null
                  ? null
                  : resolveRef(
                      refs.ability,
                      abilityIds,
                      patch.changes.sourceAbilityRef,
                      "能力来源",
                    ),
              }
            : {}),
          version: { increment: 1 },
        },
      });
    }
  }

  for (const patch of plan.abilityPatches) {
    if (patch.op !== "remove") continue;
    requireTimelineTarget(abilityIds, patch.targetId, "待删除能力");
    await tx.ability.delete({ where: { id: patch.targetId } });
    abilityIds.delete(patch.targetId);
  }
  return abilityIds;
}

function resolveChronicleRefs(
  refsToResolve: readonly string[],
  tempRefs: ReadonlyMap<string, string>,
  existingIds: ReadonlySet<string>,
  label: string,
): string[] {
  return refsToResolve.map((ref) => resolveRef(tempRefs, existingIds, ref, label));
}

async function applyChroniclePatches(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
  refs: ReferenceMaps,
  entityIds: ReadonlySet<string>,
  godIds: ReadonlySet<string>,
): Promise<void> {
  if (plan.scope === "memory_only") return;
  const existing = await tx.chronicleEntry.findMany({
    where: { timelineId },
    select: { id: true },
  });
  const chronicleIds = new Set(existing.map(({ id }) => id));

  for (const patch of plan.chroniclePatches) {
    if (patch.op === "create") {
      const created = await tx.chronicleEntry.create({
        data: {
          timelineId,
          chapterIndex: patch.value.chapterIndex,
          yearLabel: patch.value.yearLabel,
          text: patch.value.text,
          revealed: patch.value.revealed,
          revealedAtChapter: patch.value.revealedAtChapter,
          source: patch.value.source,
          entityIds: resolveChronicleRefs(
            patch.value.entityRefs,
            refs.entity,
            entityIds,
            "编年史实体",
          ),
          godIds: resolveChronicleRefs(patch.value.godRefs, refs.god, godIds, "编年史神明"),
        },
      });
      refs.chronicle.set(patch.tempRef, created.id);
      chronicleIds.add(created.id);
    } else if (patch.op === "update") {
      requireTimelineTarget(chronicleIds, patch.targetId, "待更新编年史");
      await tx.chronicleEntry.update({
        where: { id: patch.targetId },
        data: {
          ...chronicleScalarData(patch.changes),
          ...(patch.changes.entityRefs !== undefined
            ? {
                entityIds: resolveChronicleRefs(
                  patch.changes.entityRefs,
                  refs.entity,
                  entityIds,
                  "编年史实体",
                ),
              }
            : {}),
          ...(patch.changes.godRefs !== undefined
            ? {
                godIds: resolveChronicleRefs(
                  patch.changes.godRefs,
                  refs.god,
                  godIds,
                  "编年史神明",
                ),
              }
            : {}),
        },
      });
    }
  }
  for (const patch of plan.chroniclePatches) {
    if (patch.op !== "remove") continue;
    requireTimelineTarget(chronicleIds, patch.targetId, "待删除编年史");
    await tx.chronicleEntry.delete({ where: { id: patch.targetId } });
    chronicleIds.delete(patch.targetId);
  }
}

function memoryText(content: Prisma.JsonValue): string {
  if (typeof content === "string") return content;
  if (content !== null && typeof content === "object" && !Array.isArray(content)) {
    return typeof content.text === "string" ? content.text : "";
  }
  return "";
}

function memoryContent(
  current: Prisma.JsonValue | null,
  operation: "replace" | "append" | "remove",
  text: string,
): Prisma.InputJsonValue {
  const base = current === null ? "" : memoryText(current);
  const next = operation === "replace"
    ? text
    : operation === "append"
      ? [base, text].filter(Boolean).join("\n")
      : base.replaceAll(text, "").trim();
  const record = current !== null && typeof current === "object" && !Array.isArray(current)
    ? structuredClone(current) as Record<string, Prisma.JsonValue>
    : {};
  return { ...record, text: next } as Prisma.InputJsonValue;
}

async function applyMemoryPatches(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
  entityIds: ReadonlySet<string>,
): Promise<void> {
  for (const patch of plan.memoryPatches) {
    requireTimelineTarget(entityIds, patch.entityId, "记忆所属实体");
    const current = await tx.entitySection.findUnique({
      where: { entityId_key: { entityId: patch.entityId, key: "memory" } },
    });
    const content = memoryContent(current?.content ?? null, patch.operation, patch.text);
    await tx.entitySection.upsert({
      where: { entityId_key: { entityId: patch.entityId, key: "memory" } },
      create: {
        entityId: patch.entityId,
        key: "memory",
        content,
        revealed: false,
        rumorText: null,
      },
      update: { content },
    });
  }
}

async function applyOmenPatches(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
  refs: ReferenceMaps,
  godIds: ReadonlySet<string>,
): Promise<void> {
  const existing = await tx.omenQueue.findMany({
    where: { timelineId },
    select: { id: true },
  });
  const omenIds = new Set(existing.map(({ id }) => id));

  for (const patch of plan.omenPatches) {
    if (patch.op !== "create") continue;
    const created = await tx.omenQueue.create({
      data: {
        timelineId,
        godId: resolveRef(refs.god, godIds, patch.value.godRef, "征兆所属神明"),
        text: patch.value.text,
        consumed: patch.value.consumed,
      },
    });
    omenIds.add(created.id);
  }

  for (const patch of plan.omenPatches) {
    if (patch.op !== "update") continue;
    requireTimelineTarget(omenIds, patch.targetId, "待更新征兆");
    await tx.omenQueue.update({
      where: { id: patch.targetId },
      data: {
        ...(patch.changes.godRef !== undefined
          ? { godId: resolveRef(refs.god, godIds, patch.changes.godRef, "征兆所属神明") }
          : {}),
        ...(patch.changes.text !== undefined ? { text: patch.changes.text } : {}),
        ...(patch.changes.consumed !== undefined ? { consumed: patch.changes.consumed } : {}),
      },
    });
  }

  for (const patch of plan.omenPatches) {
    if (patch.op !== "remove") continue;
    requireTimelineTarget(omenIds, patch.targetId, "待删除征兆");
    await tx.omenQueue.delete({ where: { id: patch.targetId } });
    omenIds.delete(patch.targetId);
  }
}

async function resolveObserverEntity(
  tx: Prisma.TransactionClient,
  timelineId: string,
  refs: ReferenceMaps,
  entityIds: ReadonlySet<string>,
  ref: string,
  label: string,
) {
  const entityId = resolveRef(refs.entity, entityIds, ref, label);
  return tx.entity.findFirstOrThrow({
    where: { id: entityId, timelineId },
    select: { id: true, type: true, heat: true, isCreatorAvatar: true },
  });
}

async function applyObserverPatch(
  tx: Prisma.TransactionClient,
  timelineId: string,
  plan: ParsedPlan,
  refs: ReferenceMaps,
  entityIds: ReadonlySet<string>,
  godIds: ReadonlySet<string>,
): Promise<void> {
  const patch = plan.observerPatch;
  if (patch === null) return;
  const timeline = await tx.timeline.findUniqueOrThrow({
    where: { id: timelineId },
    select: { observerState: true },
  });
  const observer = ObserverStateSchema.parse(timeline.observerState);

  if (patch.focus !== undefined) {
    observer.focusType = patch.focus.focusType;
    if (patch.focus.focusType === "world") {
      observer.focusId = null;
    } else if (patch.focus.focusType === "god") {
      observer.focusId = resolveRef(refs.god, godIds, patch.focus.focusRef!, "观察焦点神明");
    } else {
      const entity = await resolveObserverEntity(
        tx,
        timelineId,
        refs,
        entityIds,
        patch.focus.focusRef!,
        "观察焦点实体",
      );
      if (patch.focus.focusType === "place" && entity.type !== "place") {
        throw new Error("地点观察焦点必须引用 place 实体");
      }
      if (
        patch.focus.focusType === "avatar"
        && (entity.type !== "character" || !entity.isCreatorAvatar || entity.heat !== "active")
      ) {
        throw new Error("化身观察焦点必须引用活动创世主化身");
      }
      observer.focusId = entity.id;
    }
  }
  if (patch.viewpoint !== undefined) observer.viewpoint = patch.viewpoint;
  if (hasOwn(patch, "activeAvatarRef")) {
    if (patch.activeAvatarRef === null) {
      observer.activeAvatarId = null;
    } else {
      const avatar = await resolveObserverEntity(
        tx,
        timelineId,
        refs,
        entityIds,
        patch.activeAvatarRef!,
        "活动创世主化身",
      );
      if (avatar.type !== "character" || !avatar.isCreatorAvatar || avatar.heat !== "active") {
        throw new Error("活动化身必须引用当前现实中的活动创世主化身");
      }
      observer.activeAvatarId = avatar.id;
    }
  }

  await tx.timeline.update({
    where: { id: timelineId },
    data: { observerState: json(ObserverStateSchema.parse(observer)) },
  });
}

async function annotateRetroactiveHistory(
  tx: Prisma.TransactionClient,
  timelineId: string,
): Promise<void> {
  const messages = await tx.message.findMany({
    where: { chapter: { timelineId } },
    select: { id: true, meta: true },
  });
  for (const message of messages) {
    const previous = message.meta;
    const meta = previous !== null && typeof previous === "object" && !Array.isArray(previous)
      ? { ...structuredClone(previous), previousReality: true }
      : previous === null
        ? { previousReality: true }
        : { previousReality: true, previousMeta: structuredClone(previous) };
    await tx.message.update({ where: { id: message.id }, data: { meta: json(meta) } });
  }
}

async function createRewriteChronicle(
  tx: Prisma.TransactionClient,
  input: ApplyRewritePlanInput,
  plan: ParsedPlan,
  currentEra: string,
): Promise<void> {
  if (plan.scope === "memory_only") return;
  const rewrite = await tx.realityRewrite.findUniqueOrThrow({
    where: { id: input.rewriteId },
    select: { sourceChapterId: true },
  });
  const sourceChapter = await tx.chapter.findUnique({
    where: { id: rewrite.sourceChapterId },
    select: { index: true },
  });
  if (sourceChapter === null) throw new Error("现实改写来源章节不存在");
  const chapter = await tx.chapter.findUnique({
    where: {
      timelineId_index: { timelineId: input.timelineId, index: sourceChapter.index },
    },
    select: { index: true },
  });
  if (chapter === null) throw new Error("目标时间线缺少现实改写来源章节");
  await tx.chronicleEntry.create({
    data: {
      timelineId: input.timelineId,
      chapterIndex: chapter.index,
      yearLabel: currentEra,
      text: plan.interpretation,
      entityIds: [],
      godIds: [],
      revealed: true,
      revealedAtChapter: chapter.index,
      source: "rewrite",
    },
  });
}

async function validateFinalGraph(
  tx: Prisma.TransactionClient,
  worldId: string,
  timelineId: string,
): Promise<void> {
  const [world, timeline, gods, entities, memberships, chronicles, omens] = await Promise.all([
    tx.world.findUniqueOrThrow({ where: { id: worldId }, select: { mode: true } }),
    tx.timeline.findUniqueOrThrow({
      where: { id: timelineId },
      select: { worldId: true, realityState: true, observerState: true },
    }),
    tx.god.findMany({ where: { timelineId } }),
    tx.entity.findMany({ where: { timelineId } }),
    tx.entityMembership.findMany({
      where: { character: { timelineId } },
      select: { id: true, characterId: true, factionId: true },
    }),
    tx.chronicleEntry.findMany({ where: { timelineId } }),
    tx.omenQueue.findMany({ where: { timelineId } }),
  ]);
  if (timeline.worldId !== worldId) throw new Error("目标时间线不属于目标世界");
  RealityStateSchema.parse(timeline.realityState);

  const godIds = new Set(gods.map(({ id }) => id));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  if (world.mode === "creator" && gods.some((god) => god.isPlayer || god.tier === "player")) {
    throw new Error("creator 世界不能包含玩家神");
  }
  for (const god of gods) {
    if (god.codexEntityId !== null && !entityById.has(god.codexEntityId)) {
      throw new Error(`神明百科引用不在目标时间线：${god.id}`);
    }
    if (god.relations === null) continue;
    const relations = requireRecord(god.relations, "神明关系");
    for (const targetId of Object.keys(relations)) {
      if (!RESERVED_GOD_RELATION_KEYS.has(targetId) && !godIds.has(targetId)) {
        throw new Error(`神明关系引用不在目标时间线：${targetId}`);
      }
    }
  }
  for (const entity of entities) {
    if (entity.raceId === null) continue;
    const race = entityById.get(entity.raceId);
    if (race?.type !== "race") throw new Error(`实体种族引用无效：${entity.id}`);
  }
  for (const membership of memberships) {
    const character = entityById.get(membership.characterId);
    const faction = entityById.get(membership.factionId);
    if (character?.type !== "character" || faction?.type !== "faction") {
      throw new Error(`成员关系引用无效：${membership.id}`);
    }
  }
  for (const chronicle of chronicles) {
    if (chronicle.entityIds.some((id) => !entityById.has(id))) {
      throw new Error(`编年史实体引用无效：${chronicle.id}`);
    }
    if (chronicle.godIds.some((id) => !godIds.has(id))) {
      throw new Error(`编年史神明引用无效：${chronicle.id}`);
    }
  }
  for (const omen of omens) {
    if (!godIds.has(omen.godId)) throw new Error(`征兆神明引用无效：${omen.id}`);
  }
  if (timeline.observerState !== null) {
    const observer = ObserverStateSchema.parse(timeline.observerState);
    if (observer.focusId !== null) {
      if (observer.focusType === "god") {
        requireTimelineTarget(godIds, observer.focusId, "观察焦点神明");
      } else if (observer.focusType !== "world") {
        const focus = entityById.get(observer.focusId);
        if (focus === undefined) throw new Error("观察焦点实体不在目标时间线");
        if (observer.focusType === "place" && focus.type !== "place") {
          throw new Error("地点观察焦点必须引用 place 实体");
        }
        if (
          observer.focusType === "avatar"
          && (focus.type !== "character" || !focus.isCreatorAvatar || focus.heat !== "active")
        ) {
          throw new Error("化身观察焦点必须引用活动创世主化身");
        }
      }
    }
    if (observer.activeAvatarId !== null) {
      const avatar = entityById.get(observer.activeAvatarId);
      if (
        avatar?.type !== "character"
        || avatar.isCreatorAvatar !== true
        || avatar.heat !== "active"
      ) {
        throw new Error("当前观察化身无效");
      }
    }
  }
  await validateAbilityReferenceGraph(tx, timelineId);
}

/**
 * Applies one already planned reality rewrite to a cloned timeline. The fixed
 * phase ordering and final graph audit keep model output away from arbitrary
 * database writes; the caller owns the surrounding transaction.
 */
export async function applyRewritePlan(
  tx: Prisma.TransactionClient,
  input: ApplyRewritePlanInput,
): Promise<ApplyRewritePlanResult> {
  const plan = RewritePlanSchema.parse(input.plan);
  const [timeline, rewrite] = await Promise.all([
    tx.timeline.findUniqueOrThrow({
      where: { id: input.timelineId },
      select: { worldId: true, parentId: true, forkRewriteId: true },
    }),
    tx.realityRewrite.findUniqueOrThrow({
      where: { id: input.rewriteId },
      select: { worldId: true, sourceTimelineId: true },
    }),
  ]);
  if (timeline.worldId !== input.worldId) throw new Error("目标时间线不属于目标世界");
  if (rewrite.worldId !== input.worldId) throw new Error("现实改写不属于目标世界");
  const appliesToSource = rewrite.sourceTimelineId === input.timelineId;
  const appliesToFork = timeline.parentId === rewrite.sourceTimelineId
    && timeline.forkRewriteId === input.rewriteId;
  if (!appliesToSource && !appliesToFork) {
    throw new Error("现实改写不属于目标时间线");
  }

  const refs: ReferenceMaps = {
    god: new Map(),
    entity: new Map(),
    ability: new Map(),
    chronicle: new Map(),
  };

  const reality = await applyRealityCards(tx, input.timelineId, plan);
  const godIds = await applyGodPatches(tx, input.timelineId, plan, refs);
  const entityIds = await applyEntityPatches(tx, input.timelineId, plan, refs);
  await applyAbilityPatches(tx, input.timelineId, plan, refs, entityIds, godIds);
  await applyChroniclePatches(tx, input.timelineId, plan, refs, entityIds, godIds);
  if (plan.scope === "retroactive") {
    await annotateRetroactiveHistory(tx, input.timelineId);
  }
  await createRewriteChronicle(tx, input, plan, reality.currentEra);
  await applyMemoryPatches(tx, input.timelineId, plan, entityIds);
  await applyAgendaPatches(tx, plan, refs);
  await applyOmenPatches(tx, input.timelineId, plan, refs, godIds);
  await applyObserverPatch(tx, input.timelineId, plan, refs, entityIds, godIds);
  await validateFinalGraph(tx, input.worldId, input.timelineId);

  return {
    summary: plan.interpretation,
    consequenceLines: [...plan.causalConsequences],
  };
}