import { prisma } from "@/lib/db";
import { parseMaterialVersionContent, type MaterialVersionContent } from "./schemas";
import type { MaterialDependency, MaterialKind } from "./types";

export type RuntimeSourceType = "god" | "entity" | "ability";
export type RuntimeMaterialSnapshot = {
  cardIdentity: {
    kind: MaterialKind;
    sourceKind: RuntimeSourceType;
    sourceRef: string;
    name: string;
    summary: string;
    sourceWorldId: string;
    sourceWorldName: string;
  };
  content: MaterialVersionContent;
  dependencies: MaterialDependency[];
};

function dependency(
  relation: MaterialDependency["relation"], targetKind: MaterialKind,
  targetRef: string, label: string, required = true,
): MaterialDependency {
  return { key: `${relation}:${targetRef}`, relation, targetKind, targetRef, label, required };
}

function entityKind(type: string): Extract<MaterialKind, "character" | "race" | "faction" | "place"> {
  if (type === "character" || type === "race" || type === "faction" || type === "place") return type;
  throw new Error(`实体类型 ${type} 暂不支持保存为创世素材`);
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function stableIdentity(input: {
  worldId: string; sourceType: RuntimeSourceType; sourceId: string; materialRef: string | null;
}) {
  const expected = input.materialRef
    ? `${input.worldId}:${input.sourceType}:${input.materialRef}`
    : `${input.worldId}:runtime:${input.sourceType}:${input.sourceId}`;
  if (!input.materialRef) return expected;
  const archived = await prisma.materialCard.findFirst({
    where: { userId: "local", sourceKind: input.sourceType, sourceRef: expected },
    select: { sourceRef: true },
  });
  return archived?.sourceRef ?? expected;
}

export async function snapshotRuntimeMaterial(input: {
  sourceType: RuntimeSourceType;
  sourceId: string;
}): Promise<RuntimeMaterialSnapshot> {
  if (input.sourceType === "god") {
    const god = await prisma.god.findFirst({
      where: { id: input.sourceId, timeline: { world: { userId: "local" } } },
      include: {
        abilities: { include: { sourceAbility: { select: { id: true, materialRef: true, name: true } } } },
        timeline: { include: { world: { select: { id: true, name: true, mode: true } } } },
      },
    });
    if (!god) throw new Error("神明不存在");
    const world = god.timeline.world;
    const kind: MaterialKind = world.mode === "creator"
      ? "major_god"
      : god.isPlayer || god.tier === "player"
        ? "player_god"
        : "major_god";
    const sourceRef = await stableIdentity({ worldId: world.id, sourceType: "god", sourceId: god.id, materialRef: god.materialRef });
    const card = jsonSafe({
      ref: god.materialRef ?? sourceRef,
      id: god.id, name: god.name, aliases: god.aliases, tier: god.tier, isPlayer: god.isPlayer,
      rank: god.rank, domains: god.domains, persona: god.persona, voice: god.voice,
      agenda: god.agenda, agendaRevealed: god.agendaRevealed, relations: god.relations,
      faithScope: god.faithScope, abilities: god.abilities,
      updatedAt: god.updatedAt.toISOString(),
    });
    const content = parseMaterialVersionContent({ schemaVersion: 1, origin: "runtime", kind, card });
    return {
      cardIdentity: { kind, sourceKind: "god", sourceRef, name: god.name, summary: JSON.stringify(god.persona ?? {}).slice(0, 160), sourceWorldId: world.id, sourceWorldName: world.name },
      content,
      dependencies: god.abilities.flatMap((ability) => ability.sourceAbility?.materialRef
        ? [dependency("ability_source", "ability", ability.sourceAbility.materialRef, ability.sourceAbility.name)]
        : []),
    };
  }

  if (input.sourceType === "entity") {
    const entity = await prisma.entity.findFirst({
      where: { id: input.sourceId, timeline: { world: { userId: "local" } } },
      include: {
        sections: true,
        race: { select: { id: true, materialRef: true, name: true } },
        memberships: { include: { faction: { select: { id: true, materialRef: true, name: true } } } },
        membershipsAsFaction: { include: { character: { select: { id: true, materialRef: true, name: true } } } },
        abilities: { include: { sourceAbility: { select: { id: true, materialRef: true, name: true } } } },
        timeline: { include: { world: { select: { id: true, name: true, mode: true } } } },
      },
    });
    if (!entity) throw new Error("实体不存在");
    const world = entity.timeline.world;
    const kind = entityKind(entity.type);
    const sourceRef = await stableIdentity({ worldId: world.id, sourceType: "entity", sourceId: entity.id, materialRef: entity.materialRef });
    const card = jsonSafe({
      ref: entity.materialRef ?? sourceRef,
      id: entity.id, type: entity.type, name: entity.name, aliases: entity.aliases,
      summary: entity.summary, emblemSeed: entity.emblemSeed, imageUrl: entity.imageUrl,
      starred: entity.starred, isChosen: entity.isChosen, isMajorCharacter: entity.isMajorCharacter,
      isCreatorAvatar: entity.isCreatorAvatar,
      heat: entity.heat, scenePresence: entity.scenePresence, lockedPaths: entity.lockedPaths,
      sections: entity.sections, race: entity.race, memberships: entity.memberships,
      members: entity.membershipsAsFaction, abilities: entity.abilities,
      updatedAt: entity.updatedAt.toISOString(),
    });
    const dependencies: MaterialDependency[] = [];
    if (entity.race) dependencies.push(dependency("race", "race", entity.race.materialRef ?? `${world.id}:runtime:entity:${entity.race.id}`, entity.race.name));
    for (const membership of entity.memberships) dependencies.push(dependency("faction", "faction", membership.faction.materialRef ?? `${world.id}:runtime:entity:${membership.faction.id}`, membership.faction.name));
    for (const member of entity.membershipsAsFaction) dependencies.push(dependency("card_ref", "character", member.character.materialRef ?? `${world.id}:runtime:entity:${member.character.id}`, member.character.name, false));
    for (const ability of entity.abilities) if (ability.sourceAbility) dependencies.push(dependency("ability_source", "ability", ability.sourceAbility.materialRef ?? `${world.id}:runtime:ability:${ability.sourceAbility.id}`, ability.sourceAbility.name));
    const content = parseMaterialVersionContent({ schemaVersion: 1, origin: "runtime", kind, card });
    return {
      cardIdentity: { kind, sourceKind: "entity", sourceRef, name: entity.name, summary: entity.summary.slice(0, 160), sourceWorldId: world.id, sourceWorldName: world.name },
      content, dependencies,
    };
  }

  const ability = await prisma.ability.findFirst({
    where: { id: input.sourceId, timeline: { world: { userId: "local" } } },
    include: {
      god: { select: { id: true, materialRef: true, name: true } },
      entity: { select: { id: true, type: true, materialRef: true, name: true } },
      sourceAbility: { select: { id: true, materialRef: true, name: true } },
      events: { orderBy: { createdAt: "asc" } },
      timeline: { include: { world: { select: { id: true, name: true, mode: true } } } },
    },
  });
  if (!ability) throw new Error("能力不存在");
  const world = ability.timeline.world;
  const sourceRef = await stableIdentity({ worldId: world.id, sourceType: "ability", sourceId: ability.id, materialRef: ability.materialRef });
  const owner = ability.god
    ? { kind: "god" as const, sourceRef: ability.god.materialRef ?? `${world.id}:runtime:god:${ability.god.id}`, name: ability.god.name, targetKind: "major_god" as const }
    : ability.entity?.type === "race"
      ? { kind: "race" as const, sourceRef: ability.entity.materialRef ?? `${world.id}:runtime:entity:${ability.entity.id}`, name: ability.entity.name, targetKind: "race" as const }
      : ability.entity?.type === "character"
        ? { kind: "character" as const, sourceRef: ability.entity.materialRef ?? `${world.id}:runtime:entity:${ability.entity.id}`, name: ability.entity.name, targetKind: "character" as const }
        : null;
  if (!owner) throw new Error("能力没有可复用的合法拥有者");
  const card = jsonSafe({
    ref: ability.materialRef ?? sourceRef,
    id: ability.id, name: ability.name, kind: ability.kind, effect: ability.effect,
    trigger: ability.trigger, cost: ability.cost, limitations: ability.limitations,
    mastery: ability.mastery, state: ability.state, visibility: ability.visibility,
    rumorText: ability.rumorText, bloodlineJustification: ability.bloodlineJustification,
    lockedFields: ability.lockedFields, version: ability.version,
    sourceAbility: ability.sourceAbility, events: ability.events,
    updatedAt: ability.updatedAt.toISOString(),
  });
  const dependencies = [dependency("owner", owner.targetKind, owner.sourceRef, owner.name)];
  if (ability.sourceAbility) dependencies.push(dependency("ability_source", "ability", ability.sourceAbility.materialRef ?? `${world.id}:runtime:ability:${ability.sourceAbility.id}`, ability.sourceAbility.name));
  const content = parseMaterialVersionContent({ schemaVersion: 1, origin: "runtime", kind: "ability", card, owner: { kind: owner.kind, sourceRef: owner.sourceRef } });
  return {
    cardIdentity: { kind: "ability", sourceKind: "ability", sourceRef, name: ability.name, summary: ability.effect.slice(0, 160), sourceWorldId: world.id, sourceWorldName: world.name },
    content, dependencies,
  };
}
