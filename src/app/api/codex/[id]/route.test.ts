import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entityFindFirst: vi.fn(),
  entityRelationFindMany: vi.fn(),
  chronicleFindMany: vi.fn(),
  iconAssignmentFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    entity: {
      findFirst: mocks.entityFindFirst,
    },
    entityRelation: { findMany: mocks.entityRelationFindMany },
    chronicleEntry: { findMany: mocks.chronicleFindMany },
    iconAssignment: { findUnique: mocks.iconAssignmentFindUnique },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "entity-1" }) };
const observer = (viewpoint: "omniscient" | "limited") => ({
  focusType: "world",
  focusId: null,
  timeLabel: "星海元年",
  viewpoint,
  activeAvatarId: null,
});
const hiddenAbility = {
  id: "ability-hidden",
  name: "隐秘血脉",
  kind: "personal",
  effect: "听见旧现实的回声",
  trigger: "梦境",
  cost: "遗忘姓名",
  limitations: "每月一次",
  mastery: "novice",
  state: "normal",
  visibility: "hidden",
  rumorText: null,
  bloodlineJustification: null,
  sourceAbilityId: null,
  lockedFields: [],
  version: 1,
  events: [{
    id: "event-hidden",
    type: "learned",
    evidence: "在密室中觉醒",
    scale: "scene",
    createdAt: new Date("2026-07-22T00:00:00.000Z"),
  }],
};

function entity(mode: "creator" | "pantheon", viewpoint: "omniscient" | "limited") {
  return {
    id: "entity-1",
    timelineId: "timeline-1",
    type: "character",
    name: "观星者",
    sections: [{
      id: "section-hidden",
      key: "secret",
      content: { text: "她来自已经消亡的现实。" },
      revealed: false,
      rumorText: "她从不谈故乡。",
      playerLocked: false,
    }],
    abilities: [hiddenAbility],
    race: null,
    memberships: [],
    timeline: {
      observerState: observer(viewpoint),
      world: { id: "world-1", mode, iconTheme: null },
    },
  };
}

describe("GET /api/codex/[id] projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.entityFindFirst.mockResolvedValue(entity("creator", "omniscient"));
    mocks.entityRelationFindMany.mockResolvedValue([]);
    mocks.iconAssignmentFindUnique.mockResolvedValue(null);
    mocks.chronicleFindMany.mockResolvedValue([{
      id: "chronicle-hidden",
      chapterIndex: 2,
      yearLabel: "星海二年",
      text: "她烧毁了旧现实的最后一页。",
      revealed: false,
      revealedAtChapter: null,
    }]);
  });

  it("全知 creator 返回未揭示栏目、隐藏能力、完整沿革和幕后编年史", async () => {
    const body = await (await GET(new Request("http://localhost/api/codex/entity-1"), context)).json();

    expect(body.entity.sections[0]).toMatchObject({
      revealed: false,
      content: { text: "她来自已经消亡的现实。" },
    });
    expect(body.entity.abilities[0]).toMatchObject({
      name: "隐秘血脉",
      visibility: "hidden",
      worldVisible: false,
      effect: "听见旧现实的回声",
    });
    expect(body.entity.abilityEvents[0]).toMatchObject({
      id: "event-hidden",
      abilityId: "ability-hidden",
      evidence: "在密室中觉醒",
    });
    expect(body.chronicle[0]).toMatchObject({ revealed: false, worldVisible: false });
    expect(mocks.chronicleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { timelineId: "timeline-1", entityIds: { has: "entity-1" } },
    }));
  });

  it("迷雾 creator 隐去栏目正文、隐藏能力、沿革和幕后编年史", async () => {
    mocks.entityFindFirst.mockResolvedValue(entity("creator", "limited"));
    mocks.chronicleFindMany.mockResolvedValue([]);

    const body = await (await GET(new Request("http://localhost/api/codex/entity-1"), context)).json();

    expect(body.entity.sections[0].content).toBeNull();
    expect(body.entity.abilities).toEqual([]);
    expect(body.entity.abilityEvents).toEqual([]);
    expect(body.chronicle).toEqual([]);
    expect(mocks.chronicleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revealed: true }),
    }));
  });

  it("pantheon 忽略伪造的 omniscient 查询参数", async () => {
    mocks.entityFindFirst.mockResolvedValue(entity("pantheon", "omniscient"));
    mocks.chronicleFindMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/codex/entity-1?viewpoint=omniscient");
    const body = await (await GET(request, context)).json();

    expect(body.entity.sections[0].content).toBeNull();
    expect(body.entity.abilities).toEqual([]);
    expect(mocks.chronicleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revealed: true }),
    }));
  });

  it("人物详情返回按出入方向分组的关系和另一方基本信息", async () => {
    mocks.entityRelationFindMany.mockResolvedValue([
      {
        id: "relation-outgoing",
        timelineId: "timeline-1",
        sourceEntityId: "entity-1",
        targetEntityId: "entity-2",
        label: "ally",
        note: "曾共同守卫霜河。",
        sourceEntity: {
          id: "entity-1",
          type: "character",
          name: "观星者",
          summary: "仰望群星的人。",
          emblemSeed: "stars",
          imageUrl: null,
        },
        targetEntity: {
          id: "entity-2",
          type: "character",
          name: "守河人",
          summary: "北境斥候。",
          emblemSeed: "river",
          imageUrl: null,
        },
      },
      {
        id: "relation-incoming",
        timelineId: "timeline-1",
        sourceEntityId: "entity-3",
        targetEntityId: "entity-1",
        label: "mentor",
        note: "教授了火器制造。",
        sourceEntity: {
          id: "entity-3",
          type: "character",
          name: "旧导师",
          summary: "隐居的火器大师。",
          emblemSeed: "master",
          imageUrl: "/master.png",
        },
        targetEntity: {
          id: "entity-1",
          type: "character",
          name: "观星者",
          summary: "仰望群星的人。",
          emblemSeed: "stars",
          imageUrl: null,
        },
      },
    ]);

    const body = await (await GET(new Request("http://localhost/api/codex/entity-1"), context)).json();

    expect(mocks.entityRelationFindMany).toHaveBeenCalledWith({
      where: {
        timelineId: "timeline-1",
        OR: [
          { sourceEntityId: "entity-1" },
          { targetEntityId: "entity-1" },
        ],
      },
      include: {
        sourceEntity: { select: expect.any(Object) },
        targetEntity: { select: expect.any(Object) },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    expect(body.entity.relations.outgoing).toEqual([
      expect.objectContaining({
        id: "relation-outgoing",
        label: "盟友",
        note: "曾共同守卫霜河。",
        target: expect.objectContaining({ id: "entity-2", name: "守河人" }),
      }),
    ]);
    expect(body.entity.relations.incoming).toEqual([
      expect.objectContaining({
        id: "relation-incoming",
        label: "师长",
        source: expect.objectContaining({ id: "entity-3", name: "旧导师" }),
      }),
    ]);
  });

  it("limited 视角不返回隐藏关系，全知视角保留并标明世界内不可见", async () => {
    const hiddenRelation = {
      id: "relation-hidden",
      timelineId: "timeline-1",
      sourceEntityId: "entity-1",
      targetEntityId: "entity-2",
      label: "enemy",
      note: "尚无人知晓的仇怨。",
      visibility: "hidden",
      sourceEntity: {
        id: "entity-1",
        type: "character",
        name: "观星者",
        summary: "仰望群星的人。",
        emblemSeed: "stars",
        imageUrl: null,
      },
      targetEntity: {
        id: "entity-2",
        type: "character",
        name: "黑衣人",
        summary: "身份不明。",
        emblemSeed: "shadow",
        imageUrl: null,
      },
    };
    mocks.entityRelationFindMany.mockResolvedValue([hiddenRelation]);

    const omniscientBody = await (
      await GET(new Request("http://localhost/api/codex/entity-1"), context)
    ).json();
    expect(omniscientBody.entity.relations.outgoing[0]).toMatchObject({
      visibility: "hidden",
      worldVisible: false,
    });

    mocks.entityFindFirst.mockResolvedValue(entity("creator", "limited"));
    const limitedBody = await (
      await GET(new Request("http://localhost/api/codex/entity-1"), context)
    ).json();
    expect(limitedBody.entity.relations).toEqual({ outgoing: [], incoming: [] });
  });
});
