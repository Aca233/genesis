import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck } from "@/lib/abilities/embark.test-fixtures";
import { initialObserverState, initialRealityState } from "@/lib/reality/schemas";

const mocks = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  });
  return {
    prisma: {
      world: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
      realityRewrite: model(),
      worldEvent: model(),
      worldActivity: model(),
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


function versionThreeArchive() {
  const deck = completeCreatorDeck();
  const reality = initialRealityState(deck);
  const observer = initialObserverState(deck);
  const root = {
    id: "timeline-root",
    worldId: "world-v3",
    parentId: null,
    forkChapter: null,
    branchName: "原初现实",
    branchSummary: "创世之初",
    realityState: reality,
    observerState: observer,
    forkRewriteId: null,
    chapters: [{
      id: "chapter-root",
      timelineId: "timeline-root",
      index: 0,
      title: "原初",
      summary: null,
      settleState: "settled",
      snapshot: { gods: { "god-root": { id: "god-root" } } },
      messages: [{
        id: "message-root",
        chapterId: "chapter-root",
        index: 0,
        role: "narrator",
        content: "根源见证者记录了世界。",
        scale: "scene",
        variants: null,
        meta: null,
      }],
    }],
    gods: [{
      id: "god-root",
      timelineId: "timeline-root",
      name: "根源神",
      aliases: [],
      tier: "major",
      isPlayer: false,
      rank: "nascent",
      domains: ["根源"],
      persona: { public: true },
      voice: null,
      agenda: { secret: "隐藏议程" },
      agendaRevealed: false,
      relations: {},
      faithScope: null,
      codexEntityId: null,
    }],
    entities: [{
      id: "entity-root",
      timelineId: "timeline-root",
      type: "character",
      name: "根源见证者",
      aliases: [],
      emblemSeed: "root-witness",
      imageUrl: null,
      starred: false,
      isChosen: false,
      isMajorCharacter: true,
      isCreatorAvatar: false,
      raceId: null,
      heat: "active",
      scenePresence: true,
      summary: "记录根源现实",
      lockedPaths: [],
      materialRef: null,
      sections: [{
        id: "section-root-links",
        entityId: "entity-root",
        key: "graph-links",
        content: {
          "god-root": {
            entityId: "entity-root",
            abilityId: "ability-root",
            chapterId: "chapter-root",
            messageId: "message-root",
            nested: { "entity-root": ["god-root", null, "message-root"] },
          },
        },
        revealed: true,
        rumorText: null,
        playerLocked: false,
      }],
    }],
    abilities: [{
      id: "ability-root",
      timelineId: "timeline-root",
      entityId: null,
      godId: "god-root",
      sourceAbilityId: null,
      name: "根源凝视",
      kind: "divine",
      effect: "见证现实",
      trigger: "世界变化",
      cost: "无",
      limitations: "仅记录",
      mastery: "master",
      state: "normal",
      visibility: "known",
      rumorText: null,
      bloodlineJustification: null,
      lockedFields: [],
      version: 1,
    }],
    abilityEvents: [],
    memberships: [],
    chronicles: [],
    omens: [],
  };
  const child = (suffix: "a" | "b", rewriteId: string) => ({
    ...structuredClone(root),
    id: `timeline-${suffix}`,
    parentId: "timeline-root",
    forkChapter: 0,
    branchName: suffix === "a" ? "星海长明" : "群星沉眠",
    branchSummary: suffix === "a" ? "第一条现实" : "第二条现实",
    forkRewriteId: rewriteId,
    chapters: [],
    gods: [],
    abilities: [],
    realityState: {
      ...structuredClone(reality),
      establishedFacts: [{
        ref: `fact-${suffix}`,
        text: suffix === "a" ? "群星永不熄灭" : "群星进入沉眠",
        establishedByRewriteId: rewriteId,
      }],
    },
    observerState: suffix === "b"
      ? { ...observer, focusType: "avatar", focusId: "avatar-b", activeAvatarId: "avatar-b" }
      : observer,
    entities: suffix === "b" ? [{
      id: "avatar-b",
      timelineId: "timeline-b",
      type: "character",
      name: "天外化身",
      aliases: [],
      emblemSeed: "avatar",
      imageUrl: null,
      starred: true,
      isChosen: false,
      isMajorCharacter: true,
      isCreatorAvatar: true,
      raceId: null,
      heat: "active",
      scenePresence: true,
      summary: "创世主行于世间的化身",
      lockedPaths: [],
      materialRef: null,
      sections: [{
        id: "section-avatar-b",
        entityId: "avatar-b",
        key: "identity",
        content: { hiddenTruth: "来自世界之外" },
        revealed: false,
        rumorText: "身份不明",
        playerLocked: false,
      }],
    }] : [],
  });
  return {
    version: 3,
    exportedAt: "2026-07-22T00:00:00.000Z",
    world: {
      id: "world-v3",
      userId: "local",
      name: "创世主存档",
      genesisInput: "让世界自行运转",
      mode: "creator",
      status: "playing",
      draftDeck: deck,
      lockedPaths: [],
      themeCard: deck.theme,
      styleCard: deck.style,
      cosmology: deck.cosmology,
      fusionAxiom: deck.fusionAxiom,
      activeTimelineId: "timeline-b",
      materialArchiveStatus: "completed",
      timelines: [root, child("a", "rewrite-a"), child("b", "rewrite-b")],
      rewrites: [
        {
          id: "rewrite-a",
          worldId: "world-v3",
          sourceTimelineId: "timeline-root",
          resultTimelineId: "timeline-a",
          sourceChapterId: "chapter-root",
          decree: "令群星长明",
          scope: "prospective",
          status: "completed",
          plan: { targetId: "god-root" },
          summary: "群星永不熄灭",
        },
        {
          id: "rewrite-b",
          worldId: "world-v3",
          sourceTimelineId: "timeline-root",
          resultTimelineId: "timeline-b",
          sourceChapterId: "chapter-root",
          decree: "令群星沉眠",
          scope: "retroactive",
          status: "completed",
          plan: { focusId: "avatar-b" },
          summary: "群星已沉眠",
        },
      ],
      lorebookEntries: [],
    },
  };
}

function versionFourArchive() {
  const archive = versionThreeArchive() as ReturnType<typeof versionThreeArchive> & {
    version: 4;
  };
  archive.version = 4;
  const root = archive.world.timelines[0] as typeof archive.world.timelines[0] & {
    worldEvents: Array<Record<string, unknown>>;
    worldActivities: Array<Record<string, unknown>>;
  };
  root.observerState = {
    ...root.observerState,
    focusedEventId: "world-event-child",
  };
  root.worldEvents = [{
    id: "world-event-parent",
    timelineId: "timeline-root",
    kind: "conspiracy",
    title: "无声议会",
    summary: "密议初现。",
    phase: "developing",
    visibility: "hidden",
    participantIds: ["god-root", "entity-root"],
    originMessageId: "message-root",
    originActivityId: "world-activity-origin",
    latestMessageId: "message-root",
    parentEventId: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    resolvedAt: null,
  }, {
    id: "world-event-child",
    timelineId: "timeline-root",
    kind: "faction_shift",
    title: "黑蜡盟约",
    summary: "盟约正在扩张。",
    phase: "escalating",
    visibility: "player_known",
    participantIds: ["entity-root"],
    originMessageId: "message-root",
    originActivityId: "world-activity-progress",
    latestMessageId: "message-root",
    parentEventId: "world-event-parent",
    createdAt: "2026-07-22T00:01:00.000Z",
    updatedAt: "2026-07-22T00:02:00.000Z",
    resolvedAt: null,
  }];
  root.worldActivities = [{
    id: "world-activity-origin",
    timelineId: "timeline-root",
    eventId: "world-event-parent",
    recordType: "activity",
    kind: "meeting",
    text: "议会在暗处召开。",
    visibility: "hidden",
    actorId: "god-root",
    targetIds: ["entity-root"],
    subjectIds: ["god-root", "entity-root"],
    sourceMessageId: "message-root",
    eraLabel: "初始纪元",
    timeLabel: "第一日",
    createdAt: "2026-07-22T00:00:00.000Z",
  }, {
    id: "world-activity-progress",
    timelineId: "timeline-root",
    eventId: "world-event-child",
    recordType: "event_progress",
    kind: "faction_shift",
    text: "黑蜡盟约扩张。",
    visibility: "player_known",
    actorId: null,
    targetIds: [],
    subjectIds: ["entity-root"],
    sourceMessageId: "message-root",
    eraLabel: "初始纪元",
    timeLabel: "第二日",
    createdAt: "2026-07-22T00:02:00.000Z",
  }];
  for (const timeline of archive.world.timelines.slice(1)) {
    Object.assign(timeline, { worldEvents: [], worldActivities: [] });
  }
  return archive;
}

function installSuccessfulTransaction() {
  mocks.prisma.$transaction.mockImplementation(async (run) => run(mocks.prisma));
  for (const value of Object.values(mocks.prisma)) {
    if (typeof value === "object" && value && "createMany" in value) {
      value.createMany.mockResolvedValue({ count: 0 });
    }
  }
  for (const value of Object.values(mocks.prisma)) {
    if (typeof value === "object" && value && "update" in value) {
      value.update.mockResolvedValue({});
      if ("updateMany" in value) value.updateMany.mockResolvedValue({ count: 1 });
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
    expect(mocks.prisma.world.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "pantheon" }),
    }));
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

  it("version 2 导入兼容为 pantheon mode", async () => {
    const archive = versionTwoArchive();
    (archive.world as typeof archive.world & { mode: "creator" }).mode = "creator";
    (archive.world as unknown as { activeTimelineId: string | null }).activeTimelineId = null;
    archive.world.timelines = [];

    const response = await importWorld(request(archive));

    expect(response.status).toBe(200);
    expect(mocks.prisma.world.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "pantheon" }),
    }));
  });

  it("version 2 自动补空世界动态图和 focusedEventId", async () => {
    const response = await importWorld(request(versionTwoArchive()));

    expect(response.status).toBe(200);
    expect(lastCreateManyData(mocks.prisma.worldEvent)).toEqual([]);
    expect(lastCreateManyData(mocks.prisma.worldActivity)).toEqual([]);
    expect(lastCreateManyData(mocks.prisma.timeline)[0].observerState).toMatchObject({
      focusedEventId: null,
    });
  });

  it("保留 embark 的 relations.player 并重映射真实神明 ID 关系键", async () => {
    const archive = versionTwoArchive();
    archive.world.timelines[0].gods.push({
      ...archive.world.timelines[0].gods[0],
      id: "major-god-old",
      name: "潮汐之神",
      tier: "major",
      isPlayer: false,
      codexEntityId: null,
      relations: {
        player: { label: "rival", note: "领域相邻" },
        "god-old": { label: "ally", note: "暂时结盟" },
      },
    } as unknown as (typeof archive.world.timelines)[number]["gods"][number]);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(200);
    const gods = lastCreateManyData(mocks.prisma.god);
    const playerGod = gods.find((god) => god.isPlayer === true)!;
    const majorGod = gods.find((god) => god.name === "潮汐之神")!;
    expect(majorGod.relations).toEqual({
      player: { label: "rival", note: "领域相邻" },
      [playerGod.id as string]: { label: "ally", note: "暂时结盟" },
    });
  });

  it("拒绝除 player 和真实神明 ID 之外的关系键", async () => {
    const archive = versionTwoArchive();
    archive.world.timelines[0].gods[0].relations = {
      "不存在的神": { label: "enemy", note: "非法目标" },
    };

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
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

  it("拒绝时间线与神明复用同一个旧存档 ID", async () => {
    const archive = versionThreeArchive();
    archive.world.timelines[0].gods[0].id = archive.world.timelines[0].id;

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("重复的存档 ID：timeline-root"),
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.world.create).not.toHaveBeenCalled();
  });

  it("拒绝章节与消息复用同一个旧存档 ID", async () => {
    const archive = versionThreeArchive();
    const chapter = archive.world.timelines[0].chapters[0];
    (chapter.messages as unknown as Array<Record<string, unknown>>).push({
      id: chapter.id,
      chapterId: chapter.id,
      index: 0,
      role: "narrator",
      content: "重复标识不应进入写事务。",
      scale: "scene",
      variants: null,
      meta: null,
      createdAt: "2026-07-22T00:00:00.000Z",
    });

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("重复的存档 ID：chapter-root"),
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.world.create).not.toHaveBeenCalled();
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


  it("导入 version 3 时重映射现实树、改写、观察焦点、化身和活动分支", async () => {
    const response = await importWorld(request(versionThreeArchive()));

    expect(response.status).toBe(200);
    const { worldId } = await response.json();
    const timelines = lastCreateManyData(mocks.prisma.timeline);
    const rewrites = lastCreateManyData(mocks.prisma.realityRewrite);
    const root = timelines.find((timeline) => timeline.branchName === "原初现实")!;
    const branchA = timelines.find((timeline) => timeline.branchName === "星海长明")!;
    const branchB = timelines.find((timeline) => timeline.branchName === "群星沉眠")!;
    const avatar = lastCreateManyData(mocks.prisma.entity).find(
      (entity) => entity.isCreatorAvatar === true,
    )!;
    const rootWitness = lastCreateManyData(mocks.prisma.entity).find(
      (entity) => entity.name === "根源见证者",
    )!;
    const rootGod = lastCreateManyData(mocks.prisma.god).find((god) => god.name === "根源神")!;
    const rootAbility = lastCreateManyData(mocks.prisma.ability).find(
      (ability) => ability.name === "根源凝视",
    )!;
    const rootChapter = lastCreateManyData(mocks.prisma.chapter).find(
      (chapter) => chapter.timelineId === root.id,
    )!;
    const rootMessage = lastCreateManyData(mocks.prisma.message).find(
      (message) => message.chapterId === rootChapter.id,
    )!;
    const rootLinks = lastCreateManyData(mocks.prisma.entitySection).find(
      (section) => section.key === "graph-links",
    )!;
    const rewriteA = rewrites.find((rewrite) => rewrite.decree === "令群星长明")!;
    const rewriteB = rewrites.find((rewrite) => rewrite.decree === "令群星沉眠")!;
    expect(typeof rootGod.id).toBe("string");
    expect(typeof rootWitness.id).toBe("string");
    const rootGodId = String(rootGod.id);
    const rootWitnessId = String(rootWitness.id);

    expect(worldId).not.toBe("world-v3");
    expect(root).toMatchObject({ worldId, parentId: null, forkRewriteId: null });
    expect(branchA).toMatchObject({ worldId, parentId: root.id });
    expect(branchB).toMatchObject({ worldId, parentId: root.id });
    expect(mocks.prisma.timeline.update).toHaveBeenCalledWith({
      where: { id: branchA.id },
      data: { forkRewriteId: rewriteA.id },
    });
    expect(mocks.prisma.timeline.update).toHaveBeenCalledWith({
      where: { id: branchB.id },
      data: { forkRewriteId: rewriteB.id },
    });
    expect(rewriteA).toMatchObject({
      worldId,
      sourceTimelineId: root.id,
      resultTimelineId: branchA.id,
      sourceChapterId: expect.not.stringContaining("chapter-root"),
      leaseToken: null,
      leaseExpiresAt: null,
      error: null,
    });
    expect(rewriteB).toMatchObject({ sourceTimelineId: root.id, resultTimelineId: branchB.id });
    expect(branchB.observerState).toMatchObject({
      focusType: "avatar",
      focusId: avatar.id,
      activeAvatarId: avatar.id,
    });
    expect(branchB.realityState).toMatchObject({
      establishedFacts: [expect.objectContaining({ establishedByRewriteId: rewriteB.id })],
    });
    expect(rootLinks).toMatchObject({
      entityId: rootWitnessId,
      content: {
        [rootGodId]: {
          entityId: rootWitnessId,
          abilityId: rootAbility.id,
          chapterId: rootChapter.id,
          messageId: rootMessage.id,
          nested: { [rootWitnessId]: [rootGodId, null, rootMessage.id] },
        },
      },
    });
    expect(JSON.stringify(rootLinks.content)).not.toMatch(
      /god-root|entity-root|ability-root|chapter-root|message-root/,
    );
    expect(mocks.prisma.world.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "creator", activeTimelineId: null }),
    }));
    expect(mocks.prisma.world.update).toHaveBeenCalledWith({
      where: { id: worldId },
      data: { activeTimelineId: branchB.id },
    });
  });

  it("version 3 自动补空世界动态图和 focusedEventId", async () => {
    const archive = versionThreeArchive();
    for (const timeline of archive.world.timelines) {
      delete (timeline.observerState as Record<string, unknown>).focusedEventId;
    }

    const response = await importWorld(request(archive));

    expect(response.status).toBe(200);
    expect(lastCreateManyData(mocks.prisma.worldEvent)).toEqual([]);
    expect(lastCreateManyData(mocks.prisma.worldActivity)).toEqual([]);
    for (const timeline of lastCreateManyData(mocks.prisma.timeline)) {
      expect(timeline.observerState).toMatchObject({ focusedEventId: null });
    }
  });

  it("version 4 为事件链、动态和全部内部引用生成新 ID", async () => {
    const response = await importWorld(request(versionFourArchive()));

    expect(response.status).toBe(200);
    const timeline = lastCreateManyData(mocks.prisma.timeline).find(
      (row) => row.branchName === "原初现实",
    )!;
    const messages = lastCreateManyData(mocks.prisma.message);
    const message = messages.find((row) => row.chapterId !== undefined)!;
    const god = lastCreateManyData(mocks.prisma.god).find((row) => row.name === "根源神")!;
    const entity = lastCreateManyData(mocks.prisma.entity).find(
      (row) => row.name === "根源见证者",
    )!;
    const events = lastCreateManyData(mocks.prisma.worldEvent);
    const activities = lastCreateManyData(mocks.prisma.worldActivity);
    const parent = events.find((row) => row.title === "无声议会")!;
    const child = events.find((row) => row.title === "黑蜡盟约")!;
    const origin = activities.find((row) => row.text === "议会在暗处召开。")!;
    const progress = activities.find((row) => row.text === "黑蜡盟约扩张。")!;

    expect(parent).toMatchObject({
      timelineId: timeline.id,
      participantIds: [god.id, entity.id],
      originMessageId: message.id,
      latestMessageId: message.id,
      parentEventId: null,
      visibility: "hidden",
    });
    expect(child).toMatchObject({
      timelineId: timeline.id,
      participantIds: [entity.id],
    });
    expect(mocks.prisma.worldEvent.update).toHaveBeenCalledWith({
      where: { id: parent.id },
      data: { parentEventId: null, originActivityId: origin.id },
    });
    expect(mocks.prisma.worldEvent.update).toHaveBeenCalledWith({
      where: { id: child.id },
      data: { parentEventId: parent.id, originActivityId: progress.id },
    });
    expect(origin).toMatchObject({
      timelineId: timeline.id,
      eventId: parent.id,
      actorId: god.id,
      targetIds: [entity.id],
      subjectIds: [god.id, entity.id],
      sourceMessageId: message.id,
      visibility: "hidden",
    });
    expect(progress).toMatchObject({
      timelineId: timeline.id,
      eventId: child.id,
      subjectIds: [entity.id],
      sourceMessageId: message.id,
    });
    expect(timeline.observerState).toMatchObject({ focusedEventId: child.id });
    expect(JSON.stringify({ timeline, events, activities })).not.toMatch(
      /world-event-(?:parent|child)|world-activity-(?:origin|progress)/,
    );
  });

  it.each([
    ["参与者", (archive: ReturnType<typeof versionFourArchive>) => {
      (archive.world.timelines[0] as unknown as {
        worldEvents: Array<Record<string, unknown>>;
      }).worldEvents[0].participantIds = ["avatar-b"];
    }],
    ["父事件", (archive: ReturnType<typeof versionFourArchive>) => {
      (archive.world.timelines[0] as unknown as {
        worldEvents: Array<Record<string, unknown>>;
      }).worldEvents[1].parentEventId = "missing-event";
    }],
    ["循环父事件", (archive: ReturnType<typeof versionFourArchive>) => {
      const events = (archive.world.timelines[0] as unknown as {
        worldEvents: Array<Record<string, unknown>>;
      }).worldEvents;
      events[0].parentEventId = "world-event-child";
    }],
    ["事件动态", (archive: ReturnType<typeof versionFourArchive>) => {
      (archive.world.timelines[0] as unknown as {
        worldActivities: Array<Record<string, unknown>>;
      }).worldActivities[0].eventId = "missing-event";
    }],
    ["来源消息", (archive: ReturnType<typeof versionFourArchive>) => {
      (archive.world.timelines[0] as unknown as {
        worldActivities: Array<Record<string, unknown>>;
      }).worldActivities[0].sourceMessageId = "missing-message";
    }],
  ])("version 4 拒绝跨现实或悬空的%s引用", async (_label, mutate) => {
    const archive = versionFourArchive();
    mutate(archive);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["cycle", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.timelines[0].parentId = "timeline-a";
    }],
    ["cross-world parent", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.timelines[1].worldId = "another-world";
    }],
    ["missing active", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.activeTimelineId = "timeline-missing";
    }],
    ["mismatched rewrite", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.rewrites[0].resultTimelineId = "timeline-b";
    }],
    ["creator player god", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.timelines[0].gods[0].isPlayer = true;
      archive.world.timelines[0].gods[0].tier = "player";
    }],
  ])("version 3 图校验拒绝 %s", async (_label, mutate) => {
    const archive = versionThreeArchive();
    mutate(archive);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });


  it.each([
    ["missing source chapter", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.rewrites[0].sourceChapterId = "chapter-missing";
    }],
    ["cross-reality source chapter", (archive: ReturnType<typeof versionThreeArchive>) => {
      (archive.world.timelines[1].chapters as Array<Record<string, unknown>>).push({
        id: "chapter-a",
        timelineId: "timeline-a",
        index: 0,
        title: null,
        summary: null,
        settleState: "settled",
        snapshot: null,
        messages: [],
      });
      archive.world.rewrites[0].sourceChapterId = "chapter-a";
    }],
    ["dangling established-fact rewrite", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.timelines[1].realityState.establishedFacts[0]!
        .establishedByRewriteId = "rewrite-missing";
    }],
    ["cross-reality observer avatar", (archive: ReturnType<typeof versionThreeArchive>) => {
      archive.world.timelines[1].observerState = {
        focusType: "avatar",
        focusId: "avatar-b",
        timeLabel: "分叉纪元",
        viewpoint: "omniscient",
        activeAvatarId: "avatar-b",
      };
    }],
  ])("version 3 语义引用校验拒绝 %s", async (_label, mutate) => {
    const archive = versionThreeArchive();
    mutate(archive);

    const response = await importWorld(request(archive));

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("旧 version 2 即使携带 creator 字段也按 pantheon 兼容导入", async () => {
    const archive = versionTwoArchive();
    (archive.world as typeof archive.world & { mode: string }).mode = "creator";

    const response = await importWorld(request(archive));

    expect(response.status).toBe(200);
    expect(mocks.prisma.world.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "pantheon" }),
    }));
  });

  it("严格拒绝未知字段与不支持的版本", async () => {
    const archive = versionTwoArchive() as ReturnType<typeof versionTwoArchive> & {
      unexpected?: boolean;
    };
    archive.unexpected = true;

    const malformed = await importWorld(request(archive));
    const unsupported = await importWorld(request({ ...legacyArchive(), version: 5 }));

    expect(malformed.status).toBe(400);
    expect(unsupported.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("存档导出", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("导出 version 4 的完整私有数据、现实树与改写，但排除租约和 provider error", async () => {
    const hiddenAbility = {
      id: "hidden-ability",
      visibility: "hidden",
      events: [{ id: "hidden-event", abilityId: "hidden-ability" }],
    };
    mocks.prisma.world.findUnique.mockResolvedValue({
      id: "world-1",
      userId: "local",
      mode: "creator",
      name: "私有世界",
      genesisInput: "创造私有世界",
      status: "playing",
      operationKind: "rewrite",
      operationToken: "secret-operation-token",
      operationLeaseExpiresAt: new Date("2026-07-22T00:00:00Z"),
      materialArchiveError: "provider leaked details",
      activeTimelineId: "timeline-1",
      rewrites: [{
        id: "rewrite-1",
        worldId: "world-1",
        sourceTimelineId: "timeline-1",
        resultTimelineId: null,
        sourceChapterId: "chapter-1",
        decree: "改写",
        scope: "prospective",
        status: "failed",
        plan: null,
        summary: null,
        idempotencyKey: "private-idempotency-key",
        leaseToken: "private-rewrite-token",
        leaseExpiresAt: new Date("2026-07-22T00:00:00Z"),
        error: "provider raw response",
        createdAt: new Date("2026-07-22T00:00:00Z"),
        updatedAt: new Date("2026-07-22T00:00:00Z"),
      }],
      timelines: [
        {
          id: "timeline-1",
          worldId: "world-1",
          parentId: null,
          forkChapter: null,
          branchName: "原初现实",
          branchSummary: "根现实",
          realityState: { hiddenFact: "天外真相" },
          observerState: { viewpoint: "omniscient" },
          forkRewriteId: null,
          abilities: [hiddenAbility],
          entities: [
            {
              id: "character-1",
              isCreatorAvatar: true,
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

    expect(payload.version).toBe(4);
    expect(payload.world.mode).toBe("creator");
    expect(JSON.stringify(payload)).not.toContain("secret-operation-token");
    expect(payload.world).not.toHaveProperty("operationKind");
    expect(payload.world).not.toHaveProperty("operationToken");
    expect(payload.world).not.toHaveProperty("operationLeaseExpiresAt");
    expect(payload.world).not.toHaveProperty("materialArchiveError");
    expect(JSON.stringify(payload)).not.toContain("provider leaked details");
    expect(JSON.stringify(payload)).not.toContain("private-rewrite-token");
    expect(JSON.stringify(payload)).not.toContain("private-idempotency-key");
    expect(JSON.stringify(payload)).not.toContain("provider raw response");
    expect(payload.world.rewrites).toEqual([
      expect.objectContaining({
        id: "rewrite-1",
        sourceTimelineId: "timeline-1",
        status: "failed",
      }),
    ]);
    expect(payload.world.rewrites[0]).not.toHaveProperty("error");
    expect(payload.world.rewrites[0]).not.toHaveProperty("leaseToken");
    expect(payload.world.rewrites[0]).not.toHaveProperty("idempotencyKey");
    expect(payload.world.timelines[0]).toMatchObject({
      branchName: "原初现实",
      realityState: { hiddenFact: "天外真相" },
      observerState: { viewpoint: "omniscient" },
      abilities: [{ id: "hidden-ability", visibility: "hidden" }],
      abilityEvents: [{ id: "hidden-event", abilityId: "hidden-ability" }],
      memberships: [
        { id: "membership-1", characterId: "character-1", factionId: "faction-1" },
      ],
      entities: [{ id: "character-1", isCreatorAvatar: true, raceId: "race-1" }],
    });
    expect(mocks.prisma.world.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          rewrites: expect.anything(),
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
