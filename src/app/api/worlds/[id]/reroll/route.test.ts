import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema } from "@/lib/cards/schemas";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  txFindUnique: vi.fn(),
  transaction: vi.fn(),
  completeStructured: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/llm/structured", () => ({ completeStructured: mocks.completeStructured }));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };
function request(cardKey = "majorGods") {
  return new Request("http://localhost/api/worlds/world-1/reroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardKey }),
  });
}

describe("POST /api/worlds/[id]/reroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.txFindUnique.mockResolvedValue({ updatedAt: new Date("2026-07-22T00:00:01.456Z") });
    mocks.transaction.mockImplementation(async (run) => run({
      world: { updateMany: mocks.updateMany, findUnique: mocks.txFindUnique },
    }));
  });

  it("Creator 使用准确 schema、prompt 和缓存命名空间重掷", async () => {
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(deck);
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toMatchObject({
      updatedAt: "2026-07-22T00:00:01.456Z",
    });
    expect(mocks.completeStructured).toHaveBeenCalledWith("narrative", expect.objectContaining({
      schema: CreatorWorldDeckSchema,
      system: expect.stringContaining('mode="creator"'),
      user: expect.stringContaining('mode="creator"'),
      cache: { namespace: "reroll:v1:creator" },
    }));
  });

  it("拒绝重掷已开局世界且不调用模型", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "creator",
      status: "playing",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: null,
      lockedPaths: [],
      genesisInput: "创造星海",
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界已开局，不可修改卡组" });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("Creator 明确拒绝 playerGod 重掷且不调用模型", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
    });
    const response = await POST(request("playerGod"), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "创世主模式不能重掷玩家神" });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
  });

  it("重掷用加载时 updatedAt 原子更新并报告并发冲突", async () => {
    const loadedAt = new Date("2026-07-22T00:00:00.123Z");
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: loadedAt, draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(deck);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "卡组已被其他操作更新，请刷新后重试" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", mode: "creator", status: "draft", updatedAt: loadedAt },
    }));
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.txFindUnique).not.toHaveBeenCalled();
  });

  it("模型生成期间世界开局时原子写入失败并返回已开局冲突", async () => {
    const loadedAt = new Date("2026-07-22T00:00:00.123Z");
    const deck = completeCreatorDeck();
    mocks.findUnique
      .mockResolvedValueOnce({
        id: "world-1", mode: "creator", status: "draft", updatedAt: loadedAt,
        draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
      })
      .mockResolvedValueOnce({ status: "playing" });
    mocks.completeStructured.mockResolvedValue(deck);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界已开局，不可修改卡组" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", mode: "creator", status: "draft", updatedAt: loadedAt },
    }));
  });

  it("Creator 引用修补继续使用精确 schema/cache、保留锁定字段并拒绝修补改模式", async () => {
    const current = completeCreatorDeck();
    current.cosmology.origin = "玩家锁定的起源";
    const invalid = structuredClone(current);
    invalid.cosmology.origin = "模型改写的起源";
    invalid.majorGods[0]!.relations[0]!.targetGodRef = "missing-god";
    const oppositeMode = completeDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: current, lockedPaths: ["cosmology.origin"], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValueOnce(invalid).mockResolvedValueOnce(oppositeMode);

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.completeStructured).toHaveBeenCalledTimes(2);
    expect(mocks.completeStructured).toHaveBeenNthCalledWith(2, "narrative", expect.objectContaining({
      schema: CreatorWorldDeckSchema,
      system: expect.stringContaining('mode="creator"'),
      user: expect.stringContaining('mode="creator"'),
      cache: { namespace: "reroll:v1:creator" },
    }));
    const repairCall = mocks.completeStructured.mock.calls[1]![1] as { user: string };
    expect(repairCall.user).toContain("玩家锁定的起源");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("同模式 repair 篡改锁定字段时最终落库恢复玩家锁定值", async () => {
    const current = completeCreatorDeck();
    current.cosmology.origin = "玩家锁定的起源";
    const invalid = structuredClone(current);
    invalid.cosmology.origin = "首次生成篡改";
    invalid.majorGods[0]!.relations[0]!.targetGodRef = "missing-god";
    const repaired = structuredClone(current);
    repaired.cosmology.origin = "repair 再次篡改";
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: current, lockedPaths: ["cosmology.origin"], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValueOnce(invalid).mockResolvedValueOnce(repaired);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        draftDeck: expect.objectContaining({
          mode: "creator",
          cosmology: expect.objectContaining({ origin: "玩家锁定的起源" }),
        }),
      }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      deck: { cosmology: { origin: "玩家锁定的起源" } },
    });
  });

  it("拒绝生成结果把卡组改离世界模式", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(completeDeck());
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
