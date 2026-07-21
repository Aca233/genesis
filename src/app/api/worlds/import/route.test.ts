import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const model = () => ({ create: vi.fn(), createMany: vi.fn() });
  return {
    prisma: {
      world: { findUnique: vi.fn(), create: vi.fn() },
      timeline: model(),
      chapter: model(),
      message: model(),
      entity: model(),
      entitySection: model(),
      god: model(),
      ability: model(),
      entityMembership: model(),
      abilityEvent: model(),
      chronicleEntry: model(),
      omenQueue: model(),
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { GET as exportWorld } from "@/app/api/worlds/[id]/export/route";
import { POST as importWorld } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/worlds/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function requestWithHeaders(body: string, headers: Record<string, string>) {
  return new Request("http://localhost/api/worlds/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

function legacyArchive() {
  return {
    version: 1,
    exportedAt: "2026-07-20T00:00:00.000Z",
    world: {
      id: "world-old",
      userId: "local",
      name: "旧世界",
      genesisInput: "旧神谕",
      status: "playing",
      draftDeck: null,
      lockedPaths: [],
      themeCard: null,
      styleCard: null,
      cosmology: null,
      fusionAxiom: null,
      activeTimelineId: "timeline-old",
      timelines: [
        {
          id: "timeline-old",
          worldId: "world-old",
          parentId: null,
          forkChapter: null,
          chapters: [],
          gods: [],
          entities: [],
          chronicles: [],
          omens: [],
          createdAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      lorebookEntries: [],
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  };
}

function versionTwoArchive() {
  const base = legacyArchive();
  return {
    ...base,
    version: 2,
    world: {
      ...base.world,
      name: "能力世界",
      timelines: [
        {
          ...base.world.timelines[0],
          chapters: [
            {
              id: "chapter-old",
              timelineId: "timeline-old",
              index: 1,
              title: "觉醒",
              summary: "晨光降临",
              settleState: "settled",
              snapshot: null,
              messages: [
                {
                  id: "message-old",
                  chapterId: "chapter-old",
                  index: 0,
                  role: "narrator",
                  content: "她在晨光中觉醒。",
                  scale: "scene",
                  variants: null,
                  meta: null,
                  createdAt: "2026-07-20T00:00:00.000Z",
                },
              ],
              createdAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          gods: [
            {
              id: "god-old",
              timelineId: "timeline-old",
              name: "晨神",
              aliases: [],
              tier: "player",
              isPlayer: true,
              rank: "nascent",
              domains: ["晨光"],
              persona: null,
              voice: null,
              agenda: null,
              agendaRevealed: false,
              relations: {},
              faithScope: null,
              codexEntityId: "character-old",
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          entities: [
            {
              id: "race-old",
              timelineId: "timeline-old",
              type: "race",
              name: "晨裔",
              aliases: [],
              emblemSeed: "race",
              imageUrl: null,
              starred: false,
              isChosen: false,
              isMajorCharacter: false,
              raceId: null,
              heat: "active",
              scenePresence: false,
              summary: "晨光之民",
              lockedPaths: [],
              sections: [],
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
            {
              id: "faction-old",
              timelineId: "timeline-old",
              type: "faction",
              name: "晨钟会",
              aliases: [],
              emblemSeed: "faction",
              imageUrl: null,
              starred: false,
              isChosen: false,
              isMajorCharacter: false,
              raceId: null,
              heat: "active",
              scenePresence: false,
              summary: "守望晨光",
              lockedPaths: [],
              sections: [],
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
            {
              id: "character-old",
              timelineId: "timeline-old",
              type: "character",
              name: "曦",
              aliases: [],
              emblemSeed: "character",
              imageUrl: null,
              starred: true,
              isChosen: true,
              isMajorCharacter: true,
              raceId: "race-old",
              heat: "active",
              scenePresence: true,
              summary: "晨钟守望者",
              lockedPaths: [],
              sections: [],
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          abilities: [
            {
              id: "race-ability-old",
              timelineId: "timeline-old",
              entityId: "race-old",
              godId: null,
              sourceAbilityId: null,
              name: "晨光血脉",
              kind: "racial_innate",
              effect: "感知晨光",
              trigger: "黎明",
              cost: "无",
              limitations: "黑夜中沉寂",
              mastery: "adept",
              state: "normal",
              visibility: "hidden",
              rumorText: "传闻晨裔能听见日出",
              bloodlineJustification: null,
              lockedFields: ["name"],
              version: 1,
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
            {
              id: "character-ability-old",
              timelineId: "timeline-old",
              entityId: "character-old",
              godId: null,
              sourceAbilityId: "race-ability-old",
              name: "晨光血脉",
              kind: "racial_innate",
              effect: "感知晨光",
              trigger: "黎明",
              cost: "无",
              limitations: "黑夜中沉寂",
              mastery: "expert",
              state: "enhanced",
              visibility: "known",
              rumorText: null,
              bloodlineJustification: "晨裔血脉",
              lockedFields: [],
              version: 2,
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
            {
              id: "god-ability-old",
              timelineId: "timeline-old",
              entityId: null,
              godId: "god-old",
              sourceAbilityId: null,
              name: "司掌晨曦",
              kind: "divine",
              effect: "唤来晨曦",
              trigger: "祈祷",
              cost: "神力",
              limitations: "仅限信仰所及",
              mastery: "novice",
              state: "normal",
              visibility: "known",
              rumorText: null,
              bloodlineJustification: null,
              lockedFields: [],
              version: 1,
              createdAt: "2026-07-20T00:00:00.000Z",
              updatedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          abilityEvents: [
            {
              id: "event-old",
              abilityId: "character-ability-old",
              chapterId: "chapter-old",
              messageId: "message-old",
              type: "improved",
              before: { mastery: "adept" },
              after: { mastery: "expert" },
              evidence: "她在晨光中觉醒。",
              scale: "scene",
              dedupeKey: "chapter-old:character-ability-old:improved:message-old",
              createdAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          memberships: [
            {
              id: "membership-old",
              characterId: "character-old",
              factionId: "faction-old",
              role: "守夜人",
              isPrimary: true,
            },
          ],
        },
      ],
    },
  };
}

function twoTimelineArchive() {
  const archive = versionTwoArchive();
  const other = JSON.parse(
    JSON.stringify(archive.world.timelines[0]).replaceAll("-old", "-other"),
  );
  other.worldId = "world-old";
  archive.world.timelines.push(other);
  return archive;
}

function installSuccessfulTransaction() {
  mocks.prisma.$transaction.mockImplementation(async (run) => run(mocks.prisma));
  for (const value of Object.values(mocks.prisma)) {
    if (typeof value === "object" && value && "createMany" in value) {
      value.createMany.mockResolvedValue({ count: 0 });
    }
  }
  mocks.prisma.world.create.mockResolvedValue({});
}

function lastCreateManyData(model: { createMany: ReturnType<typeof vi.fn> }) {
  return model.createMany.mock.calls.at(-1)?.[0].data as Array<Record<string, unknown>>;
}

describe("存档导入", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installSuccessfulTransaction();
  });

  it("接受 version 1 并将能力、事件和成员关系默认为空集合", async () => {
    const response = await importWorld(request(legacyArchive()));

    expect(response.status).toBe(200);
    expect(lastCreateManyData(mocks.prisma.ability)).toEqual([]);
    expect(lastCreateManyData(mocks.prisma.entityMembership)).toEqual([]);
    expect(lastCreateManyData(mocks.prisma.abilityEvent)).toEqual([]);
  });

  it("导入 version 2 时预生成新 ID 并重映射所有能力与关系外键", async () => {
    const response = await importWorld(request(versionTwoArchive()));

    expect(response.status).toBe(200);
    const { worldId } = await response.json();
    const timelines = lastCreateManyData(mocks.prisma.timeline);
    const chapters = lastCreateManyData(mocks.prisma.chapter);
    const messages = lastCreateManyData(mocks.prisma.message);
    const entities = lastCreateManyData(mocks.prisma.entity);
    const gods = lastCreateManyData(mocks.prisma.god);
    const abilities = lastCreateManyData(mocks.prisma.ability);
    const memberships = lastCreateManyData(mocks.prisma.entityMembership);
    const events = lastCreateManyData(mocks.prisma.abilityEvent);

    const timeline = timelines[0];
    const chapter = chapters[0];
    const message = messages[0];
    const race = entities.find((row) => row.name === "晨裔")!;
    const faction = entities.find((row) => row.name === "晨钟会")!;
    const character = entities.find((row) => row.name === "曦")!;
    const god = gods[0];
    const raceAbility = abilities.find((row) => row.name === "晨光血脉" && row.entityId === race.id)!;
    const characterAbility = abilities.find((row) => row.entityId === character.id)!;
    const godAbility = abilities.find((row) => row.godId === god.id)!;

    expect(worldId).not.toBe("world-old");
    expect(timeline).toMatchObject({ worldId, id: expect.not.stringMatching(/-old$/) });
    expect(chapter).toMatchObject({ timelineId: timeline.id, id: expect.not.stringMatching(/-old$/) });
    expect(message).toMatchObject({ chapterId: chapter.id, id: expect.not.stringMatching(/-old$/) });
    expect(character).toMatchObject({ raceId: race.id, id: expect.not.stringMatching(/-old$/) });
    expect(god).toMatchObject({ codexEntityId: character.id, id: expect.not.stringMatching(/-old$/) });
    expect(raceAbility).toMatchObject({ timelineId: timeline.id, entityId: race.id, visibility: "hidden" });
    expect(characterAbility).toMatchObject({ sourceAbilityId: raceAbility.id });
    expect(godAbility).toMatchObject({ timelineId: timeline.id, godId: god.id });
    expect(memberships[0]).toMatchObject({
      id: expect.not.stringMatching(/-old$/),
      characterId: character.id,
      factionId: faction.id,
    });
    expect(events[0]).toMatchObject({
      id: expect.not.stringMatching(/-old$/),
      abilityId: characterAbility.id,
      chapterId: chapter.id,
      messageId: message.id,
      dedupeKey: `${chapter.id}:${characterAbility.id}:improved:${message.id}`,
    });
    expect(events[0].dedupeKey).not.toBe(
      "chapter-old:character-ability-old:improved:message-old",
    );
  });

  it("canonical 事件键映射为新逻辑 ID，使恢复结算能命中已导入事件", async () => {
    await importWorld(request(versionTwoArchive()));
    const event = lastCreateManyData(mocks.prisma.abilityEvent)[0];

    const resumedPipelineKey = [
      event.chapterId,
      event.abilityId,
      event.type,
      event.messageId,
    ].join(":");
    expect(event.dedupeKey).toBe(resumedPipelineKey);
  });

  it("任意事件键使用当前导入世界和事件的新 ID 命名空间且跨导入不碰撞", async () => {
    const archive = versionTwoArchive();
    archive.world.timelines[0].abilityEvents[0].dedupeKey = "manual:legacy:key";

    const firstResponse = await importWorld(request(archive));
    const firstWorldId = (await firstResponse.json()).worldId;
    const first = lastCreateManyData(mocks.prisma.abilityEvent)[0];
    const secondResponse = await importWorld(request(archive));
    const secondWorldId = (await secondResponse.json()).worldId;
    const second = lastCreateManyData(mocks.prisma.abilityEvent)[0];

    expect(first.dedupeKey).toBe(`import:${firstWorldId}:${first.id}`);
    expect(second.dedupeKey).toBe(`import:${secondWorldId}:${second.id}`);
    expect(second.dedupeKey).not.toBe(first.dedupeKey);
  });

  it("同一存档导入两次时为事件生成互不碰撞的 ID 与 dedupeKey", async () => {
    await importWorld(request(versionTwoArchive()));
    const first = lastCreateManyData(mocks.prisma.abilityEvent)[0];
    await importWorld(request(versionTwoArchive()));
    const second = lastCreateManyData(mocks.prisma.abilityEvent)[0];

    expect(second.id).not.toBe(first.id);
    expect(second.dedupeKey).not.toBe(first.dedupeKey);
  });

  it("拒绝重复旧 ID，避免映射碰撞", async () => {
    const archive = versionTwoArchive();
    archive.world.timelines[0].abilities.push({
      ...archive.world.timelines[0].abilities[0],
      name: "碰撞能力",
    });

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("重复") });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("任一有序写入失败时由单个事务回滚全部改动", async () => {
    const committedWorlds: unknown[] = [];
    let transactionBodyRan = false;
    let eventWriteAttempted = false;
    mocks.prisma.$transaction.mockImplementation(async (run) => {
      transactionBodyRan = true;
      const pendingWorlds: unknown[] = [];
      const tx = {
        ...mocks.prisma,
        world: {
          ...mocks.prisma.world,
          create: vi.fn(async ({ data }) => {
            pendingWorlds.push(data);
            return data;
          }),
        },
        abilityEvent: {
          ...mocks.prisma.abilityEvent,
          createMany: vi.fn(async () => {
            eventWriteAttempted = true;
            throw new Error("event write failed");
          }),
        },
      };
      const result = await run(tx);
      committedWorlds.push(...pendingWorlds);
      return result;
    });

    const response = await importWorld(request(versionTwoArchive()));

    expect(response.status).toBe(400);
    expect(transactionBodyRan).toBe(true);
    expect(eventWriteAttempted).toBe(true);
    expect(committedWorlds).toEqual([]);
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 10_000, timeout: 60_000 },
    );
  });

  it("Content-Length 超过 10MB 时在读取 JSON 前返回 413", async () => {
    const response = await importWorld(
      requestWithHeaders("{}", { "Content-Length": String(10 * 1024 * 1024 + 1) }),
    );

    expect(response.status).toBe(413);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("没有 Content-Length 的流式请求超过 10MB 时返回 413", async () => {
    const response = await importWorld(
      requestWithHeaders("x".repeat(10 * 1024 * 1024 + 1), {}),
    );

    expect(response.status).toBe(413);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("限制集合、字符串以及 unknown JSON 字段的大小和深度", async () => {
    const tooMany = versionTwoArchive();
    (tooMany.world.timelines[0].entities[0] as { aliases: string[] }).aliases =
      Array.from({ length: 1001 }, (_, index) => `alias-${index}`);
    const longString = versionTwoArchive();
    longString.world.name = "界".repeat(1025);
    const deepJson = versionTwoArchive();
    let nested: Record<string, unknown> = {};
    (deepJson.world as { draftDeck: unknown }).draftDeck = nested;
    for (let depth = 0; depth < 33; depth += 1) {
      nested.next = {};
      nested = nested.next as Record<string, unknown>;
    }
    const largeJson = versionTwoArchive();
    (largeJson.world.timelines[0].chapters[0].messages[0] as { meta: unknown }).meta = {
      text: "x".repeat(1024 * 1024 + 1),
    };

    for (const archive of [tooMany, longString, deepJson, largeJson]) {
      const response = await importWorld(request(archive));
      expect(response.status).toBe(400);
    }
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("拒绝空的可选 ID", async () => {
    const archive = versionTwoArchive();
    archive.world.timelines[0].entities[2].raceId = "";

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["由非人物实体携带", (archive: ReturnType<typeof versionTwoArchive>) => {
      archive.world.timelines[0].entities[1].raceId = "race-old";
    }],
    ["指向非种族目标", (archive: ReturnType<typeof versionTwoArchive>) => {
      archive.world.timelines[0].entities[2].raceId = "faction-old";
    }],
  ])("拒绝 raceId %s", async (_label, mutate) => {
    const archive = versionTwoArchive();
    mutate(archive);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("大型引用图校验不在集合循环中使用 Array.find", async () => {
    const archive = versionTwoArchive();
    const timeline = archive.world.timelines[0];
    const templateCharacter = timeline.entities[2];
    const templateMembership = timeline.memberships[0];
    for (let index = 0; index < 2_000; index += 1) {
      const characterId = `bulk-character-${index}`;
      timeline.entities.push({
        ...templateCharacter,
        id: characterId,
        name: `人物${index}`,
        emblemSeed: characterId,
        sections: [],
      });
      timeline.memberships.push({
        ...templateMembership,
        id: `bulk-membership-${index}`,
        characterId,
      });
    }
    const originalFind = Array.prototype.find;
    let findCalls = 0;
    const findSpy = vi.spyOn(Array.prototype, "find").mockImplementation(function (
      this: unknown[],
      ...args: Parameters<typeof originalFind>
    ) {
      findCalls += 1;
      return originalFind.apply(this, args);
    });

    try {
      const response = await importWorld(request(archive));
      expect(response.status).toBe(200);
      expect(findCalls).toBe(0);
    } finally {
      findSpy.mockRestore();
    }
  });

  it.each([
    ["时间线", (archive: ReturnType<typeof versionTwoArchive>) => {
      archive.world.timelines[0].worldId = "another-world";
    }],
    ["世界书", (archive: ReturnType<typeof versionTwoArchive>) => {
      (archive.world as { lorebookEntries: Array<Record<string, unknown>> }).lorebookEntries.push({
        id: "lore-old",
        worldId: "another-world",
        keys: [],
        content: "异界条目",
        enabled: true,
        source: "imported",
      });
    }],
  ])("拒绝%s声明跨世界归属", async (_label, mutate) => {
    const archive = versionTwoArchive();
    mutate(archive);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["章节", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].chapters[0].timelineId = "timeline-other"; }],
    ["消息", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].chapters[0].messages[0].chapterId = "chapter-other"; }],
    ["实体声明", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].entities[0].timelineId = "timeline-other"; }],
    ["人物种族", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].entities[2].raceId = "race-other"; }],
    ["神明声明", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].gods[0].timelineId = "timeline-other"; }],
    ["神明百科", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].gods[0].codexEntityId = "character-other"; }],
    ["神明关系", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].gods[0].relations = { "god-other": { label: "敌对" } }; }],
    ["能力声明", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].abilities[0].timelineId = "timeline-other"; }],
    ["能力拥有者", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].abilities[1].entityId = "character-other"; }],
    ["来源能力", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].abilities[1].sourceAbilityId = "race-ability-other"; }],
    ["成员人物", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].memberships[0].characterId = "character-other"; }],
    ["成员势力", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].memberships[0].factionId = "faction-other"; }],
    ["事件能力", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].abilityEvents[0].abilityId = "character-ability-other"; }],
    ["事件章节", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].abilityEvents[0].chapterId = "chapter-other"; }],
    ["事件消息", (archive: ReturnType<typeof twoTimelineArchive>) => { archive.world.timelines[0].abilityEvents[0].messageId = "message-other"; }],
  ])("拒绝跨时间线的%s引用", async (_label, mutate) => {
    const archive = twoTimelineArchive();
    mutate(archive);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["无拥有者", (archive: ReturnType<typeof versionTwoArchive>) => {
      archive.world.timelines[0].abilities[2].godId = null;
    }],
    ["双拥有者", (archive: ReturnType<typeof versionTwoArchive>) => {
      archive.world.timelines[0].abilities[2].entityId = "character-old";
    }],
    ["实体拥有 divine", (archive: ReturnType<typeof versionTwoArchive>) => {
      archive.world.timelines[0].abilities[2].godId = null;
      archive.world.timelines[0].abilities[2].entityId = "character-old";
    }],
    ["personal 携带来源", (archive: ReturnType<typeof versionTwoArchive>) => {
      const ability = archive.world.timelines[0].abilities[1];
      ability.kind = "personal";
    }],
  ])("拒绝违反能力所有权不变量：%s", async (_label, mutate) => {
    const archive = versionTwoArchive();
    mutate(archive);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("严格拒绝未知字段与不支持的版本", async () => {
    const archive = versionTwoArchive() as ReturnType<typeof versionTwoArchive> & {
      unexpected?: boolean;
    };
    archive.unexpected = true;

    const malformed = await importWorld(request(archive));
    const unsupported = await importWorld(request({ ...legacyArchive(), version: 3 }));

    expect(malformed.status).toBe(400);
    expect(unsupported.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("存档导出", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("导出 version 2 的完整私有数据并查询时间线能力事件、成员关系与种族", async () => {
    const hiddenAbility = {
      id: "hidden-ability",
      visibility: "hidden",
      events: [{ id: "hidden-event", abilityId: "hidden-ability" }],
    };
    mocks.prisma.world.findUnique.mockResolvedValue({
      id: "world-1",
      name: "私有世界",
      timelines: [
        {
          id: "timeline-1",
          abilities: [hiddenAbility],
          entities: [
            {
              id: "character-1",
              raceId: "race-1",
              race: { id: "race-1" },
              memberships: [
                {
                  id: "membership-1",
                  characterId: "character-1",
                  factionId: "faction-1",
                },
              ],
            },
          ],
        },
      ],
    });

    const response = await exportWorld(new Request("http://localhost"), {
      params: Promise.resolve({ id: "world-1" }),
    });
    const payload = await response.json();

    expect(payload.version).toBe(2);
    expect(payload.world.timelines[0]).toMatchObject({
      abilities: [{ id: "hidden-ability", visibility: "hidden" }],
      abilityEvents: [{ id: "hidden-event", abilityId: "hidden-ability" }],
      memberships: [
        { id: "membership-1", characterId: "character-1", factionId: "faction-1" },
      ],
      entities: [{ id: "character-1", raceId: "race-1" }],
    });
    expect(mocks.prisma.world.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          timelines: expect.objectContaining({
            include: expect.objectContaining({
              abilities: expect.objectContaining({ include: { events: true } }),
              entities: expect.objectContaining({
                include: expect.objectContaining({ race: true, memberships: true }),
              }),
            }),
          }),
        }),
      }),
    );
  });
});
