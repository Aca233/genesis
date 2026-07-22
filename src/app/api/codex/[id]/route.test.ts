import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entityFindUnique: vi.fn(),
  chronicleFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    entity: { findUnique: mocks.entityFindUnique },
    chronicleEntry: { findMany: mocks.chronicleFindMany },
  },
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
      world: { mode },
    },
  };
}

describe("GET /api/codex/[id] projections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.entityFindUnique.mockResolvedValue(entity("creator", "omniscient"));
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
      visibility: "known",
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
    mocks.entityFindUnique.mockResolvedValue(entity("creator", "limited"));
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
    mocks.entityFindUnique.mockResolvedValue(entity("pantheon", "omniscient"));
    mocks.chronicleFindMany.mockResolvedValue([]);

    const request = new Request("http://localhost/api/codex/entity-1?viewpoint=omniscient");
    const body = await (await GET(request, context)).json();

    expect(body.entity.sections[0].content).toBeNull();
    expect(body.entity.abilities).toEqual([]);
    expect(mocks.chronicleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revealed: true }),
    }));
  });
});
