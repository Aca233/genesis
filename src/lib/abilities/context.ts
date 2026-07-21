import { prisma } from "@/lib/db";
import { resolveEffectiveAbilities } from "./resolver";
import {
  normalizePersistedAbility,
  type PersistedAbilityRecord,
} from "./types";

export type AbilityContextViewer = "player" | "narrator" | "backstage";

export type BuildAbilityContextOptions = {
  timelineId: string;
  viewer: AbilityContextViewer;
  subjectGodId?: string;
  searchText: string;
};

type AbilitySource = { id: string; name: string; visibility: string };
type ContextAbility = PersistedAbilityRecord & {
  godId: string | null;
  entityId: string | null;
  sourceAbility: AbilitySource | null;
};
type AbilityOwner = { id: string; name: string; type: "god" | "race" | "character" };
type ContextEntry = {
  owner: AbilityOwner;
  ability: ContextAbility;
  disclosure: "full" | "rumor";
};

function isMentioned(
  item: { name: string; aliases?: string[] },
  searchText: string,
): boolean {
  return [item.name, ...(item.aliases ?? [])].some(
    (candidate) => candidate.length > 0 && searchText.includes(candidate),
  );
}

function safeSource(ability: ContextAbility, owner: AbilityOwner): string {
  if (ability.sourceAbility?.visibility === "hidden") return "未揭示来源";
  return ability.sourceAbility
    ? `${ability.sourceAbility.name} [${ability.sourceAbility.id}]`
    : `${owner.name} (${owner.type})`;
}

function formatEntry({ owner, ability, disclosure }: ContextEntry): string {
  const header = `- [${ability.id}] ${ability.name}\n  owner: ${owner.name} [${owner.id}] (${owner.type})\n  kind: ${ability.kind}`;
  const source = `  source: ${safeSource(ability, owner)}`;
  if (disclosure === "rumor") {
    return `${header}\n  rumor: ${ability.rumorText ?? "仅有未经证实的传闻"}\n${source}`;
  }
  return `${header}
  effect: ${ability.effect}
  trigger: ${ability.trigger}
  cost: ${ability.cost}
  limitations: ${ability.limitations}
  state: ${ability.state}
  mastery: ${ability.mastery}
${source}`;
}

function formatBlock(title: string, entries: ContextEntry[]): string {
  return `== ${title} ==\n${entries.length ? entries.map(formatEntry).join("\n\n") : "—"}`;
}

/** Two-stage bounded lookup: identify lightweight owners, then load abilities once. */
export async function buildAbilityContext(
  opts: BuildAbilityContextOptions,
): Promise<string> {
  const [godIndex, entityIndex] = await Promise.all([
    prisma.god.findMany({
      where: { timelineId: opts.timelineId },
      select: { id: true, name: true, aliases: true, isPlayer: true },
    }),
    prisma.entity.findMany({
      where: { timelineId: opts.timelineId, type: { in: ["race", "character"] } },
      select: {
        id: true,
        type: true,
        name: true,
        aliases: true,
        scenePresence: true,
        raceId: true,
      },
    }),
  ]);

  const mentionedCharacters = entityIndex.filter(
    (entity) => entity.type === "character" && isMentioned(entity, opts.searchText),
  );
  const relevantCharacters = entityIndex.filter(
    (entity) =>
      entity.type === "character" &&
      (entity.scenePresence || isMentioned(entity, opts.searchText)),
  );
  const relevantRaceIds = new Set(
    relevantCharacters.flatMap((character) => character.raceId ? [character.raceId] : []),
  );
  const relevantEntities = entityIndex.filter(
    (entity) =>
      (entity.type === "character" && relevantCharacters.includes(entity)) ||
      (entity.type === "race" &&
        (relevantRaceIds.has(entity.id) || isMentioned(entity, opts.searchText))),
  );
  const relevantGods = godIndex.filter(
    (god) =>
      ((opts.viewer === "player" || opts.viewer === "narrator") && god.isPlayer) ||
      (opts.viewer === "backstage" && god.id === opts.subjectGodId) ||
      isMentioned(god, opts.searchText),
  );
  const narratorHiddenEntityIds = new Set(
    opts.viewer === "narrator"
      ? [
          ...mentionedCharacters.map((entity) => entity.id),
          ...mentionedCharacters.flatMap((entity) => entity.raceId ? [entity.raceId] : []),
          ...entityIndex
            .filter((entity) => entity.type === "race" && isMentioned(entity, opts.searchText))
            .map((entity) => entity.id),
        ]
      : [],
  );

  const godIds = relevantGods.map((god) => god.id);
  const entityIds = relevantEntities.map((entity) => entity.id);
  const abilities = godIds.length || entityIds.length
    ? await prisma.ability.findMany({
        where: {
          timelineId: opts.timelineId,
          OR: [
            ...(godIds.length ? [{ godId: { in: godIds } }] : []),
            ...(entityIds.length ? [{ entityId: { in: entityIds } }] : []),
          ],
        },
        include: {
          sourceAbility: { select: { id: true, name: true, visibility: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const byGod = new Map<string, ContextAbility[]>();
  const byEntity = new Map<string, ContextAbility[]>();
  for (const ability of abilities) {
    const target = ability.godId ? byGod : byEntity;
    const ownerId = ability.godId ?? ability.entityId;
    if (!ownerId) continue;
    const list = target.get(ownerId) ?? [];
    list.push(ability);
    target.set(ownerId, list);
  }

  const known: ContextEntry[] = [];
  const authorOnly: ContextEntry[] = [];
  const addFull = (
    target: ContextEntry[], owner: AbilityOwner, items: readonly ContextAbility[],
  ) => items.forEach((ability) => target.push({ owner, ability, disclosure: "full" }));
  const addVisible = (owner: AbilityOwner, items: readonly ContextAbility[]) => {
    for (const ability of items) {
      if (ability.visibility === "known") known.push({ owner, ability, disclosure: "full" });
      else if (ability.visibility === "rumored") known.push({ owner, ability, disclosure: "rumor" });
    }
  };

  for (const god of relevantGods) {
    const owner = { id: god.id, name: god.name, type: "god" as const };
    const items = byGod.get(god.id) ?? [];
    if (god.isPlayer && (opts.viewer === "player" || opts.viewer === "narrator")) {
      addFull(known, owner, items);
      continue;
    }
    const isSubject = opts.viewer === "backstage" && god.id === opts.subjectGodId;
    if (isSubject) {
      addVisible(owner, items.filter((ability) => ability.visibility === "known"));
      addFull(
        authorOnly,
        owner,
        items.filter(
          (ability) => ability.visibility === "hidden" || ability.visibility === "rumored",
        ),
      );
    } else {
      addVisible(owner, items);
      if (opts.viewer === "narrator" && !god.isPlayer && isMentioned(god, opts.searchText)) {
        addFull(authorOnly, owner, items.filter((ability) => ability.visibility === "hidden"));
      }
    }
  }

  for (const entity of relevantEntities) {
    const owner = {
      id: entity.id,
      name: entity.name,
      type: entity.type as "race" | "character",
    };
    if (entity.type === "race") {
      const items = byEntity.get(entity.id) ?? [];
      addVisible(owner, items);
      if (narratorHiddenEntityIds.has(entity.id)) {
        addFull(authorOnly, owner, items.filter((ability) => ability.visibility === "hidden"));
      }
      continue;
    }
    const effective = resolveEffectiveAbilities({
      raceAbilities: entity.raceId
        ? (byEntity.get(entity.raceId) ?? []).map(normalizePersistedAbility)
        : [],
      characterAbilities: (byEntity.get(entity.id) ?? []).map(normalizePersistedAbility),
    }).map((ability) => {
      const persisted = abilities.find((candidate) => candidate.id === ability.id);
      return {
        ...ability,
        godId: null,
        entityId: entity.id,
        sourceAbility: persisted?.sourceAbility ??
          (ability.sourceAbilityId
            ? abilities.find((candidate) => candidate.id === ability.sourceAbilityId)
              ? {
                  id: ability.sourceAbilityId,
                  name: abilities.find((candidate) => candidate.id === ability.sourceAbilityId)!.name,
                  visibility: abilities.find((candidate) => candidate.id === ability.sourceAbilityId)!.visibility,
                }
              : null
            : null),
      } satisfies ContextAbility;
    });
    addVisible(owner, effective);
    if (narratorHiddenEntityIds.has(entity.id)) {
      const inheritedRaceIds = new Set(
        entity.raceId ? (byEntity.get(entity.raceId) ?? []).map((ability) => ability.id) : [],
      );
      addFull(
        authorOnly,
        owner,
        effective.filter(
          (ability) => ability.visibility === "hidden" && !inheritedRaceIds.has(ability.id),
        ),
      );
    }
  }

  return [
    formatBlock("KNOWN ABILITIES", known),
    formatBlock("AUTHOR-ONLY HIDDEN ABILITIES", authorOnly),
  ].join("\n\n");
}
