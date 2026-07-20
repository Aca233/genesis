import { afterAll, describe, expect, it, vi } from "vitest";

const responses = vi.hoisted(() => ({
  extract: {} as Record<string, unknown>,
  extractHandler: undefined as undefined | ((user: string) => Record<string, unknown>),
}));
vi.mock("@/lib/llm/structured", () => ({
  completeStructured: vi.fn(async (_slot: string, request: { task: string; user: string }) => {
    if (request.task === "extract") return responses.extractHandler?.(request.user) ?? responses.extract;
    if (request.task === "chronicle") {
      return { entries: [{ yearLabel: "元年", text: "阿岚习得踏岩步。", entityNames: ["阿岚"], godNames: [] }], epilogue: "传承已续。", chapterTitle: "石阶传承" };
    }
    throw new Error(`unexpected ${request.task}`);
  }),
}));

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
const { prisma } = await import("@/lib/db");
const { settleChapter } = await import("./pipeline");

async function fixture() {
  const world = await prisma.world.create({ data: { name: `settle-${crypto.randomUUID()}`, genesisInput: "test", lockedPaths: [] } });
  const timeline = await prisma.timeline.create({ data: { worldId: world.id } });
  await prisma.world.update({ where: { id: world.id }, data: { activeTimelineId: timeline.id, status: "playing" } });
  const race = await prisma.entity.create({ data: { timelineId: timeline.id, type: "race", name: "山民", aliases: [], emblemSeed: "race", summary: "山地族群", lockedPaths: [] } });
  const character = await prisma.entity.create({ data: { timelineId: timeline.id, type: "character", name: "阿岚", aliases: [], emblemSeed: "alan", summary: "山民学徒", lockedPaths: [], raceId: race.id } });
  const source = await prisma.ability.create({ data: { timelineId: timeline.id, entityId: race.id, name: "踏岩步", kind: "racial_tradition", effect: "稳行峭壁", trigger: "山路", cost: "体力", limitations: "仅适于岩地", mastery: "adept", state: "normal", visibility: "known", lockedFields: [] } });
  const chapter = await prisma.chapter.create({ data: { timelineId: timeline.id, index: 1 } });
  const message = await prisma.message.create({ data: { chapterId: chapter.id, index: 7, role: "narrator", content: "山民长老见证阿岚走完断崖石阶，并正式授予她踏岩步的传承石符。", scale: "scene" } });
  responses.extract = {
    newEntities: [], entityUpdates: [], godUpdates: [], revealSections: [],
    abilityChanges: [{ ownerName: "阿岚", sourceAbilityId: source.id, type: "learned", patch: { mastery: "novice" }, evidenceMessageIndex: 7, evidence: "山民长老见证阿岚走完断崖石阶，并正式授予她踏岩步的传承石符" }],
  };
  return { world, timeline, character, source, chapter, message };
}

async function settle(id: string) { for await (const _progress of settleChapter(id)) void _progress; }

describe("章末 pipeline 习得族群技艺", () => {
  it("保存章节、正文消息和尺度，重跑 dedupe 不重复习得", async () => {
    const data = await fixture();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await settle(data.chapter.id);
      await prisma.chapter.update({ where: { id: data.chapter.id }, data: { settleState: "settling:extract" } });
      await settle(data.chapter.id);
      const learned = await prisma.ability.findFirst({ where: { entityId: data.character.id, sourceAbilityId: data.source.id } });
      const events = await prisma.abilityEvent.findMany({ where: { abilityId: learned?.id } });
      expect(learned).toMatchObject({ mastery: "novice", version: 2 });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ chapterId: data.chapter.id, messageId: data.message.id, scale: "scene", type: "learned" });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      await prisma.world.delete({ where: { id: data.world.id } });
    }
  });
});

afterAll(async () => prisma.$disconnect());

it("整体 extraction 基础设施失败时停留 extract checkpoint 且不运行 chronicle", async () => {
  const data = await fixture();
  const { completeStructured } = await import("@/lib/llm/structured");
  vi.mocked(completeStructured).mockImplementationOnce(async () => { throw new Error("extract unavailable"); });
  try {
    await expect(settle(data.chapter.id)).rejects.toThrow("extract unavailable");
    const chapter = await prisma.chapter.findUnique({ where: { id: data.chapter.id } });
    expect(chapter?.settleState).toBe("settling:extract");
    expect(vi.mocked(completeStructured)).not.toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ task: "chronicle" }),
    );
  } finally {
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});


it("多窗口会抽取早期消息与超长消息前缀中的能力变化", async () => {
  const data = await fixture();
  const earlyAbility = await prisma.ability.create({
    data: { timelineId: data.timeline.id, entityId: data.character.id, name: "凿阵术", kind: "personal", effect: "开凿阵基", trigger: "施工", cost: "体力", limitations: "需要石材", mastery: "novice", state: "normal", visibility: "known", lockedFields: [] },
  });
  const prefixAbility = await prisma.ability.create({
    data: { timelineId: data.timeline.id, entityId: data.character.id, name: "听石诀", kind: "personal", effect: "听辨岩层", trigger: "触石", cost: "专注", limitations: "嘈杂时失准", mastery: "novice", state: "normal", visibility: "known", lockedFields: [] },
  });
  const early = await prisma.message.create({ data: { chapterId: data.chapter.id, index: 20, role: "narrator", content: "阿岚苦修凿阵术，终于将凿阵术磨炼得更加纯熟。", scale: "years" } });
  await prisma.message.createMany({ data: Array.from({ length: 45 }, (_, offset) => ({ chapterId: data.chapter.id, index: 21 + offset, role: "narrator", content: `中段行旅记录${offset}。`, scale: "scene" })) });
  const long = await prisma.message.create({ data: { chapterId: data.chapter.id, index: 80, role: "narrator", content: "阿岚反复演练听石诀，听石诀变得更加纯熟。" + "山风掠过岩壁。".repeat(1200), scale: "years" } });
  const empty = { newEntities: [], entityUpdates: [], godUpdates: [], revealSections: [], abilityChanges: [] };
  responses.extractHandler = (user) => {
    if (user.includes("阿岚苦修凿阵术")) return { ...empty, abilityChanges: [{ abilityId: earlyAbility.id, ownerName: "阿岚", type: "improved", patch: { mastery: "adept" }, evidenceMessageIndex: early.index, evidence: "阿岚苦修凿阵术，终于将凿阵术磨炼得更加纯熟" }] };
    if (user.includes("阿岚反复演练听石诀")) return { ...empty, abilityChanges: [{ abilityId: prefixAbility.id, ownerName: "阿岚", type: "improved", patch: { mastery: "adept" }, evidenceMessageIndex: long.index, evidence: "阿岚反复演练听石诀，听石诀变得更加纯熟" }] };
    return empty;
  };
  try {
    await settle(data.chapter.id);
    const [earlyAfter, prefixAfter, events] = await Promise.all([
      prisma.ability.findUnique({ where: { id: earlyAbility.id } }),
      prisma.ability.findUnique({ where: { id: prefixAbility.id } }),
      prisma.abilityEvent.findMany({ where: { abilityId: { in: [earlyAbility.id, prefixAbility.id] } } }),
    ]);
    expect(earlyAfter).toMatchObject({ mastery: "adept" });
    expect(prefixAfter).toMatchObject({ mastery: "adept" });
    expect(events.map((event) => event.messageId)).toEqual(expect.arrayContaining([early.id, long.id]));
  } finally {
    responses.extractHandler = undefined;
    await prisma.world.delete({ where: { id: data.world.id } });
  }
});
