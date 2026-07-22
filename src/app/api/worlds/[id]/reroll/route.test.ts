import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema } from "@/lib/cards/schemas";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  completeStructured: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { world: { findUnique: mocks.findUnique, update: mocks.update } },
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
    mocks.update.mockResolvedValue({});
  });

  it("Creator 使用准确 schema、prompt 和缓存命名空间重掷", async () => {
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
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
      id: "world-1", mode: "creator", draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
    });
    const response = await POST(request("playerGod"), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "创世主模式不能重掷玩家神" });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
  });

  it("拒绝生成结果把卡组改离世界模式", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(completeDeck());
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
