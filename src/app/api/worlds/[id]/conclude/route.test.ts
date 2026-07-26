import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    world: { updateMany: vi.fn() },
    message: { findFirst: vi.fn(), create: vi.fn() },
    chronicleEntry: { create: vi.fn() },
    chapter: { updateMany: vi.fn() },
  };
  return {
    tx,
    worldFindUnique: vi.fn(),
    godFindFirst: vi.fn(),
    godFindMany: vi.fn(),
    chapterFindFirst: vi.fn(),
    chapterFindMany: vi.fn(),
    timelineFindUnique: vi.fn(),
    chronicleFindMany: vi.fn(),
    entityFindMany: vi.fn(),
    transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)),
    claim: vi.fn(),
    renew: vi.fn(),
    release: vi.fn(),
    completeStructured: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findUnique: mocks.worldFindUnique },
    god: { findFirst: mocks.godFindFirst, findMany: mocks.godFindMany },
    chapter: { findFirst: mocks.chapterFindFirst, findMany: mocks.chapterFindMany },
    timeline: { findUnique: mocks.timelineFindUnique },
    chronicleEntry: { findMany: mocks.chronicleFindMany },
    entity: { findMany: mocks.entityFindMany },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/reality/operation-lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reality/operation-lock")>();
  return {
    ...actual,
    claimWorldOperation: mocks.claim,
    renewWorldOperation: mocks.renew,
    releaseWorldOperation: mocks.release,
  };
});

vi.mock("@/lib/llm/structured", () => ({
  completeStructured: mocks.completeStructured,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };
const request = () =>
  new Request("http://localhost/api/worlds/world-1/conclude", { method: "POST" });

const baseWorld = {
  id: "world-1",
  name: "盐潮之世",
  mode: "pantheon",
  status: "playing",
  activeTimelineId: "tl-1",
  styleCard: { preset: "epic" },
  themeCard: { eraSystem: "洪典" },
  draftDeck: { epochConflict: { epochName: "洪典纪元", yearLabel: "洪典九年" } },
};
const finaleProse = "神".repeat(600);

describe("POST /api/worlds/[id]/conclude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.worldFindUnique.mockResolvedValue({ ...baseWorld });
    mocks.godFindFirst.mockResolvedValue({
      id: "god-player",
      name: "潮神",
      rank: "fallen",
      domains: ["潮汐"],
      faithScope: "盐沼",
    });
    mocks.chapterFindFirst.mockResolvedValue({ id: "ch-3", index: 3, settleState: "open" });
    mocks.claim.mockResolvedValue({ acquired: true });
    mocks.renew.mockResolvedValue(true);
    mocks.release.mockResolvedValue(true);
    mocks.timelineFindUnique.mockResolvedValue({
      realityState: { currentEra: "洪典纪元" },
      observerState: { timeLabel: "洪典九年" },
    });
    mocks.chronicleFindMany.mockResolvedValue([
      { yearLabel: "洪典八年", text: "盐潮越过旧堤。" },
    ]);
    mocks.entityFindMany.mockResolvedValue([{ name: "阿岚", summary: "盐沼城先知" }]);
    mocks.godFindMany.mockResolvedValue([
      { name: "潮神", rank: "fallen", isPlayer: true },
      { name: "炉神", rank: "ascended", isPlayer: false },
    ]);
    mocks.chapterFindMany.mockResolvedValue([
      { messages: [{ content: "旧堤崩塌。" }] },
      { messages: [{ content: "最后的浪退去了。" }] },
    ]);
    mocks.completeStructured.mockResolvedValue({
      finaleProse,
      chronicleEntries: [{ yearLabel: "洪典九年", text: "神焰熄于洪典九年冬。" }],
    });
    mocks.tx.world.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.message.findFirst.mockResolvedValue({ index: 7 });
    mocks.tx.message.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );
    mocks.tx.chronicleEntry.create.mockResolvedValue({});
    mocks.tx.chapter.updateMany.mockResolvedValue({ count: 1 });
  });

  it("400s：创世主世界无陨灭终章", async () => {
    mocks.worldFindUnique.mockResolvedValue({ ...baseWorld, mode: "creator" });
    const response = await POST(request(), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "唯共世诸神之界有陨灭终章" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.completeStructured).not.toHaveBeenCalled();
  });

  it("409s：神焰未熄（rank=ember）不可强书", async () => {
    mocks.godFindFirst.mockResolvedValue({
      id: "god-player",
      name: "潮神",
      rank: "ember",
      domains: [],
      faithScope: null,
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    const json = await response.json() as { error: string };
    expect(json.error).toContain("神焰未熄");
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("409s：已成史世界不可二次成史", async () => {
    mocks.worldFindUnique.mockResolvedValue({ ...baseWorld, status: "concluded" });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "此界当前不可成史" });
  });

  it("409s：当前段整理未竟（settling:extract）", async () => {
    mocks.chapterFindFirst.mockResolvedValue({
      id: "ch-3",
      index: 3,
      settleState: "settling:extract",
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "此段整理未竟，请先完成世界整理",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("成功路径：世界成史、终章消息落库、编年入册、章封卷、租约释放", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ messageId: expect.any(String) });

    expect(mocks.completeStructured).toHaveBeenCalledWith("backstage", expect.objectContaining({
      task: "finale",
      maxTokens: 8000,
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      user: expect.stringContaining("== RECENT CHRONICLE =="),
    }));
    expect(mocks.tx.world.updateMany).toHaveBeenCalledWith({
      where: { id: "world-1", status: "playing", activeTimelineId: "tl-1" },
      data: { status: "concluded" },
    });
    expect(mocks.tx.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        chapterId: "ch-3",
        index: 8,
        role: "narrator",
        scale: "epoch",
        content: finaleProse,
        meta: { kind: "finale", suggestions: [] },
      }),
    });
    expect(mocks.tx.chronicleEntry.create).toHaveBeenCalledWith({
      data: {
        timelineId: "tl-1",
        chapterIndex: 3,
        yearLabel: "洪典九年",
        text: "神焰熄于洪典九年冬。",
        entityIds: [],
        godIds: ["god-player"],
        revealed: true,
        source: "narrative",
      },
    });
    expect(mocks.tx.chapter.updateMany).toHaveBeenCalledWith({
      where: { id: "ch-3", settleState: "open" },
      data: { settleState: "settled" },
    });
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), "world-1", "settlement", expect.any(String));
  });

  it("500s：world CAS 失败（并发切线/二次提交）时事务抛错且不落任何行", async () => {
    mocks.tx.world.updateMany.mockResolvedValue({ count: 0 });
    const response = await POST(request(), context);
    expect(response.status).toBe(500);
    const json = await response.json() as { error: string };
    expect(json.error).toContain("终章未能落笔");
    expect(mocks.tx.message.create).not.toHaveBeenCalled();
    expect(mocks.tx.chronicleEntry.create).not.toHaveBeenCalled();
    expect(mocks.tx.chapter.updateMany).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });

  it("500s：LLM 失败时不进事务，世界保持 playing 可重试", async () => {
    mocks.completeStructured.mockRejectedValue(new Error("上游模型超时"));
    const response = await POST(request(), context);
    expect(response.status).toBe(500);
    const json = await response.json() as { error: string };
    expect(json.error).toContain("终章未能落笔");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.tx.world.updateMany).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalled();
  });
});
