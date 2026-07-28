import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    world: { findUnique: vi.fn() },
    timeline: { findUnique: vi.fn(), update: vi.fn() },
    entity: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    entitySection: { upsert: vi.fn() },
    god: { findFirst: vi.fn() },
    ability: { findMany: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: { world: { findFirst: vi.fn().mockResolvedValue({ id: "world-1" }) }, $transaction: mocks.transaction },
}));
vi.mock("@/lib/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-user") }));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };
const originalObserver = {
  focusType: "world" as const,
  focusId: null,
  timeLabel: "星海元年",
  viewpoint: "omniscient" as const,
  activeAvatarId: null,
  focusedEventId: null,
};
const ability = {
  name: "化星为刃",
  kind: "personal",
  effect: "凝聚星光",
  trigger: "主动",
  cost: "短暂疲惫",
  limitations: "仅在星空下",
  mastery: "adept",
  state: "normal",
  visibility: "hidden",
  rumorText: null,
  bloodlineJustification: null,
  sourceAbilityRef: null,
  lockedFields: [],
} as const;

function request(body: unknown) {
  return new Request("http://localhost/api/worlds/world-1/observer", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/worlds/[id]/observer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.world.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "creator",
      activeTimelineId: "timeline-active",
    });
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: originalObserver,
    });
    mocks.tx.timeline.update.mockImplementation(async ({ data }) => ({
      id: "timeline-active",
      observerState: data.observerState,
    }));
    mocks.tx.entity.findFirst.mockResolvedValue(null);
    mocks.tx.god.findFirst.mockResolvedValue(null);
    mocks.tx.ability.findMany.mockResolvedValue([]);
    mocks.tx.entity.create.mockResolvedValue({
      id: "avatar-new",
      name: "星行者",
      type: "character",
      isCreatorAvatar: true,
      heat: "active",
    });
    mocks.tx.entity.update.mockResolvedValue({
      id: "avatar-1",
      name: "旧化身",
      type: "character",
      isCreatorAvatar: true,
      heat: "dormant",
    });
  });

  it("rejects malformed requests before opening a transaction", async () => {
    const malformed = new Request("http://localhost/api/worlds/world-1/observer", {
      method: "PATCH",
      body: "{not-json",
    });
    const invalidAction = await PATCH(request({ action: "become_world" }), context);
    const invalidJson = await PATCH(malformed, context);

    expect(invalidAction.status).toBe(400);
    expect(invalidJson.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects observer powers outside creator worlds", async () => {
    mocks.tx.world.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      activeTimelineId: "timeline-active",
    });

    const response = await PATCH(request({
      action: "set_viewpoint",
      viewpoint: "omniscient",
    }), context);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "只有创世主世界可以调整天外视界" });
    expect(mocks.tx.timeline.update).not.toHaveBeenCalled();
  });

  it.each([
    ["place", "place-1", "entity"],
    ["entity", "character-1", "entity"],
    ["god", "god-1", "god"],
  ] as const)("sets focus to an existing active-timeline %s", async (focusType, focusId, model) => {
    if (model === "entity") {
      mocks.tx.entity.findFirst.mockResolvedValue({
        id: focusId,
        type: focusType === "place" ? "place" : "character",
        isCreatorAvatar: false,
        heat: "active",
      });
    } else {
      mocks.tx.god.findFirst.mockResolvedValue({ id: focusId });
    }

    const response = await PATCH(request({ action: "set_focus", focusType, focusId }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.observerState).toEqual({ ...originalObserver, focusType, focusId });
    if (model === "entity") {
      expect(mocks.tx.entity.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: focusId, timelineId: "timeline-active" }),
        select: expect.any(Object),
      });
    } else {
      expect(mocks.tx.god.findFirst).toHaveBeenCalledWith({
        where: { id: focusId, timelineId: "timeline-active" },
        select: { id: true },
      });
    }
  });

  it("rejects a focus target that is absent from the active timeline", async () => {
    const response = await PATCH(request({
      action: "set_focus",
      focusType: "place",
      focusId: "place-on-old-reality",
    }), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "当前现实中不存在该观察目标" });
    expect(mocks.tx.timeline.update).not.toHaveBeenCalled();
  });

  it("toggles viewpoint by changing observer state only", async () => {
    const response = await PATCH(request({
      action: "set_viewpoint",
      viewpoint: "limited",
    }), context);

    expect(response.status).toBe(200);
    expect((await response.json()).observerState).toEqual({
      ...originalObserver,
      viewpoint: "limited",
    });
    expect(mocks.tx.timeline.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.entity.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.god.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.ability.findMany).not.toHaveBeenCalled();
  });

  it("creates an active character avatar with explicit sections and abilities", async () => {
    mocks.tx.entity.findFirst.mockResolvedValueOnce({ id: "race-1", type: "race" });

    const response = await PATCH(request({
      action: "create_avatar",
      name: " 星行者 ",
      identity: "群星在人间的无名旅者",
      appearance: "银发，瞳中映着星轨",
      raceId: "race-1",
      abilities: [ability],
    }), context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.avatar).toMatchObject({ id: "avatar-new", isCreatorAvatar: true });
    expect(body.observerState).toEqual(originalObserver);
    expect(mocks.tx.entity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        timelineId: "timeline-active",
        type: "character",
        name: "星行者",
        aliases: [],
        raceId: "race-1",
        heat: "active",
        isCreatorAvatar: true,
        sections: {
          create: [
            { key: "overview", content: { text: "群星在人间的无名旅者" }, revealed: true },
            { key: "identity", content: { text: "群星在人间的无名旅者" }, revealed: true },
            { key: "appearance", content: { text: "银发，瞳中映着星轨" }, revealed: true },
          ],
        },
        abilities: {
          create: [expect.objectContaining({
            name: "化星为刃",
            visibility: "hidden",
            sourceAbilityId: null,
          })],
        },
      }),
      include: expect.any(Object),
    });
  });

  it("rejects avatar race and ability sources outside the active timeline", async () => {
    const raceResponse = await PATCH(request({
      action: "create_avatar",
      name: "越界者",
      identity: "来自旧现实",
      appearance: "无",
      raceId: "race-old",
      abilities: [],
    }), context);
    expect(raceResponse.status).toBe(404);
    expect(await raceResponse.json()).toEqual({ error: "当前现实中不存在该种族" });

    mocks.tx.entity.findFirst.mockResolvedValueOnce({ id: "race-1", type: "race" });
    mocks.tx.ability.findMany.mockResolvedValueOnce([]);
    const abilityResponse = await PATCH(request({
      action: "create_avatar",
      name: "越界者",
      identity: "借用了旧能力",
      appearance: "无",
      raceId: "race-1",
      abilities: [{ ...ability, sourceAbilityRef: "ability-old" }],
    }), context);
    expect(abilityResponse.status).toBe(404);
    expect(await abilityResponse.json()).toEqual({ error: "当前现实中不存在引用的能力来源" });
    expect(mocks.tx.entity.create).not.toHaveBeenCalled();
  });

  it("enters only a live creator avatar in the active timeline", async () => {
    mocks.tx.entity.findFirst.mockResolvedValue({
      id: "avatar-1",
      type: "character",
      isCreatorAvatar: true,
      heat: "active",
    });

    const response = await PATCH(request({ action: "enter_avatar", avatarId: "avatar-1" }), context);

    expect(response.status).toBe(200);
    expect((await response.json()).observerState).toEqual({
      ...originalObserver,
      focusType: "avatar",
      focusId: "avatar-1",
      activeAvatarId: "avatar-1",
    });

    mocks.tx.entity.findFirst.mockResolvedValue(null);
    const rejected = await PATCH(request({ action: "enter_avatar", avatarId: "ordinary-1" }), context);
    expect(rejected.status).toBe(404);
    expect(await rejected.json()).toEqual({ error: "当前现实中不存在可进入的创世主化身" });
  });

  it("exits a body without weakening creator viewpoint", async () => {
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: {
        ...originalObserver,
        viewpoint: "limited",
        focusType: "avatar",
        focusId: "avatar-1",
        activeAvatarId: "avatar-1",
      },
    });

    const response = await PATCH(request({ action: "exit_avatar" }), context);

    expect(response.status).toBe(200);
    expect((await response.json()).observerState).toEqual({
      ...originalObserver,
      viewpoint: "limited",
    });
  });

  it("clears avatar focus before withdrawing it and preserves historical identity", async () => {
    mocks.tx.timeline.findUnique.mockResolvedValue({
      id: "timeline-active",
      observerState: {
        ...originalObserver,
        focusType: "avatar",
        focusId: "avatar-1",
        activeAvatarId: "avatar-1",
      },
    });
    mocks.tx.entity.findFirst.mockResolvedValue({
      id: "avatar-1",
      type: "character",
      isCreatorAvatar: true,
      heat: "active",
    });

    const response = await PATCH(request({ action: "withdraw_avatar", avatarId: "avatar-1" }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.observerState).toEqual(originalObserver);
    expect(body.avatar).toMatchObject({ id: "avatar-1", heat: "dormant" });
    expect(mocks.tx.entity.update).toHaveBeenCalledWith({
      where: { id: "avatar-1" },
      data: { heat: "dormant", scenePresence: false },
    });
    expect(mocks.tx.entitySection.upsert).toHaveBeenCalledWith({
      where: { entityId_key: { entityId: "avatar-1", key: "withdrawn" } },
      create: expect.objectContaining({ entityId: "avatar-1", key: "withdrawn", revealed: true }),
      update: expect.objectContaining({ revealed: true }),
    });
    expect(mocks.tx.timeline.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tx.entity.update.mock.invocationCallOrder[0]!,
    );
  });

  it("never changes world mode when an avatar is dead or withdrawn", async () => {
    mocks.tx.entity.findFirst.mockImplementation(async ({ where }) =>
      where.heat === "active"
        ? null
        : {
            id: "avatar-dead",
            type: "character",
            isCreatorAvatar: true,
            heat: "dormant",
          },
    );

    const enter = await PATCH(request({ action: "enter_avatar", avatarId: "avatar-dead" }), context);
    const viewpoint = await PATCH(request({ action: "set_viewpoint", viewpoint: "omniscient" }), context);

    expect(enter.status).toBe(404);
    expect(viewpoint.status).toBe(200);
    expect(mocks.tx.world.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.tx.world).not.toHaveProperty("update");
  });
});
