type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? value as UnknownRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function project(value: unknown, keys: readonly string[]): UnknownRecord {
  const source = record(value);
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

const MESSAGE_KEYS = [
  "id", "chapterId", "index", "role", "content", "scale", "variants", "meta", "createdAt",
] as const;
const CHAPTER_KEYS = [
  "id", "timelineId", "index", "title", "summary", "settleState", "snapshot", "createdAt",
] as const;
const GOD_KEYS = [
  "id", "timelineId", "name", "aliases", "tier", "isPlayer", "rank", "domains", "persona",
  "voice", "agenda", "agendaRevealed", "relations", "faithScope", "codexEntityId", "materialRef",
  "createdAt", "updatedAt",
] as const;
const ENTITY_SECTION_KEYS = [
  "id", "entityId", "key", "content", "revealed", "rumorText", "playerLocked",
] as const;
const ENTITY_KEYS = [
  "id", "timelineId", "type", "name", "aliases", "emblemSeed", "imageUrl", "starred",
  "isChosen", "isMajorCharacter", "raceId", "heat", "scenePresence", "summary", "lockedPaths",
  "materialRef", "createdAt", "updatedAt",
] as const;
const ABILITY_KEYS = [
  "id", "timelineId", "entityId", "godId", "sourceAbilityId", "name", "kind", "effect", "trigger",
  "cost", "limitations", "mastery", "state", "visibility", "rumorText", "bloodlineJustification",
  "lockedFields", "version", "materialRef", "createdAt", "updatedAt",
] as const;
const ABILITY_EVENT_KEYS = [
  "id", "abilityId", "chapterId", "messageId", "type", "before", "after", "evidence", "scale",
  "dedupeKey", "createdAt",
] as const;
const MEMBERSHIP_KEYS = ["id", "characterId", "factionId", "role", "isPrimary"] as const;
const CHRONICLE_KEYS = [
  "id", "timelineId", "chapterIndex", "yearLabel", "text", "entityIds", "godIds", "revealed",
  "revealedAtChapter", "source", "createdAt",
] as const;
const OMEN_KEYS = ["id", "timelineId", "godId", "text", "kind", "consumed", "createdAt"] as const;
const CANON_EVENT_KEYS = [
  "id", "timelineId", "ref", "title", "timeLabel", "ordinal", "epoch", "summary",
  "participantRefs", "prerequisites", "blockers", "expectedConsequences", "status",
  "visibility", "divergenceNote", "occurredChapterIndex", "createdAt",
] as const;
const TIMELINE_KEYS = ["id", "worldId", "parentId", "forkChapter", "createdAt"] as const;
const ICON_ASSIGNMENT_KEYS = [
  "id", "timelineId", "subjectType", "subjectId", "token", "source", "playerLocked",
  "createdAt", "updatedAt",
] as const;
const LOREBOOK_KEYS = ["id", "worldId", "keys", "content", "enabled", "stExtra", "source"] as const;
const WORLD_KEYS = [
  "id", "userId", "name", "genesisInput", "genesisIntent", "mode", "status", "draftDeck", "lockedPaths",
  "themeCard", "styleCard", "cosmology", "fusionAxiom", "activeTimelineId", "materialArchiveStatus",
  "materialArchiveError", "iconTheme", "createdAt", "updatedAt",
] as const;

function projectTimeline(value: unknown): UnknownRecord {
  const timeline = record(value);
  const abilities = list(timeline.abilities);
  const entities = list(timeline.entities);
  const memberships = new Map<string, UnknownRecord>();
  for (const entityValue of entities) {
    for (const membershipValue of list(record(entityValue).memberships)) {
      const membership = project(membershipValue, MEMBERSHIP_KEYS);
      const id = membership.id;
      if (typeof id === "string") memberships.set(id, membership);
    }
  }

  return {
    ...project(timeline, TIMELINE_KEYS),
    chapters: list(timeline.chapters).map((chapterValue) => {
      const chapter = record(chapterValue);
      return {
        ...project(chapter, CHAPTER_KEYS),
        messages: list(chapter.messages).map((message) => project(message, MESSAGE_KEYS)),
      };
    }),
    gods: list(timeline.gods).map((god) => project(god, GOD_KEYS)),
    entities: entities.map((entityValue) => {
      const entity = record(entityValue);
      return {
        ...project(entity, ENTITY_KEYS),
        sections: list(entity.sections).map((section) => project(section, ENTITY_SECTION_KEYS)),
      };
    }),
    abilities: abilities.map((ability) => project(ability, ABILITY_KEYS)),
    abilityEvents: abilities.flatMap((ability) =>
      list(record(ability).events).map((event) => project(event, ABILITY_EVENT_KEYS))),
    memberships: Array.from(memberships.values()),
    chronicles: list(timeline.chronicles).map((chronicle) => project(chronicle, CHRONICLE_KEYS)),
    omens: list(timeline.omens).map((omen) => project(omen, OMEN_KEYS)),
    canonEvents: list(timeline.canonEvents).map((event) => project(event, CANON_EVENT_KEYS)),
    iconAssignments: list(timeline.iconAssignments).map((assignment) =>
      project(assignment, ICON_ASSIGNMENT_KEYS)),
  };
}

/** Explicit version 2 projection. Runtime-only fields are intentionally absent. */
export function projectVersionTwoWorld(value: unknown) {
  const world = record(value);
  return {
    ...project(world, WORLD_KEYS),
    timelines: list(world.timelines).map(projectTimeline),
    lorebookEntries: list(world.lorebookEntries).map((entry) => project(entry, LOREBOOK_KEYS)),
  };
}
