import { prisma } from "@/lib/db";
import { resolveEffectiveAbilities } from "./resolver";
import {
  normalizePersistedAbility,
  type PersistedAbilityRecord,
} from "./types";

export type AbilityContextViewer = "player" | "backstage";

export type BuildAbilityContextOptions = {
  timelineId: string;
  viewer: AbilityContextViewer;
  subjectGodId?: string;
  searchText: string;
};

type AbilitySource = {
  id: string;
  name: string;
  visibility: string;
};

type ContextAbility = PersistedAbilityRecord & {
  sourceAbility: AbilitySource | null;
};

type AbilityOwner = {
  id: string;
  name: string;
  type: "god" | "race" | "character";
};

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
  if (ability.sourceAbility?.visibility !== "hidden") {
    if (ability.sourceAbility) {
      return `${ability.sourceAbility.name} [${ability.sourceAbility.id}]`;
    }
    return `${owner.name} (${owner.type})`;
  }
  return "未揭示来源";
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

function withSource(
  ability: PersistedAbilityRecord,
  sources: ReadonlyMap<string, AbilitySource>,
): ContextAbility {
  return {
    ...ability,
    sourceAbility:
      ability.sourceAbilityId === null
        ? null
        : (sources.get(ability.sourceAbilityId) ?? null),
  };
}

/**
 * Builds the capability boundary shared by the narrator and pantheon turns.
 * Character abilities always pass through the domain resolver before any
 * visibility projection. Rumors expose only their safe public description.
 */
export async function buildAbilityContext(
  opts: BuildAbilityContextOptions,
): Promise<string> {
  const [gods, entities] = await Promise.all([
    prisma.god.findMany({
      where: { timelineId: opts.timelineId },
      select: {
        id: true,
        name: true,
        aliases: true,
        isPlayer: true,
        abilities: {
          include: {
            sourceAbility: {
              select: { id: true, name: true, visibility: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
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
        abilities: {
          include: {
            sourceAbility: {
              select: { id: true, name: true, visibility: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        race: {
          select: {
            id: true,
            name: true,
            abilities: {
              include: {
                sourceAbility: {
                  select: { id: true, name: true, visibility: true },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    }),
  ]);

  const known: ContextEntry[] = [];
  const authorOnly: ContextEntry[] = [];
  const sources = new Map<string, AbilitySource>();
  const registerSources = (abilities: readonly ContextAbility[]) => {
    for (const ability of abilities) {
      sources.set(ability.id, {
        id: ability.id,
        name: ability.name,
        visibility: ability.visibility,
      });
      if (ability.sourceAbility) {
        sources.set(ability.sourceAbility.id, ability.sourceAbility);
      }
    }
  };
  for (const god of gods) registerSources(god.abilities);
  for (const entity of entities) {
    registerSources(entity.abilities);
    if (entity.race) registerSources(entity.race.abilities);
  }

  const addFull = (
    target: ContextEntry[],
    owner: AbilityOwner,
    abilities: readonly ContextAbility[],
  ) => {
    for (const ability of abilities) {
      target.push({ owner, ability, disclosure: "full" });
    }
  };
  const addPlayerVisible = (
    owner: AbilityOwner,
    abilities: readonly ContextAbility[],
  ) => {
    for (const ability of abilities) {
      if (ability.visibility === "known") {
        known.push({ owner, ability, disclosure: "full" });
      } else if (opts.viewer === "player" && ability.visibility === "rumored") {
        known.push({ owner, ability, disclosure: "rumor" });
      }
    }
  };

  for (const god of gods) {
    const owner = { id: god.id, name: god.name, type: "god" as const };
    if (god.isPlayer && opts.viewer === "player") {
      addFull(known, owner, god.abilities);
      continue;
    }

    const isSubject = opts.viewer === "backstage" && god.id === opts.subjectGodId;
    if (isSubject || isMentioned(god, opts.searchText)) {
      addPlayerVisible(owner, god.abilities);
    }
    if (isSubject) {
      addFull(
        authorOnly,
        owner,
        god.abilities.filter((ability) => ability.visibility === "hidden"),
      );
    }
  }

  const relevantCharacters = entities.filter(
    (entity) =>
      entity.type === "character" &&
      (entity.scenePresence || isMentioned(entity, opts.searchText)),
  );
  const relevantRaceIds = new Set(
    relevantCharacters.flatMap((character) =>
      character.raceId === null ? [] : [character.raceId],
    ),
  );

  for (const entity of entities) {
    if (entity.type === "race") {
      if (!relevantRaceIds.has(entity.id) && !isMentioned(entity, opts.searchText)) {
        continue;
      }
      addPlayerVisible(
        { id: entity.id, name: entity.name, type: "race" },
        entity.abilities,
      );
      continue;
    }

    if (!relevantCharacters.includes(entity)) continue;
    const effective = resolveEffectiveAbilities({
      raceAbilities: entity.race?.abilities.map(normalizePersistedAbility) ?? [],
      characterAbilities: entity.abilities.map(normalizePersistedAbility),
    }).map((ability) => withSource(ability, sources));
    addPlayerVisible(
      { id: entity.id, name: entity.name, type: "character" },
      effective,
    );
  }

  return [
    formatBlock("KNOWN ABILITIES", known),
    formatBlock("AUTHOR-ONLY HIDDEN ABILITIES", authorOnly),
  ].join("\n\n");
}
