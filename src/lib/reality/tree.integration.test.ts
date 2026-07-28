import { afterAll, describe, expect, it } from "vitest";
import {
  RealityConflictError,
  RealityTreeValidationError,
  deleteRealitySubtree,
  loadRealityTree,
  renameReality,
  switchReality,
  undoReality,
} from "./tree";
import { settleChapter } from "@/lib/settle/pipeline";

const { prisma } = await import("@/lib/db");
const worldIds: string[] = [];

async function fixture() {
  const world = await prisma.world.create({
    data: {
      userId: "test-user", name: `reality-tree-${crypto.randomUUID()}`,
      genesisInput: "测试现实树",
      mode: "creator",
      status: "playing",
      lockedPaths: [],
    },
  });
  worldIds.push(world.id);
  const root = await prisma.timeline.create({
    data: { worldId: world.id, branchName: "原初现实", branchSummary: "根现实" },
  });
  const rootChapter = await prisma.chapter.create({
    data: { timelineId: root.id, index: 1, settleState: "settled" },
  });
  const rewriteOne = await prisma.realityRewrite.create({
    data: {
      worldId: world.id,
      sourceTimelineId: root.id,
      sourceChapterId: rootChapter.id,
      decree: "令天空有双月",
      status: "completed",
      idempotencyKey: `tree-${crypto.randomUUID()}`,
    },
  });
  const child = await prisma.timeline.create({
    data: {
      worldId: world.id,
      parentId: root.id,
      forkChapter: 1,
      forkRewriteId: rewriteOne.id,
      branchName: "双月现实",
    },
  });
  await prisma.realityRewrite.update({
    where: { id: rewriteOne.id },
    data: { resultTimelineId: child.id },
  });
  const childChapter = await prisma.chapter.create({
    data: { timelineId: child.id, index: 1, settleState: "settled" },
  });
  const rewriteTwo = await prisma.realityRewrite.create({
    data: {
      worldId: world.id,
      sourceTimelineId: child.id,
      sourceChapterId: childChapter.id,
      decree: "令群星倒流",
      status: "completed",
      idempotencyKey: `tree-${crypto.randomUUID()}`,
    },
  });
  const grandchild = await prisma.timeline.create({
    data: {
      worldId: world.id,
      parentId: child.id,
      forkChapter: 1,
      forkRewriteId: rewriteTwo.id,
      branchName: "逆星现实",
    },
  });
  await prisma.realityRewrite.update({
    where: { id: rewriteTwo.id },
    data: { resultTimelineId: grandchild.id },
  });
  await prisma.world.update({ where: { id: world.id }, data: { activeTimelineId: grandchild.id } });
  return { world, root, child, grandchild, rewriteOne, rewriteTwo };
}

describe("reality tree persistence operations", () => {
  it("loads a validated DTO, switches immediately with CAS, undoes to parent, and renames", async () => {
    const data = await fixture();

    const initial = await loadRealityTree(prisma, data.world.id);
    expect(initial.activeId).toBe(data.grandchild.id);
    expect(initial.nodes).toHaveLength(3);
    expect(initial.nodes.find((node) => node.id === data.child.id)).toMatchObject({
      childCount: 1,
      rewriteId: data.rewriteOne.id,
      rewriteDecree: "令天空有双月",
    });

    await expect(switchReality(prisma, {
      worldId: data.world.id,
      targetTimelineId: data.root.id,
      expectedActiveId: data.grandchild.id,
    })).resolves.toEqual({ activeId: data.root.id });
    expect((await prisma.world.findUniqueOrThrow({ where: { id: data.world.id } })).activeTimelineId).toBe(data.root.id);

    await expect(switchReality(prisma, {
      worldId: data.world.id,
      targetTimelineId: data.grandchild.id,
      expectedActiveId: data.grandchild.id,
    })).rejects.toBeInstanceOf(RealityConflictError);

    await switchReality(prisma, {
      worldId: data.world.id,
      targetTimelineId: data.grandchild.id,
      expectedActiveId: data.root.id,
    });
    await expect(undoReality(prisma, {
      worldId: data.world.id,
      expectedActiveId: data.grandchild.id,
    })).resolves.toEqual({ activeId: data.child.id });

    await expect(renameReality(prisma, {
      worldId: data.world.id,
      timelineId: data.grandchild.id,
      branchName: "  星河回卷  ",
    })).resolves.toMatchObject({ branchName: "星河回卷" });
  });

  it("rejects root/current deletion and transactionally deletes an entire frozen subtree with rewrites", async () => {
    const data = await fixture();

    await expect(deleteRealitySubtree(prisma, {
      worldId: data.world.id,
      timelineId: data.root.id,
      expectedActiveId: data.grandchild.id,
    })).rejects.toThrowError(/根现实/);
    await expect(deleteRealitySubtree(prisma, {
      worldId: data.world.id,
      timelineId: data.grandchild.id,
      expectedActiveId: data.grandchild.id,
    })).rejects.toThrowError(/当前现实/);

    await switchReality(prisma, {
      worldId: data.world.id,
      targetTimelineId: data.root.id,
      expectedActiveId: data.grandchild.id,
    });
    await expect(deleteRealitySubtree(prisma, {
      worldId: data.world.id,
      timelineId: data.child.id,
      expectedActiveId: data.root.id,
    })).resolves.toEqual({ deletedIds: expect.arrayContaining([data.child.id, data.grandchild.id]) });

    expect(await prisma.timeline.findMany({
      where: { id: { in: [data.child.id, data.grandchild.id] } },
    })).toHaveLength(0);
    expect(await prisma.realityRewrite.findMany({
      where: { id: { in: [data.rewriteOne.id, data.rewriteTwo.id] } },
    })).toHaveLength(0);
    expect(await prisma.timeline.findUnique({ where: { id: data.root.id } })).not.toBeNull();
  });

  it("detects a persisted cross-world parent before returning or deleting anything", async () => {
    const data = await fixture();
    const foreign = await prisma.world.create({
      data: {
        userId: "test-user", name: `foreign-${crypto.randomUUID()}`,
        genesisInput: "外部世界",
        mode: "creator",
        status: "playing",
        lockedPaths: [],
      },
    });
    worldIds.push(foreign.id);
    const foreignRoot = await prisma.timeline.create({
      data: { worldId: foreign.id, branchName: "异界根现实" },
    });
    await prisma.timeline.update({
      where: { id: data.child.id },
      data: { parentId: foreignRoot.id },
    });

    await expect(loadRealityTree(prisma, data.world.id)).rejects.toBeInstanceOf(RealityTreeValidationError);
    await expect(deleteRealitySubtree(prisma, {
      worldId: data.world.id,
      timelineId: data.child.id,
      expectedActiveId: data.grandchild.id,
    })).rejects.toBeInstanceOf(RealityTreeValidationError);
    expect(await prisma.timeline.findUnique({ where: { id: data.child.id } })).not.toBeNull();
    expect(await prisma.realityRewrite.findUnique({ where: { id: data.rewriteOne.id } })).not.toBeNull();
  });

  it("冻结现实不能通过世界整理推进事件", async () => {
    const data = await fixture();
    const event = await prisma.worldEvent.create({
      data: {
        id: `frozen-event-${crypto.randomUUID()}`,
        timelineId: data.root.id,
        kind: "war",
        title: "冻结的战火",
        summary: "此事件属于非活动现实。",
        phase: "developing",
        visibility: "public",
        participantIds: [],
        originMessageId: "frozen-origin",
        latestMessageId: "frozen-latest",
      },
    });
    const before = await prisma.worldEvent.findUniqueOrThrow({ where: { id: event.id } });

    const run = async () => {
      for await (const progress of settleChapter(
        (await prisma.chapter.findFirstOrThrow({
          where: { timelineId: data.root.id },
          select: { id: true },
        })).id,
      )) {
        // Consume the runner so the frozen-reality guard executes.
        void progress;
      }
    };

    await expect(run()).rejects.toThrow("该现实已被冻结");
    expect(await prisma.worldEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(before);
  });
});

afterAll(async () => {
  await prisma.world.deleteMany({ where: { id: { in: worldIds } } });
  await prisma.$disconnect();
});
