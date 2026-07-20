import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    world: { findUnique: vi.fn() },
    entity: { findUnique: vi.fn() },
    god: { findUnique: vi.fn(), findMany: vi.fn() },
    chapter: { findUnique: vi.fn(), findFirst: vi.fn() },
    message: { findUnique: vi.fn() },
    timeline: { findUnique: vi.fn() },
    ability: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    abilityEvent: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
    chronicleEntry: { findMany: vi.fn() },
  },
  projectAbilitiesForOwner: vi.fn(),
  projectAbilitiesForPlayer: vi.fn(),
  projectAbilityForPlayer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/abilities/visibility", () => ({
  projectAbilitiesForOwner: mocks.projectAbilitiesForOwner,
  projectAbilitiesForPlayer: mocks.projectAbilitiesForPlayer,
  projectAbilityForPlayer: mocks.projectAbilityForPlayer,
}));

import { GET as getCodex } from "@/app/api/codex/[id]/route";

const knownAbility = {
  id: "ability-known",
  name: "晨光感知",
  kind: "racial_innate",
  effect: "感知晨光",
  trigger: "黎明",
  cost: "无",
  limitations: "阴影中减弱",
  mastery: "adept",
  state: "normal",
  visibility: "known",
  rumorText: null,
  bloodlineJustification: null,
  sourceAbilityId: null,
  lockedFields: [],
  version: 1,
};

const hiddenAbility = {
  ...knownAbility,
  id: "ability-hidden",
  name: "未揭示的真相",
  visibility: "hidden",
};

describe("能力 API 可见性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.chronicleEntry.findMany.mockResolvedValue([]);
    mocks.prisma.$transaction.mockImplementation(
      async (operation: (tx: typeof mocks.prisma) => unknown) => operation(mocks.prisma),
    );
    mocks.prisma.entity.findUnique.mockResolvedValue({
      id: "character-1",
      timelineId: "timeline-1",
      type: "character",
      raceId: "race-1",
    });
    mocks.prisma.god.findUnique.mockResolvedValue(null);
    mocks.prisma.chapter.findUnique.mockResolvedValue({
      id: "chapter-1",
      timelineId: "timeline-1",
    });
    mocks.prisma.message.findUnique.mockResolvedValue({
      id: "message-1",
      chapterId: "chapter-1",
      scale: "scene",
    });
    mocks.prisma.ability.findFirst.mockResolvedValue(null);
    mocks.prisma.timeline.findUnique.mockResolvedValue({
      id: "timeline-1",
      world: { activeTimelineId: "timeline-1" },
    });
    mocks.prisma.abilityEvent.findUnique.mockResolvedValue(null);
    mocks.prisma.abilityEvent.create.mockImplementation(async ({ data }) => ({
      id: "event-1",
      ...data,
    }));
    mocks.projectAbilityForPlayer.mockImplementation((ability) =>
      ability.visibility === "hidden" ? null : ability,
    );
  });

  it("GET 实体详情不含隐藏的种族模板能力", async () => {
    mocks.prisma.entity.findUnique.mockResolvedValue({
      id: "race-1",
      timelineId: "timeline-1",
      type: "race",
      sections: [],
      abilities: [knownAbility, hiddenAbility],
    });
    mocks.projectAbilitiesForPlayer.mockReturnValue([knownAbility]);

    const response = await getCodex(
      new Request("http://localhost/api/codex/race-1"),
      { params: Promise.resolve({ id: "race-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entity: { abilities: [knownAbility] },
    });
    expect(mocks.projectAbilitiesForPlayer).toHaveBeenCalledWith([
      knownAbility,
      hiddenAbility,
    ]);
  });

  it("GET 人物详情返回解析后的有效能力、种族摘要、成员关系和可见事件", async () => {
    const inherited = {
      ...knownAbility,
      id: "ability-inherited",
      events: [{ id: "event-race-template", type: "awakened", createdAt: "2026-01-01" }],
    };
    const personal = { ...knownAbility, id: "ability-personal", kind: "personal" };
    mocks.prisma.entity.findUnique.mockResolvedValue({
      id: "character-1",
      timelineId: "timeline-1",
      type: "character",
      sections: [],
      abilities: [personal],
      race: { id: "race-1", name: "晨裔", summary: "亲近晨光", abilities: [inherited] },
      memberships: [{ role: "守夜人", isPrimary: true, faction: { id: "faction-1", name: "晨钟会" } }],
    });
    mocks.projectAbilitiesForPlayer.mockImplementation((abilities) => abilities);

    const response = await getCodex(
      new Request("http://localhost/api/codex/character-1"),
      { params: Promise.resolve({ id: "character-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entity: {
        race: { id: "race-1", name: "晨裔" },
        memberships: [{ role: "守夜人", faction: { id: "faction-1", name: "晨钟会" } }],
        abilities: [{ id: "ability-inherited", inherited: true }, { id: "ability-personal", inherited: false }],
        abilityEvents: [{ id: "event-race-template", type: "awakened" }],
      },
    });
  });

  it("GET 世界状态对玩家神公开全部神权，对其他神按可见性投影", async () => {
    const { GET } = await import("@/app/api/worlds/[id]/state/route");
    mocks.prisma.world.findUnique.mockResolvedValue({
      id: "world-1",
      name: "测试界",
      status: "playing",
      activeTimelineId: "timeline-1",
      genesisInput: "神谕",
      themeCard: null,
      styleCard: null,
      cosmology: null,
      fusionAxiom: null,
      draftDeck: null,
    });
    mocks.prisma.chapter.findFirst.mockResolvedValue({
      id: "chapter-1",
      index: 1,
      title: "第一章",
      messages: [],
    });
    mocks.prisma.chapter.findUnique.mockResolvedValue(null);
    mocks.prisma.god.findMany.mockResolvedValue([
      { id: "god-player", name: "玩家神", isPlayer: true, abilities: [knownAbility, hiddenAbility] },
      { id: "god-major", name: "大敌神", isPlayer: false, abilities: [knownAbility, hiddenAbility] },
    ]);
    mocks.projectAbilitiesForOwner.mockImplementation((abilities) =>
      abilities.map((ability: typeof knownAbility) => ({ ...ability, visibility: "known" })),
    );
    mocks.projectAbilitiesForPlayer.mockReturnValue([knownAbility]);

    const response = await GET(
      new Request("http://localhost/api/worlds/world-1/state"),
      { params: Promise.resolve({ id: "world-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      gods: [
        {
          id: "god-player",
          abilities: [knownAbility, { ...hiddenAbility, visibility: "known" }],
        },
        { id: "god-major", abilities: [knownAbility] },
      ],
    });
    expect(mocks.projectAbilitiesForOwner).toHaveBeenCalledWith([
      knownAbility,
      hiddenAbility,
    ]);
  });

  it("PATCH 已知能力的未锁字段成功并递增 version", async () => {
    const { PATCH } = await import("./route");
    const stored = {
      ...knownAbility,
      kind: "personal",
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    };
    mocks.prisma.ability.findUnique.mockResolvedValue(stored);
    mocks.prisma.ability.update.mockImplementation(async ({ data }) => ({
      ...stored,
      ...data,
      version: stored.version + data.version.increment,
    }));

    const response = await PATCH(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          patch: { name: "晨曦感知" },
          event: {
            type: "mutated",
            chapterId: "chapter-1",
            messageId: "message-1",
            evidence: "第 1 章的见证",
            scale: "scene",
            dedupeKey: "ability-known:rename",
          },
        }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ability: { id: "ability-known", name: "晨曦感知", version: 2 },
    });
  });

  it("PATCH 锁定字段返回 409", async () => {
    const { PATCH } = await import("./route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...knownAbility,
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
      lockedFields: ["effect"],
    });

    const response = await PATCH(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          patch: { effect: "改写后的效果" },
          event: {
            type: "mutated",
            chapterId: "chapter-1",
            evidence: "第 1 章的见证",
            scale: "scene",
            dedupeKey: "ability-known:locked-effect",
          },
        }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.prisma.ability.update).not.toHaveBeenCalled();
  });

  it("PATCH 隐藏能力返回 404 且不启动任何写事务", async () => {
    const { PATCH } = await import("./route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...hiddenAbility,
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    });
    mocks.projectAbilityForPlayer.mockReturnValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/abilities/ability-hidden", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          patch: { name: "不应写入" },
          event: {
            type: "mutated",
            chapterId: "chapter-1",
            evidence: "不存在的证据",
            scale: "scene",
            dedupeKey: "ability-hidden:patch",
          },
        }),
      }),
      { params: Promise.resolve({ id: "ability-hidden" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.ability.update).not.toHaveBeenCalled();
    expect(mocks.prisma.abilityEvent.create).not.toHaveBeenCalled();
  });

  it("PATCH 响应使用传闻投影而不泄露原始能力字段", async () => {
    const { PATCH } = await import("./route");
    const stored = {
      ...knownAbility,
      kind: "personal",
      visibility: "rumored",
      rumorText: "据说她掌握晨光。",
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    };
    const rumorProjection = {
      id: stored.id,
      name: stored.name,
      kind: stored.kind,
      state: stored.state,
      visibility: "rumored",
      rumorText: stored.rumorText,
    };
    mocks.prisma.ability.findUnique.mockResolvedValue(stored);
    mocks.prisma.ability.update.mockImplementation(async ({ data }) => ({
      ...stored,
      ...data,
      version: stored.version + data.version.increment,
    }));
    mocks.projectAbilityForPlayer.mockReturnValue(rumorProjection);

    const response = await PATCH(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          patch: { name: "晨光感知" },
          event: {
            type: "mutated",
            chapterId: "chapter-1",
            evidence: "第 1 章的见证",
            scale: "scene",
            dedupeKey: "ability-known:rumor-response",
          },
        }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ability).toEqual(rumorProjection);
    expect(body.ability).not.toHaveProperty("effect");
  });

  it.each(["hidden", "rumored", "known"] as const)(
    "PATCH 不允许通过普通编辑路径将 visibility 设为 %s",
    async (visibility) => {
      const { PATCH } = await import("./route");
      mocks.prisma.ability.findUnique.mockResolvedValue({
        ...knownAbility,
        kind: "personal",
        timelineId: "timeline-1",
        entityId: "character-1",
        godId: null,
      });

      const response = await PATCH(
        new Request("http://localhost/api/abilities/ability-known", {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: 1,
            patch: { visibility },
            event: {
              type: "mutated",
              chapterId: "chapter-1",
              evidence: "普通编辑不得改变揭示状态",
              scale: "scene",
              dedupeKey: `ability-known:visibility-${visibility}`,
            },
          }),
        }),
        { params: Promise.resolve({ id: "ability-known" }) },
      );

      expect(response.status).toBe(400);
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
      expect(mocks.prisma.ability.update).not.toHaveBeenCalled();
    },
  );

  it("PATCH expectedVersion 过期时返回 409", async () => {
    const { PATCH } = await import("./route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...knownAbility,
      kind: "personal",
      version: 2,
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    });

    const response = await PATCH(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          patch: { name: "过期改名" },
          event: {
            type: "mutated",
            chapterId: "chapter-1",
            evidence: "第 1 章的见证",
            scale: "scene",
            dedupeKey: "ability-known:stale-version",
          },
        }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.prisma.ability.update).not.toHaveBeenCalled();
  });

  it("history 不返回隐藏能力的沿革", async () => {
    const { GET } = await import("./history/route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...hiddenAbility,
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    });
    mocks.projectAbilityForPlayer.mockReturnValue(null);

    const response = await GET(
      new Request("http://localhost/api/abilities/ability-hidden/history"),
      { params: Promise.resolve({ id: "ability-hidden" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.prisma.abilityEvent.findMany).not.toHaveBeenCalled();
  });

  it("POST 只创建当前时间线内的非隐藏手动能力", async () => {
    const { POST } = await import("../route");
    mocks.prisma.ability.create.mockImplementation(async ({ data }) => ({
      id: "ability-created",
      version: 1,
      ...data,
    }));

    const response = await POST(new Request("http://localhost/api/abilities", {
      method: "POST",
      body: JSON.stringify({
        timelineId: "timeline-1",
        entityId: "character-1",
        godId: null,
        name: "新学会的技艺",
        kind: "personal",
        effect: "改变局势",
        trigger: "仪式完成",
        cost: "一夜祈祷",
        limitations: "每章一次",
        mastery: "novice",
        state: "normal",
        visibility: "known",
        rumorText: null,
        bloodlineJustification: null,
        sourceAbilityId: null,
        lockedFields: [],
      }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ability: { id: "ability-created", visibility: "known" },
    });
  });

  it("POST 拒绝隐藏能力", async () => {
    const { POST } = await import("../route");
    const response = await POST(new Request("http://localhost/api/abilities", {
      method: "POST",
      body: JSON.stringify({
        timelineId: "timeline-1",
        entityId: "character-1",
        godId: null,
        name: "不可见能力",
        kind: "personal",
        effect: "不应保存",
        trigger: "无",
        cost: "无",
        limitations: "无",
        mastery: "novice",
        state: "normal",
        visibility: "hidden",
        rumorText: null,
        bloodlineJustification: null,
        sourceAbilityId: null,
        lockedFields: [],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.prisma.ability.create).not.toHaveBeenCalled();
  });

  it("POST 派生能力的数据库来源唯一约束冲突返回 409", async () => {
    const { POST } = await import("../route");
    mocks.prisma.ability.findUnique.mockImplementation(async ({ where }) => (
      where.id === "race-template-1"
        ? {
          ...knownAbility,
          id: "race-template-1",
          timelineId: "timeline-1",
          entityId: "race-1",
          godId: null,
          sourceAbilityId: null,
        }
        : null
    ));
    mocks.prisma.entity.findUnique.mockImplementation(async ({ where }) => (
      where.id === "race-1"
        ? { id: "race-1", timelineId: "timeline-1", type: "race", raceId: null }
        : { id: "character-1", timelineId: "timeline-1", type: "character", raceId: "race-1" }
    ));
    mocks.prisma.ability.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["entity_id", "source_ability_id"] },
    }));

    const response = await POST(new Request("http://localhost/api/abilities", {
      method: "POST",
      body: JSON.stringify({
        timelineId: "timeline-1",
        entityId: "character-1",
        godId: null,
        name: "重复的种族继承",
        kind: "racial_innate",
        effect: "晨光感知",
        trigger: "日出",
        cost: "无",
        limitations: "无",
        mastery: "novice",
        state: "normal",
        visibility: "known",
        rumorText: null,
        bloodlineJustification: null,
        sourceAbilityId: "race-template-1",
        lockedFields: [],
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/重复.*来源/) });
  });

  it("DELETE 无沿革能力时物理删除", async () => {
    const { DELETE } = await import("./route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...knownAbility,
      kind: "personal",
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    });
    mocks.prisma.abilityEvent.count.mockResolvedValue(0);
    mocks.prisma.ability.deleteMany.mockResolvedValue({ count: 1 });

    const response = await DELETE(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true, deprecated: false });
  });

  it("DELETE 隐藏能力返回 404 且不写入、计数或删除", async () => {
    const { DELETE } = await import("./route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...hiddenAbility,
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    });
    mocks.projectAbilityForPlayer.mockReturnValue(null);

    const response = await DELETE(
      new Request("http://localhost/api/abilities/ability-hidden", {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ id: "ability-hidden" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.abilityEvent.count).not.toHaveBeenCalled();
    expect(mocks.prisma.ability.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.ability.update).not.toHaveBeenCalled();
  });

  it("DELETE 在事务行锁发现并发版本变更时返回 409，且不会级联新事件", async () => {
    const { DELETE } = await import("./route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...knownAbility,
      kind: "personal",
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    });
    mocks.prisma.abilityEvent.count.mockResolvedValue(0);
    mocks.prisma.ability.update.mockRejectedValue(new Error("concurrent update"));

    const response = await DELETE(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.prisma.ability.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.ability.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.abilityEvent.create).not.toHaveBeenCalled();
  });

  it("DELETE 对仍被派生能力引用的来源写入 deprecated 事件而不物理删除", async () => {
    const { DELETE } = await import("./route");
    const stored = {
      ...knownAbility,
      kind: "personal",
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    };
    mocks.prisma.ability.findUnique.mockResolvedValue(stored);
    mocks.prisma.abilityEvent.count.mockResolvedValue(0);
    mocks.prisma.ability.findFirst.mockResolvedValue({ id: "derived-ability" });
    mocks.prisma.ability.update.mockImplementation(async ({ data }) => ({
      ...stored,
      ...data,
      version: stored.version + data.version.increment,
    }));

    const response = await DELETE(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "DELETE",
        body: JSON.stringify({
          expectedVersion: 1,
          event: {
            type: "mutated",
            chapterId: "chapter-1",
            evidence: "来源能力仍被后裔承继",
            scale: "scene",
            dedupeKey: "ability-known:retain-lineage",
          },
        }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deprecated: true,
      ability: { state: "deprecated" },
    });
    expect(mocks.prisma.ability.delete).not.toHaveBeenCalled();
  });

  it("DELETE 有沿革能力时将其废弃并写入 deprecated 事件", async () => {
    const { DELETE } = await import("./route");
    const stored = {
      ...knownAbility,
      kind: "personal",
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    };
    mocks.prisma.ability.findUnique.mockResolvedValue(stored);
    mocks.prisma.abilityEvent.count.mockResolvedValue(1);
    mocks.prisma.ability.update.mockImplementation(async ({ data }) => ({
      ...stored,
      ...data,
      version: stored.version + data.version.increment,
    }));

    const response = await DELETE(
      new Request("http://localhost/api/abilities/ability-known", {
        method: "DELETE",
        body: JSON.stringify({
          expectedVersion: 1,
          event: {
            type: "mutated",
            chapterId: "chapter-1",
            evidence: "能力由史书废弃",
            scale: "scene",
            dedupeKey: "ability-known:deprecated",
          },
        }),
      }),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deprecated: true,
      ability: { state: "deprecated", version: 2 },
      event: { type: "deprecated" },
    });
  });

  it("history 对传闻能力只公开揭示时间和 rumorText", async () => {
    const { GET } = await import("./history/route");
    mocks.prisma.ability.findUnique.mockResolvedValue({
      ...knownAbility,
      visibility: "rumored",
      rumorText: "据说此技源自失落王朝。",
      timelineId: "timeline-1",
      entityId: "character-1",
      godId: null,
    });
    mocks.projectAbilityForPlayer.mockReturnValue({
      id: "ability-known",
      name: "晨光感知",
      kind: "racial_innate",
      state: "normal",
      visibility: "rumored",
      rumorText: "据说此技源自失落王朝。",
    });
    mocks.prisma.abilityEvent.findMany.mockResolvedValue([
      { id: "event-1", type: "mutated", evidence: "不可泄露", createdAt: "2026-01-01" },
      { id: "event-2", type: "revealed", evidence: "仍不可泄露", createdAt: "2026-01-02" },
    ]);

    const response = await GET(
      new Request("http://localhost/api/abilities/ability-known/history"),
      { params: Promise.resolve({ id: "ability-known" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      history: [{ revealedAt: "2026-01-02", rumorText: "据说此技源自失落王朝。" }],
    });
  });
});
