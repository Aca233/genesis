import type { Prisma } from "@prisma/client";
import type { WorldDeck } from "@/lib/cards/schemas";
import { factionSections } from "@/lib/cards/faction-sections";
import { materializeDeckAbilities } from "@/lib/abilities/embark";
import {
  initialBranchSummary,
  initialObserverState,
  initialRealityState,
} from "@/lib/reality/schemas";

function emblemSeed(name: string): string {
  let h = 5381;
  for (const ch of name) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

function raceSections(race: WorldDeck["races"][number]) {
  return [
    { key: "overview", content: { text: race.traits } },
    { key: "lifespan", content: { text: race.lifespan } },
    { key: "distribution", content: { text: race.distribution } },
    { key: "divineTies", content: { text: race.divineTies } },
  ];
}

function placeSections(place: WorldDeck["places"][number]) {
  return [
    { key: "overview", content: { text: place.overview } },
    { key: "kind", content: { text: place.kind } },
    { key: "allegiance", content: { text: place.allegiance } },
  ];
}

function characterSections(character: WorldDeck["majorCharacters"][number]) {
  return [
    { key: "overview", content: { text: character.situation } },
    { key: "identity", content: { text: character.identity } },
    { key: "affiliation", content: { text: character.factionMemberships.map(({ role }) => role).join("、") } },
    { key: "lifespan", content: { text: character.ageStage } },
    { key: "personality", content: { text: character.personality } },
    { key: "faithHistory", content: { text: character.divineTies } },
    { key: "relationToPlayer", content: { text: character.conflictTies } },
  ];
}

/**
 * Creates every opening record from a validated card deck. It deliberately does
 * all reference resolution through maps built from this transaction's new IDs,
 * so a failed lookup throws and the enclosing Prisma transaction rolls back.
 */
export async function materializeEmbarkDeck(
  tx: Prisma.TransactionClient,
  worldId: string,
  deck: WorldDeck,
): Promise<{ timelineId: string; chapterId: string }> {
  const timeline = await tx.timeline.create({
    data: {
      worldId,
      branchName: "原初现实",
      branchSummary: initialBranchSummary(deck),
      realityState: initialRealityState(deck) as Prisma.InputJsonValue,
      observerState: initialObserverState(deck) as Prisma.InputJsonValue,
    },
  });
  const ids = {
    raceByRef: new Map<string, string>(),
    factionByRef: new Map<string, string>(),
    characterByRef: new Map<string, string>(),
    godByRef: new Map<string, string>(),
    abilityByRef: new Map<string, string>(),
  };

  if (deck.mode === "pantheon") {
    const playerGod = await tx.god.create({
      data: {
        timelineId: timeline.id,
        name: deck.playerGod.name,
        aliases: [],
        tier: "player",
        isPlayer: true,
        rank: deck.playerGod.rank,
        domains: deck.playerGod.domains,
        persona: {
          origin: deck.playerGod.origin,
          situation: deck.playerGod.situation,
        } as Prisma.InputJsonValue,
        faithScope: deck.playerGod.faithBase,
        materialRef: deck.playerGod.ref,
      },
    });
    ids.godByRef.set(deck.playerGod.ref, playerGod.id);
  }

  // Creator relations target real database IDs, so every major god must exist first.
  if (deck.mode === "pantheon") {
    for (const god of deck.majorGods) {
      const created = await tx.god.create({
        data: {
          timelineId: timeline.id,
          name: god.name,
          aliases: god.aliases,
          tier: "major",
          rank: god.rank,
          domains: god.domains,
          persona: { text: god.persona } as Prisma.InputJsonValue,
          voice: god.voice as Prisma.InputJsonValue,
          agenda: god.agenda as Prisma.InputJsonValue,
          relations: {
            player: {
              label: god.initialRelationToPlayer.label,
              note: god.initialRelationToPlayer.note,
            },
          } as Prisma.InputJsonValue,
          faithScope: god.faithScope,
          materialRef: god.ref,
        },
      });
      ids.godByRef.set(god.ref, created.id);
    }
  } else {
    for (const god of deck.majorGods) {
      const created = await tx.god.create({
        data: {
          timelineId: timeline.id,
          name: god.name,
          aliases: god.aliases,
          tier: "major",
          rank: god.rank,
          domains: god.domains,
          persona: { text: god.persona } as Prisma.InputJsonValue,
          voice: god.voice as Prisma.InputJsonValue,
          agenda: god.agenda as Prisma.InputJsonValue,
          relations: {} as Prisma.InputJsonValue,
          faithScope: god.faithScope,
          materialRef: god.ref,
        },
      });
      ids.godByRef.set(god.ref, created.id);
    }
  }

  if (deck.mode === "creator") {
    for (const god of deck.majorGods) {
      const godId = ids.godByRef.get(god.ref);
      if (godId === undefined) throw new Error(`无法解析神明引用 "${god.ref}"`);
      const relations = Object.fromEntries(god.relations.map((relation) => {
        const targetId = ids.godByRef.get(relation.targetGodRef);
        if (targetId === undefined) {
          throw new Error(`无法解析神明引用 "${relation.targetGodRef}"`);
        }
        return [targetId, { label: relation.label, note: relation.note }];
      }));
      await tx.god.update({
        where: { id: godId },
        data: { relations: relations as Prisma.InputJsonValue },
      });
    }
  }

  for (const god of deck.minorGods) {
    await tx.god.create({
      data: {
        timelineId: timeline.id,
        name: god.name,
        aliases: [],
        tier: "minor",
        persona: { text: god.brief } as Prisma.InputJsonValue,
      },
    });
  }

  for (const race of deck.races) {
    const created = await tx.entity.create({
      data: {
        timelineId: timeline.id,
        type: "race",
        name: race.name,
        aliases: race.aliases,
        emblemSeed: emblemSeed(race.name),
        summary: race.traits.slice(0, 120),
        materialRef: race.ref,
        sections: { create: raceSections(race) },
      },
    });
    ids.raceByRef.set(race.ref, created.id);
  }

  for (const faction of deck.factions) {
    const created = await tx.entity.create({
      data: {
        timelineId: timeline.id,
        type: "faction",
        name: faction.name,
        aliases: faction.aliases,
        emblemSeed: emblemSeed(faction.name),
        summary: faction.overview.slice(0, 120),
        materialRef: faction.ref,
        sections: {
          create: factionSections(faction, deck.majorCharacters) as {
            key: string;
            content: Prisma.InputJsonValue;
          }[],
        },
      },
    });
    ids.factionByRef.set(faction.ref, created.id);
  }

  for (const place of deck.places) {
    await tx.entity.create({
      data: {
        timelineId: timeline.id,
        type: "place",
        name: place.name,
        aliases: place.aliases,
        emblemSeed: emblemSeed(place.name),
        summary: place.overview.slice(0, 120),
        materialRef: place.ref,
        sections: { create: placeSections(place) },
      },
    });
  }

  for (const character of deck.majorCharacters) {
    const raceId = ids.raceByRef.get(character.raceRef);
    if (raceId === undefined) {
      throw new Error(`无法解析种族引用 "${character.raceRef}"`);
    }

    const created = await tx.entity.create({
      data: {
        timelineId: timeline.id,
        type: "character",
        name: character.name,
        aliases: character.aliases,
        emblemSeed: emblemSeed(character.name),
        isMajorCharacter: true,
        raceId,
        summary: character.situation.slice(0, 120),
        materialRef: character.ref,
        sections: { create: characterSections(character) },
      },
    });
    ids.characterByRef.set(character.ref, created.id);
  }

  await materializeDeckAbilities(tx, timeline.id, deck, ids);

  const chapter = await tx.chapter.create({
    data: {
      timelineId: timeline.id,
      index: 1,
      title: "创世",
    },
  });

  await tx.world.update({
    where: { id: worldId },
    data: {
      status: "playing",
      activeTimelineId: timeline.id,
    },
  });

  return { timelineId: timeline.id, chapterId: chapter.id };
}

/** Minimal transaction boundary used by the route and rollback-focused tests. */
export interface EmbarkTransactionRunner {
  $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

export class EmbarkConflictError extends Error {
  override name = "EmbarkConflictError";
}

export class EmbarkDraftError extends Error {
  override name = "EmbarkDraftError";
}

/** Atomically reserves a draft world until the enclosing transaction commits. */
export async function claimDraftWorld(
  tx: Prisma.TransactionClient,
  worldId: string,
): Promise<void> {
  const { count } = await tx.world.updateMany({
    where: { id: worldId, status: "draft" },
    data: { status: "embarking" },
  });
  if (count !== 1) {
    throw new EmbarkConflictError("该世界已开局");
  }
}

export function runEmbarkTransaction(
  runner: EmbarkTransactionRunner,
  worldId: string,
  deck: WorldDeck,
): Promise<{ timelineId: string; chapterId: string }> {
  return runner.$transaction((tx) => materializeEmbarkDeck(tx, worldId, deck));
}

/**
 * Claims the draft and materializes it in one database transaction. A rollback
 * restores the temporary "embarking" status together with every created row.
 */
export function runClaimedEmbarkTransaction(
  runner: EmbarkTransactionRunner,
  worldId: string,
  loadDeck: (tx: Prisma.TransactionClient) => Promise<WorldDeck>,
): Promise<{ timelineId: string; chapterId: string }> {
  return runner.$transaction(async (tx) => {
    await claimDraftWorld(tx, worldId);
    const deck = await loadDeck(tx);
    return materializeEmbarkDeck(tx, worldId, deck);
  });
}
