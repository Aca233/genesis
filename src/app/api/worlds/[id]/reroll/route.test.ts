import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema } from "@/lib/cards/schemas";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  completeStructured: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { world: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
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
  });

  it("Creator 使用准确 schema、prompt 和缓存命名空间重掷", async () => {
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(deck);
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.completeStructured).toHaveBeenCalledWith("narrative", expect.objectContaining({
      schema: CreatorWorldDeckSchema,
      system: expect.stringContaining('mode="creator"'),
      user: expect.stringContaining('mode="creator"'),
      cache: { namespace: "reroll:v1:creator" },
    }));
  });

  it("Creator 明确拒绝 playerGod 重掷且不调用模型", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
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
      id: "world-1", mode: "creator", updatedAt: loadedAt, draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(deck);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "卡组已被其他操作更新，请刷新后重试" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", mode: "creator", updatedAt: loadedAt },
    }));
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("Creator 引用修补继续使用精确 schema/cache、保留锁定字段并拒绝修补改模式", async () => {
    const current = completeCreatorDeck();
    current.cosmology.origin = "玩家锁定的起源";
    const invalid = structuredClone(current);
    invalid.cosmology.origin = "模型改写的起源";
    invalid.majorGods[0]!.relations[0]!.targetGodRef = "missing-god";
    const oppositeMode = completeDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", updatedAt: new Date("2026-07-22T00:00:00.123Z"),
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

  it("拒绝生成结果把卡组改离世界模式", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(completeDeck());
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
