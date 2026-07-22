import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ObserverActionSchema,
  ObserverStateSchema,
  type ObserverAction,
  type ObserverState,
} from "@/lib/reality/schemas";

type Context = { params: Promise<{ id: string }> };
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

class ObserverRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function emblemSeed(name: string): string {
  let hash = 5381;
  for (const char of name) {
    hash = ((hash << 5) + hash + char.codePointAt(0)!) >>> 0;
  }
  return hash.toString(36);
}

function worldFocus(observer: ObserverState): ObserverState {
  return ObserverStateSchema.parse({
    ...observer,
    focusType: "world",
    focusId: null,
    activeAvatarId: null,
  });
}

async function saveObserver(
  tx: Transaction,
  timelineId: string,
  observerState: ObserverState,
): Promise<ObserverState> {
  await tx.timeline.update({
    where: { id: timelineId },
    data: { observerState: json(observerState) },
  });
  return observerState;
}

async function findAvatar(
  tx: Transaction,
  timelineId: string,
  avatarId: string,
  requireActive: boolean,
) {
  return tx.entity.findFirst({
    where: {
      id: avatarId,
      timelineId,
      type: "character",
      isCreatorAvatar: true,
      ...(requireActive ? { heat: "active" } : {}),
    },
    select: {
      id: true,
      name: true,
      type: true,
      isCreatorAvatar: true,
      heat: true,
    },
  });
}

async function assertFocusTarget(
  tx: Transaction,
  timelineId: string,
  action: Extract<ObserverAction, { action: "set_focus" }>,
): Promise<void> {
  if (action.focusType === "world") return;

  if (action.focusType === "god") {
    const god = await tx.god.findFirst({
      where: { id: action.focusId!, timelineId },
      select: { id: true },
    });
    if (god === null) {
      throw new ObserverRequestError("当前现实中不存在该观察目标", 404);
    }
    return;
  }

  const entity = await tx.entity.findFirst({
    where: {
      id: action.focusId!,
      timelineId,
      ...(action.focusType === "place" ? { type: "place" } : {}),
      ...(action.focusType === "avatar"
        ? { type: "character", isCreatorAvatar: true, heat: "active" }
        : {}),
    },
    select: { id: true, type: true, isCreatorAvatar: true, heat: true },
  });
  if (entity === null) {
    throw new ObserverRequestError("当前现实中不存在该观察目标", 404);
  }
}

async function createAvatar(
  tx: Transaction,
  timelineId: string,
  observerState: ObserverState,
  action: Extract<ObserverAction, { action: "create_avatar" }>,
) {
  if (action.raceId !== null) {
    const race = await tx.entity.findFirst({
      where: { id: action.raceId, timelineId, type: "race" },
      select: { id: true, type: true },
    });
    if (race === null) {
      throw new ObserverRequestError("当前现实中不存在该种族", 404);
    }
  }

  const sourceIds = [...new Set(action.abilities.flatMap((ability) =>
    ability.sourceAbilityRef === null ? [] : [ability.sourceAbilityRef]
  ))];
  const sources = sourceIds.length === 0
    ? []
    : await tx.ability.findMany({
        where: { id: { in: sourceIds }, timelineId },
        select: { id: true },
      });
  if (sources.length !== sourceIds.length) {
    throw new ObserverRequestError("当前现实中不存在引用的能力来源", 404);
  }

  const avatar = await tx.entity.create({
    data: {
      timelineId,
      type: "character",
      name: action.name,
      aliases: [],
      emblemSeed: emblemSeed(action.name),
      summary: action.identity.slice(0, 200),
      lockedPaths: [],
      raceId: action.raceId,
      heat: "active",
      isCreatorAvatar: true,
      sections: {
        create: [
          { key: "overview", content: json({ text: action.identity }), revealed: true },
          { key: "identity", content: json({ text: action.identity }), revealed: true },
          { key: "appearance", content: json({ text: action.appearance }), revealed: true },
        ],
      },
      abilities: {
        create: action.abilities.map((ability) => ({
          timeline: { connect: { id: timelineId } },
          name: ability.name,
          kind: ability.kind,
          effect: ability.effect,
          trigger: ability.trigger,
          cost: ability.cost,
          limitations: ability.limitations,
          mastery: ability.mastery,
          state: ability.state,
          visibility: ability.visibility,
          rumorText: ability.rumorText,
          bloodlineJustification: ability.bloodlineJustification,
          sourceAbilityId: ability.sourceAbilityRef,
          lockedFields: [...ability.lockedFields],
        })),
      },
    },
    include: { sections: true, abilities: true, race: true },
  });
  return { status: 201, body: { avatar, observerState } };
}

async function applyAction(
  tx: Transaction,
  timelineId: string,
  observerState: ObserverState,
  action: ObserverAction,
) {
  switch (action.action) {
    case "set_focus": {
      await assertFocusTarget(tx, timelineId, action);
      const next = ObserverStateSchema.parse({
        ...observerState,
        focusType: action.focusType,
        focusId: action.focusId,
      });
      return { status: 200, body: { observerState: await saveObserver(tx, timelineId, next) } };
    }
    case "set_viewpoint": {
      const next = ObserverStateSchema.parse({ ...observerState, viewpoint: action.viewpoint });
      return { status: 200, body: { observerState: await saveObserver(tx, timelineId, next) } };
    }
    case "create_avatar":
      return createAvatar(tx, timelineId, observerState, action);
    case "enter_avatar": {
      const avatar = await findAvatar(tx, timelineId, action.avatarId, true);
      if (avatar === null) {
        throw new ObserverRequestError("当前现实中不存在可进入的创世主化身", 404);
      }
      const next = ObserverStateSchema.parse({
        ...observerState,
        focusType: "avatar",
        focusId: avatar.id,
        activeAvatarId: avatar.id,
      });
      return { status: 200, body: { avatar, observerState: await saveObserver(tx, timelineId, next) } };
    }
    case "exit_avatar": {
      const next = worldFocus(observerState);
      return { status: 200, body: { observerState: await saveObserver(tx, timelineId, next) } };
    }
    case "withdraw_avatar": {
      const avatar = await findAvatar(tx, timelineId, action.avatarId, false);
      if (avatar === null) {
        throw new ObserverRequestError("当前现实中不存在该创世主化身", 404);
      }
      const focused = observerState.focusId === avatar.id
        || observerState.activeAvatarId === avatar.id;
      const next = focused ? worldFocus(observerState) : observerState;
      if (focused) await saveObserver(tx, timelineId, next);

      const withdrawn = await tx.entity.update({
        where: { id: avatar.id },
        data: { heat: "dormant", scenePresence: false },
      });
      const withdrawnContent = json({
        text: "该化身已被创世主收回，不再参与当前世界进程。",
        withdrawnAt: new Date().toISOString(),
      });
      await tx.entitySection.upsert({
        where: { entityId_key: { entityId: avatar.id, key: "withdrawn" } },
        create: {
          entityId: avatar.id,
          key: "withdrawn",
          content: withdrawnContent,
          revealed: true,
        },
        update: { content: withdrawnContent, revealed: true },
      });
      return { status: 200, body: { avatar: withdrawn, observerState: next } };
    }
  }
}

export async function PATCH(request: Request, { params }: Context) {
  let action: ObserverAction;
  try {
    action = ObserverActionSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "观察请求参数无效" }, { status: 400 });
    }
    throw error;
  }

  try {
    const { id } = await params;
    const result = await prisma.$transaction(async (tx) => {
      const world = await tx.world.findUnique({
        where: { id },
        select: { id: true, mode: true, activeTimelineId: true },
      });
      if (world === null) throw new ObserverRequestError("世界不存在", 404);
      if (world.mode !== "creator") {
        throw new ObserverRequestError("只有创世主世界可以调整天外视界", 403);
      }
      if (world.activeTimelineId === null) {
        throw new ObserverRequestError("世界尚未开局（无活动时间线）", 409);
      }

      const timeline = await tx.timeline.findUnique({
        where: { id: world.activeTimelineId },
        select: { id: true, observerState: true },
      });
      if (timeline === null) {
        throw new ObserverRequestError("活动时间线不存在", 404);
      }
      const observerState = ObserverStateSchema.parse(timeline.observerState);
      return applyAction(tx, timeline.id, observerState, action);
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof ObserverRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
