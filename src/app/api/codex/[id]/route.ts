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
  projectAbilitiesForPlayer,
  projectAbilityForPlayer,
} from "@/lib/abilities/visibility";

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
    evidence?: string;
    scale?: string;
    createdAt: unknown;
  }>;
};

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entity = await prisma.entity.findUnique({
    where: { id },
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
    },
  });
  if (!entity) return NextResponse.json({ error: "不存在" }, { status: 404 });

  // 专属编年史：涉及该实体且已揭示
  const chronicle = await prisma.chronicleEntry.findMany({
    where: {
      timelineId: entity.timelineId,
      revealed: true,
      entityIds: { has: entity.id },
    },
    orderBy: [{ chapterIndex: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      chapterIndex: true,
      yearLabel: true,
      text: true,
      revealedAtChapter: true,
    },
  });

  const { abilities, race, memberships, ...entityFields } = entity;
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
      abilities: projectAbilitiesForPlayer(characterAbilities),
      abilityEvents: projectVisibleAbilityEvents(
        entity.type === "character"
          ? [...abilities, ...inheritedRaceAbilities]
          : abilities,
      ),
      ...(entity.type === "character"
        ? {
          race: race === null ? null : { id: race.id, name: race.name, summary: race.summary },
          memberships,
        }
        : {}),
    },
    chronicle,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = PatchSchema.parse(await request.json());

  const entity = await prisma.entity.findUnique({ where: { id } });
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
}
