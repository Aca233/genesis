import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  txFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findFirst: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));

import { GET, PATCH } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };

const initialRevision = "2026-07-22T00:00:00.123Z";
const nextRevision = new Date("2026-07-22T00:00:01.456Z");

function patch(deck: unknown, expectedUpdatedAt = initialRevision) {
  return new Request("http://localhost/api/worlds/world-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deck, editedPaths: ["cosmology.origin"], expectedUpdatedAt }),
  });
}

describe("/api/worlds/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.txFindUnique.mockResolvedValue({ updatedAt: nextRevision });
    mocks.transaction.mockImplementation(async (run) => run({
      world: { updateMany: mocks.updateMany, findUnique: mocks.txFindUnique },
    }));
  });

  it("PATCH 在解析和更新前加载世界并拒绝模式改变", async () => {
    mocks.findUnique.mockResolvedValue({ id: "world-1", mode: "creator", status: "draft", updatedAt: new Date(initialRevision), lockedPaths: [], draftDeck: completeCreatorDeck() });
    const response = await PATCH(patch(completeDeck()), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("PATCH 拒绝修改已开局世界且不进入事务", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "creator",
      status: "playing",
      updatedAt: new Date(initialRevision),
      lockedPaths: [],
      draftDeck: completeCreatorDeck(),
    });

    const response = await PATCH(patch(completeCreatorDeck()), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界已开局，不可修改卡组" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("PATCH 接受与世界一致的 Creator 卡组", async () => {
    mocks.findUnique.mockResolvedValue({ id: "world-1", mode: "creator", status: "draft", updatedAt: new Date(initialRevision), lockedPaths: [], draftDeck: completeCreatorDeck() });
    const response = await PATCH(patch(completeCreatorDeck()), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      updatedAt: nextRevision.toISOString(),
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", userId: "test-user", mode: "creator", status: "draft", updatedAt: new Date(initialRevision) },
      data: expect.objectContaining({ draftDeck: expect.objectContaining({ mode: "creator" }) }),
    }));
    expect(mocks.txFindUnique).toHaveBeenCalledWith({
      where: { id: "world-1" },
      select: { updatedAt: true },
    });
  });

  it("PATCH 用加载时 updatedAt 原子更新并在并发冲突时不部分写入", async () => {
    const loadedAt = new Date("2026-07-22T00:00:02.999Z");
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: loadedAt, lockedPaths: [], draftDeck: completeCreatorDeck(),
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH(patch(completeCreatorDeck()), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "卡组已被其他操作更新，请刷新后重试" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", userId: "test-user", mode: "creator", status: "draft", updatedAt: new Date(initialRevision) },
    }));
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.txFindUnique).not.toHaveBeenCalled();
  });

  it("PATCH 对不存在的世界仍返回 404 且不进入事务", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const response = await PATCH(patch(completeCreatorDeck()), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "不存在" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("PATCH 缺少客户端 revision 时拒绝请求", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date(initialRevision), lockedPaths: [],
    });
    const request = new Request("http://localhost/api/worlds/world-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck: completeCreatorDeck(), editedPaths: [] }),
    });

    const response = await PATCH(request, context);

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("GET 对无 mode 的历史草稿保持 Pantheon 兼容解析", async () => {
    const legacy = structuredClone(completeDeck()) as Record<string, unknown>;
    delete legacy.mode;
    mocks.findUnique.mockResolvedValue({
      id: "world-1", mode: "pantheon", status: "draft", draftDeck: legacy, timelines: [], lockedPaths: [],
    });
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.world.draftDeck.mode).toBe("pantheon");
  });
});
