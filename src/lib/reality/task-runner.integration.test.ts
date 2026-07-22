import { afterAll, describe, expect, it, vi } from "vitest";
import type { RewritePlan } from "./schemas";
import { RewritePlanSchema } from "./schemas";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for integration tests");
process.env.DATABASE_URL = testDatabaseUrl;

const { prisma } = await import("@/lib/db");
const { createRealityRewrite, retryRealityRewrite, runRealityRewriteTask } = await import("./task-runner");

const createdWorldIds: string[] = [];

function plan(overrides: Partial<RewritePlan> = {}): RewritePlan {
  return RewritePlanSchema.parse({
    scope: "prospective",
    interpretation: "群星依照敕令改道",
    effectivePoint: "此刻",
    branchName: "群星改道新纪",
    realityCardPatches: [{ section: "currentEra", value: "新星元年" }],
    godPatches: [],
    entityPatches: [],
    abilityPatches: [],
    chroniclePatches: [],
    memoryPatches: [],
    omenPatches: [],
    observerPatch: null,
    causalConsequences: ["新星升起"],
    narrationFocus: "众生第一次看见新星",
    subcommands: [{ decree: "群星改道", scope: "prospective", effectivePoint: "此刻" }],
    ...overrides,
  });
}

async function fixture(mode = "creator") {
  const world = await prisma.world.create({
    data: {
      name: `rewrite-runner-${crypto.randomUUID()}`,
      genesisInput: "改写任务测试",
      mode,
      status: "playing",
      lockedPaths: [],
    },
  });
  createdWorldIds.push(world.id);
  const timeline = await prisma.timeline.create({
    data: {
      worldId: world.id,
      branchName: "原初现实",
      branchSummary: "旧星仍循旧轨",
      realityState: {
        theme: {
          eraSystem: "星历",
          rankNames: { fallen: "陨灭", ember: "余烬", slumbering: "沉睡", nascent: "微末", ascended: "成神", exalted: "显赫", sovereign: "主宰" },
          typeNames: { faction: "势力", character: "人物", race: "种族", place: "地点", artifact: "造物", cult: "教团" },
          addressStyle: "古雅",
        },
        style: { preset: "epic", presetName: "史诗", toneNotes: "冷峻" },
        cosmology: { origin: "星海", powerSystem: "星辉", laws: "星轨不可逆", divinity: "信仰凝聚神格" },
        fusionAxiom: null,
        currentEra: "星历二年",
        establishedFacts: [],
      },
      observerState: { focusType: "world", focusId: null, timeLabel: "星历二年", viewpoint: "omniscient", activeAvatarId: null },
    },
  });
  const chapter = await prisma.chapter.create({
    data: { timelineId: timeline.id, index: 0, title: "旧星", summary: "旧史", settleState: "settled" },
  });
  await prisma.message.create({
    data: { chapterId: chapter.id, index: 0, role: "narrator", content: "旧星照耀大地。" },
  });
  const god = await prisma.god.create({
    data: { timelineId: timeline.id, name: "旧星神", aliases: [], tier: "major", rank: "ascended", domains: ["星辰"], relations: {} },
  });
  await prisma.world.update({ where: { id: world.id }, data: { activeTimelineId: timeline.id } });
  return { world, timeline, chapter, god };
}

function deps(rewritePlan = plan(), narration: string | Error = "新星于是升起。") {
  return {
    db: prisma,
    plan: vi.fn().mockResolvedValue(rewritePlan),
    narrate: narration instanceof Error
      ? vi.fn().mockRejectedValue(narration)
      : vi.fn().mockResolvedValue(narration),
  };
}

async function createTask(data: Awaited<ReturnType<typeof fixture>>, key = crypto.randomUUID()) {
  return createRealityRewrite(prisma, {
    worldId: data.world.id,
    decree: "群星改道",
    scope: "prospective",
    idempotencyKey: `task12-${key}`,
  });
}

afterAll(async () => {
  await prisma.world.deleteMany({ where: { id: { in: createdWorldIds } } });
  await prisma.$disconnect();
});

describe("idempotent reality rewrite runner", () => {
  it("creates one branch in a serializable clone/apply transaction and completes narration", async () => {
    const data = await fixture();
    const first = await createTask(data, "same-key");
    const replay = await createTask(data, "same-key");
    expect(replay).toMatchObject({ replayed: true, task: { id: first.task.id } });

    const runner = deps(plan({
      godPatches: [{ op: "update", targetId: data.god.id, changes: { domains: ["新星"] } }],
    }));
    await runRealityRewriteTask(first.task.id, runner);

    const task = await prisma.realityRewrite.findUniqueOrThrow({ where: { id: first.task.id } });
    expect(task).toMatchObject({ status: "completed", error: null });
    expect(task.resultTimelineId).not.toBeNull();
    if (task.resultTimelineId === null) throw new Error("改写结果现实缺失");
    const resultTimelineId = task.resultTimelineId;
    const world = await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } });
    expect(world.activeTimelineId).toBe(resultTimelineId);
    const children = await prisma.timeline.findMany({ where: { parentId: data.timeline.id } });
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ id: resultTimelineId, forkRewriteId: task.id });
    const clonedGod = await prisma.god.findFirstOrThrow({ where: { timelineId: resultTimelineId, name: "旧星神" } });
    expect(clonedGod.domains).toEqual(["新星"]);
    const chapters = await prisma.chapter.findMany({ where: { timelineId: resultTimelineId }, orderBy: { index: "asc" } });
    const rewriteChapter = chapters.at(-1);
    expect(rewriteChapter?.index).toBe(1);
    const messages = rewriteChapter === undefined
      ? []
      : await prisma.message.findMany({ where: { chapterId: rewriteChapter.id }, orderBy: { index: "asc" } });
    expect(messages).toEqual([expect.objectContaining({
      role: "narrator", content: "新星于是升起。", meta: expect.objectContaining({ realityRewriteId: task.id }),
    })]);
    expect(runner.plan).toHaveBeenCalledTimes(1);
    expect(runner.narrate).toHaveBeenCalledTimes(1);
    expect(world.operationToken).toBeNull();
  });

  it("plan/apply failure leaves the active reality unchanged with no child branch", async () => {
    const data = await fixture();
    const { task } = await createTask(data);
    await runRealityRewriteTask(task.id, deps(plan({
      godPatches: [{ op: "remove", targetId: "missing-god" }],
    })));

    const failed = await prisma.realityRewrite.findUniqueOrThrow({ where: { id: task.id } });
    expect(failed).toMatchObject({ status: "failed", resultTimelineId: null });
    expect((await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } })).activeTimelineId).toBe(data.timeline.id);
    expect(await prisma.timeline.count({ where: { parentId: data.timeline.id } })).toBe(0);
  });

  it("guards the active source at commit and rolls back when another reality became active", async () => {
    const data = await fixture();
    const { task } = await createTask(data);
    const other = await prisma.timeline.create({
      data: { worldId: data.world.id, branchName: "另一现实", parentId: data.timeline.id },
    });
    await prisma.world.update({ where: { id: data.world.id }, data: { activeTimelineId: other.id } });

    await runRealityRewriteTask(task.id, deps());
    const failed = await prisma.realityRewrite.findUniqueOrThrow({ where: { id: task.id } });
    expect(failed).toMatchObject({ status: "failed", resultTimelineId: null });
    expect(failed.error).toContain("来源现实已不再是当前现实");
    expect(await prisma.timeline.count({ where: { forkRewriteId: task.id } })).toBe(0);
    expect((await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } })).activeTimelineId).toBe(other.id);
  });

  it("retains one result branch after narration failure and retry skips plan/clone/apply", async () => {
    const data = await fixture();
    const { task } = await createTask(data);
    const first = deps(plan(), new Error("provider sk-supersecret123 failed"));
    await runRealityRewriteTask(task.id, first);

    const failed = await prisma.realityRewrite.findUniqueOrThrow({ where: { id: task.id } });
    expect(failed.status).toBe("failed");
    expect(failed.resultTimelineId).not.toBeNull();
    expect(failed.error).not.toContain("sk-supersecret123");
    expect(await prisma.timeline.count({ where: { forkRewriteId: task.id } })).toBe(1);

    const rearmed = await retryRealityRewrite(prisma, task.id);
    expect(rearmed.status).toBe("narrating");
    const retry = deps(plan({ interpretation: "不应重新规划" }), "恢复后的新星叙事。");
    await runRealityRewriteTask(task.id, retry);

    expect((await prisma.realityRewrite.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("completed");
    expect(await prisma.timeline.count({ where: { forkRewriteId: task.id } })).toBe(1);
    expect(retry.plan).not.toHaveBeenCalled();
    expect(retry.narrate).toHaveBeenCalledTimes(1);
  });

  it("honors the world-wide operation lease without releasing another owner", async () => {
    const data = await fixture();
    const { task } = await createTask(data);
    await prisma.world.update({
      where: { id: data.world.id },
      data: {
        operationKind: "chat",
        operationToken: "other-owner",
        operationLeaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await runRealityRewriteTask(task.id, deps());

    const failed = await prisma.realityRewrite.findUniqueOrThrow({ where: { id: task.id } });
    expect(failed.status).toBe("failed");
    expect(failed.resultTimelineId).toBeNull();
    const world = await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } });
    expect(world).toMatchObject({
      activeTimelineId: data.timeline.id,
      operationKind: "chat",
      operationToken: "other-owner",
    });
    expect(await prisma.timeline.count({ where: { forkRewriteId: task.id } })).toBe(0);
  });

  it("completed retry returns the existing result and the runner performs no work", async () => {
    const data = await fixture();
    const { task } = await createTask(data);
    const first = deps();
    await runRealityRewriteTask(task.id, first);
    const completed = await retryRealityRewrite(prisma, task.id);
    const noWork = deps();
    await runRealityRewriteTask(task.id, noWork);

    expect(completed.status).toBe("completed");
    expect(await prisma.timeline.count({ where: { forkRewriteId: task.id } })).toBe(1);
    expect(noWork.plan).not.toHaveBeenCalled();
    expect(noWork.narrate).not.toHaveBeenCalled();
  });
});
