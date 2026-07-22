import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { world: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));

import { GET, PATCH } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };

function patch(deck: unknown) {
  return new Request("http://localhost/api/worlds/world-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deck, editedPaths: ["cosmology.origin"] }),
  });
}

describe("/api/worlds/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("PATCH 在解析和更新前加载世界并拒绝模式改变", async () => {
    mocks.findUnique.mockResolvedValue({ id: "world-1", mode: "creator", updatedAt: new Date("2026-07-22T00:00:00.123Z"), lockedPaths: [], draftDeck: completeCreatorDeck() });
    const response = await PATCH(patch(completeDeck()), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("PATCH 接受与世界一致的 Creator 卡组", async () => {
    mocks.findUnique.mockResolvedValue({ id: "world-1", mode: "creator", updatedAt: new Date("2026-07-22T00:00:00.123Z"), lockedPaths: [], draftDeck: completeCreatorDeck() });
    const response = await PATCH(patch(completeCreatorDeck()), context);
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ draftDeck: expect.objectContaining({ mode: "creator" }) }),
    }));
  });

  it("PATCH 用加载时 updatedAt 原子更新并在并发冲突时不部分写入", async () => {
    const loadedAt = new Date("2026-07-22T00:00:00.123Z");
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", updatedAt: loadedAt, lockedPaths: [], draftDeck: completeCreatorDeck(),
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH(patch(completeCreatorDeck()), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "卡组已被其他操作更新，请刷新后重试" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", mode: "creator", updatedAt: loadedAt },
    }));
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("GET 对无 mode 的历史草稿保持 Pantheon 兼容解析", async () => {
    const legacy = structuredClone(completeDeck()) as Record<string, unknown>;
    delete legacy.mode;
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "pantheon", draftDeck: legacy, timelines: [], lockedPaths: [],
    });
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.world.draftDeck.mode).toBe("pantheon");
  });
});
