import { prisma } from "@/lib/db";

export type AbilityContextViewer = "player" | "backstage";

export type BuildAbilityContextOptions = {
  timelineId: string;
  viewer: AbilityContextViewer;
  subjectGodId?: string;
  searchText: string;
};

type ContextAbility = {
  id: string;
  name: string;
  kind: string;
  effect: string;
  trigger: string;
  cost: string;
  limitations: string;
  mastery: string;
  state: string;
  visibility: string;
  sourceAbilityId: string | null;
  sourceAbility: { id: string; name: string } | null;
};

type AbilityOwner = {
  id: string;
  name: string;
  type: "god" | "race" | "character";
};

type ContextEntry = {
  owner: AbilityOwner;
  ability: ContextAbility;
};

function isMentioned(
  item: { name: string; aliases?: string[] },
  searchText: string,
): boolean {
  return [item.name, ...(item.aliases ?? [])].some(
    (candidate) => candidate.length > 0 && searchText.includes(candidate),
  );
}

function formatEntry({ owner, ability }: ContextEntry): string {
  const source = ability.sourceAbility
    ? `${ability.sourceAbility.name} [${ability.sourceAbility.id}]`
    : `${owner.name} (${owner.type})`;

  return `- [${ability.id}] ${ability.name}
  owner: ${owner.name} [${owner.id}] (${owner.type})
  kind: ${ability.kind}
  effect: ${ability.effect}
  trigger: ${ability.trigger}
  cost: ${ability.cost}
  limitations: ${ability.limitations}
  state: ${ability.state}
  mastery: ${ability.mastery}
  source: ${source}`;
}

function formatBlock(title: string, entries: ContextEntry[]): string {
  return `== ${title} ==\n${entries.length ? entries.map(formatEntry).join("\n\n") : "—"}`;
}

/**
 * Builds the capability boundary shared by the narrator and pantheon turns.
 * Player-owned divine abilities are always owner-visible. Every other entry in
 * the known block must already be public; the backstage-only block is limited
 * to the acting god's own hidden divine abilities.
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
            sourceAbility: { select: { id: true, name: true } },
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
            sourceAbility: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        race: {
          select: {
            id: true,
            name: true,
            abilities: {
              include: {
                sourceAbility: { select: { id: true, name: true } },
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
  const add = (
    target: ContextEntry[],
    owner: AbilityOwner,
    abilities: ContextAbility[],
  ) => {
    for (const ability of abilities) target.push({ owner, ability });
  };

  for (const god of gods) {
    const owner = { id: god.id, name: god.name, type: "god" as const };
    if (god.isPlayer && opts.viewer === "player") {
      add(known, owner, god.abilities);
      continue;
    }

    const isSubject = opts.viewer === "backstage" && god.id === opts.subjectGodId;
    if (isSubject || isMentioned(god, opts.searchText)) {
      add(
        known,
        owner,
        god.abilities.filter((ability) => ability.visibility === "known"),
      );
    }
    if (isSubject) {
      add(
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
      add(
        known,
        { id: entity.id, name: entity.name, type: "race" },
        entity.abilities.filter((ability) => ability.visibility === "known"),
      );
      continue;
    }

    if (!relevantCharacters.includes(entity)) continue;
    add(
      known,
      { id: entity.id, name: entity.name, type: "character" },
      entity.abilities.filter((ability) => ability.visibility === "known"),
    );
  }

  return [
    formatBlock("KNOWN ABILITIES", known),
    formatBlock("AUTHOR-ONLY HIDDEN ABILITIES", authorOnly),
  ].join("\n\n");
}
