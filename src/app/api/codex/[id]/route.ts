import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  normalizePersistedAbility,
  type PersistedAbilityRecord,
} from "@/lib/abilities/types";
import { resolveEffectiveAbilities } from "@/lib/abilities/resolver";
import {
  projectAbilitiesForOmniscient,
  projectAbilitiesForPlayer,
  projectAbilityForPlayer,
} from "@/lib/abilities/visibility";
import { WorldModeSchema } from "@/lib/world-mode";
import {
  canViewWorldKnowledge,
  isOmniscientViewer,
  projectChronicleForViewer,
  projectSectionsForViewer,
  realityViewerFromPersistence,
} from "@/lib/reality/visibility";
import { parseWorldIconTheme } from "@/lib/icons/theme";
import { resolveIcon } from "@/lib/icons/resolver";
import { loadLocalIcon } from "@/lib/icons/svg.server";
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";

/**
 * GET   /api/codex/[id] —— 实体详情（sections + 专属编年史）
 * PATCH /api/codex/[id] —— 标星/传图/手改栏目（手改即锁）
 */

const PatchSchema = z.object({
  starred: z.boolean().optional(),
  imageUrl: z.string().nullable().optional(),
  summary: z.string().max(300).optional(),
  sections: z
    .array(z.object({ key: z.string(), text: z.string() }))
    .optional(),
});

type AbilityWithEvents = PersistedAbilityRecord & {
  events?: Array<{
    id?: string;
    abilityId?: string;
    type: string;
    before?: unknown;
    after?: unknown;
    evidence?: string;
    scale?: string;
    createdAt: unknown;
  }>;
};

type RelatedEntity = {
  id: string;
  type: string;
  name: string;
  summary: string;
  emblemSeed: string;
  imageUrl: string | null;
};

type EntityRelationRecord = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  label: string;
  note: string | null;
  visibility?: string;
  sourceEntity: RelatedEntity;
  targetEntity: RelatedEntity;
};

type EntityRelationDelegate = {
  findMany(args: {
    where: {
      timelineId: string;
      OR: Array<
        { sourceEntityId: string }
        | { targetEntityId: string }
      >;
    };
    include: {
      sourceEntity: { select: typeof relatedEntitySelect };
      targetEntity: { select: typeof relatedEntitySelect };
    };
    orderBy: Array<{ updatedAt: "desc" } | { id: "asc" }>;
  }): Promise<EntityRelationRecord[]>;
};

const relatedEntitySelect = {
  id: true,
  type: true,
  name: true,
  summary: true,
  emblemSeed: true,
  imageUrl: true,
} as const;

const ENTITY_RELATION_LABELS: Record<string, string> = {
  family: "亲族",
  spouse: "伴侣",
  lover: "恋慕",
  friend: "友人",
  ally: "盟友",
  rival: "对手",
  enemy: "敌对",
  mentor: "师长",
  student: "门生",
  colleague: "同僚",
  neutral: "相识",
};

function relationLabel(label: string): string {
  return ENTITY_RELATION_LABELS[label] ?? label;
}

async function projectCharacterRelations(
  entity: { id: string; timelineId: string; type: string },
  viewer: ReturnType<typeof realityViewerFromPersistence>,
) {
  if (entity.type !== "character") {
    return { outgoing: [], incoming: [] };
  }

  const delegate = (
    prisma as unknown as { entityRelation: EntityRelationDelegate }
  ).entityRelation;
  const relations = await delegate.findMany({
    where: {
      timelineId: entity.timelineId,
      OR: [
        { sourceEntityId: entity.id },
        { targetEntityId: entity.id },
      ],
    },
    include: {
      sourceEntity: { select: relatedEntitySelect },
      targetEntity: { select: relatedEntitySelect },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  const visible = relations.filter((relation) => {
    const visibility = relation.visibility ?? "public";
    return visibility === "public"
      || visibility === "player_known"
      || visibility === "hidden"
      ? canViewWorldKnowledge(viewer, visibility)
      : true;
  });

  return {
    outgoing: visible
      .filter((relation) => relation.sourceEntityId === entity.id)
      .map((relation) => ({
        id: relation.id,
        direction: "outgoing" as const,
        label: relationLabel(relation.label),
        note: relation.note,
        visibility: relation.visibility ?? "public",
        ...(relation.visibility === "hidden" ? { worldVisible: false } : {}),
        target: relation.targetEntity,
      })),
    incoming: visible
      .filter((relation) => relation.targetEntityId === entity.id)
      .map((relation) => ({
        id: relation.id,
        direction: "incoming" as const,
        label: relationLabel(relation.label),
        note: relation.note,
        visibility: relation.visibility ?? "public",
        ...(relation.visibility === "hidden" ? { worldVisible: false } : {}),
        source: relation.sourceEntity,
      })),
  };
}

function normalizeAbilityWithoutEvents(ability: AbilityWithEvents) {
  const { events, ...record } = ability;
  void events;
  return normalizePersistedAbility(record);
}

function projectVisibleAbilityEvents(abilities: readonly AbilityWithEvents[]) {
  return abilities.flatMap<unknown>((ability) => {
    const projection = projectAbilityForPlayer(normalizeAbilityWithoutEvents(ability));
    if (projection === null) return [];

    const events = ability.events ?? [];
    if (projection.visibility === "rumored") {
      return events
        .filter((event) => event.type === "revealed")
        .map((event) => ({
          abilityId: ability.id,
          revealedAt: event.createdAt,
          rumorText: projection.rumorText,
        }));
    }
    return events.map((event) => ({ ...event, abilityId: ability.id }));
  });
}

function projectOmniscientAbilityEvents(abilities: readonly AbilityWithEvents[]) {
  return abilities.flatMap((ability) =>
    (ability.events ?? []).map((event) => ({ ...event, abilityId: ability.id })),
  );
}

export const GET = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const entity = await prisma.entity.findFirst({
    where: ownedWhere.entity(userId, id),
    include: {
      sections: true,
      abilities: { include: { events: { orderBy: { createdAt: "asc" } } } },
      race: {
        select: {
          id: true,
          name: true,
          summary: true,
          abilities: { include: { events: { orderBy: { createdAt: "asc" } } } },
        },
      },
      memberships: {
        include: {
          faction: { select: { id: true, name: true, summary: true } },
        },
      },
      timeline: {
        select: {
          observerState: true,
          world: { select: { id: true, mode: true, iconTheme: true } },
        },
      },
    },
  });
  if (!entity) return NextResponse.json({ error: "不存在" }, { status: 404 });

  const viewer = realityViewerFromPersistence(
    WorldModeSchema.parse(entity.timeline.world.mode),
    entity.timeline.observerState,
  );
  const omniscient = isOmniscientViewer(viewer);
  const relations = await projectCharacterRelations(entity, viewer);
  const iconAssignment = await prisma.iconAssignment.findUnique({
    where: {
      timelineId_subjectType_subjectId: {
        timelineId: entity.timelineId,
        subjectType: "entity",
        subjectId: entity.id,
      },
    },
  });
  const iconTheme = parseWorldIconTheme(entity.timeline.world.iconTheme);
  const normalizedIconAssignment = iconAssignment
    ? {
        token: iconAssignment.token,
        source: (["generated", "derived", "player"] as const).includes(
          iconAssignment.source as "generated" | "derived" | "player",
        )
          ? iconAssignment.source as "generated" | "derived" | "player"
          : "derived" as const,
        playerLocked: iconAssignment.playerLocked,
      }
    : null;
  const iconToken = iconAssignment?.token
    ?? iconTheme.assignments.entityTypes[entity.type]
    ?? `entity.${entity.type}`;
  const resolvedIcon = resolveIcon({
    theme: iconTheme,
    token: iconToken,
    subjectType: "entity",
    subjectId: entity.id,
    override: normalizedIconAssignment,
  });

  // 专属编年史：涉及该实体且已揭示
  const [chronicle, chronicleTimeRows] = await Promise.all([
    prisma.chronicleEntry.findMany({
      where: {
        timelineId: entity.timelineId,
        ...(omniscient ? {} : { revealed: true }),
        entityIds: { has: entity.id },
      },
      orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        chapterIndex: true,
        yearLabel: true,
        text: true,
        revealed: true,
        revealedAtChapter: true,
      },
    }),
    prisma.chronicleEntry.findMany({
      where: { timelineId: entity.timelineId },
      orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
      select: { chapterIndex: true, yearLabel: true },
    }),
  ]);
  const timeByInternalIndex = new Map<number, string>();
  for (const row of chronicleTimeRows) {
    if (!timeByInternalIndex.has(row.chapterIndex) && row.yearLabel.trim()) {
      timeByInternalIndex.set(row.chapterIndex, row.yearLabel);
    }
  }

  const { abilities, race, memberships, timeline: _timeline, ...entityFields } = entity;
  void _timeline;
  const ownAbilities = abilities.map(normalizeAbilityWithoutEvents);
  const effectiveCharacterAbilities = entity.type === "character"
    ? resolveEffectiveAbilities({
      raceAbilities: (race?.abilities ?? []).map(normalizeAbilityWithoutEvents),
      characterAbilities: ownAbilities,
    })
    : null;
  const characterAbilities = effectiveCharacterAbilities ?? ownAbilities;
  const inheritedRaceAbilityIds = new Set(
    effectiveCharacterAbilities
      ?.filter((ability) => ability.inherited)
      .map((ability) => ability.id) ?? [],
  );
  const inheritedRaceAbilities = race?.abilities.filter((ability) =>
    inheritedRaceAbilityIds.has(ability.id),
  ) ?? [];

  return NextResponse.json({
    entity: {
      ...entityFields,
      worldId: entity.timeline.world.id,
      timelineId: entity.timelineId,
      iconAssignment: {
        token: resolvedIcon.token,
        source: normalizedIconAssignment?.source ?? "derived",
        playerLocked: iconAssignment?.playerLocked ?? false,
        icon: loadLocalIcon(resolvedIcon.id),
      },
      sections: projectSectionsForViewer(entity.sections, viewer),
      abilities: omniscient
        ? projectAbilitiesForOmniscient(characterAbilities)
        : projectAbilitiesForPlayer(characterAbilities),
      abilityEvents: omniscient
        ? projectOmniscientAbilityEvents(
          entity.type === "character"
            ? [...abilities, ...inheritedRaceAbilities]
            : abilities,
        )
        : projectVisibleAbilityEvents(
          entity.type === "character"
            ? [...abilities, ...inheritedRaceAbilities]
            : abilities,
        ),
      ...(entity.type === "character"
        ? {
          race: race === null ? null : { id: race.id, name: race.name, summary: race.summary },
          memberships,
          relations,
        }
        : {}),
    },
    chronicle: chronicle.flatMap((entry) => {
      const projection = projectChronicleForViewer(entry, viewer);
      return projection === null ? [] : [{
        ...projection,
        yearLabel: entry.yearLabel.trim()
          || timeByInternalIndex.get(entry.chapterIndex)
          || "时间未载",
        revealedAtTimeLabel: entry.revealedAtChapter === null
          ? null
          : timeByInternalIndex.get(entry.revealedAtChapter) ?? null,
      }];
    }),
  });
});

export const PATCH = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const body = PatchSchema.parse(await request.json());

  const entity = await prisma.entity.findFirst({
    where: ownedWhere.entity(userId, id),
  });
  if (!entity) return NextResponse.json({ error: "不存在" }, { status: 404 });

  // 手改栏目：写 content.text + playerLocked，并入 entity.lockedPaths
  const newLocked = new Set(entity.lockedPaths);
  for (const s of body.sections ?? []) {
    await prisma.entitySection.upsert({
      where: { entityId_key: { entityId: id, key: s.key } },
      create: {
        entityId: id,
        key: s.key,
        content: { text: s.text } as Prisma.InputJsonValue,
        playerLocked: true,
        revealed: true,
      },
      update: {
        content: { text: s.text } as Prisma.InputJsonValue,
        playerLocked: true,
        revealed: true,
      },
    });
    newLocked.add(s.key);
  }

  const updated = await prisma.entity.update({
    where: { id },
    data: {
      ...(body.starred !== undefined ? { starred: body.starred } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
      ...(body.summary !== undefined
        ? {
            summary: body.summary,
            lockedPaths: [...newLocked, "summary"].filter(
              (v, i, a) => a.indexOf(v) === i,
            ),
          }
        : { lockedPaths: [...newLocked] }),
    },
    include: { sections: true },
  });

  return NextResponse.json({ entity: updated });
});
