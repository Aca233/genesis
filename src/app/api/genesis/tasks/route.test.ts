import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { genesisTask: { create: mocks.create } },
}));

import { POST } from "./route";

describe("POST /api/genesis/tasks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("持久化任务后立即以 202 返回 taskId", async () => {
    mocks.create.mockResolvedValue({ id: "task-1" });
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decree: "创造星海" }),
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ taskId: "task-1" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ decree: "创造星海", mode: "pantheon", completedKeys: [] }),
    }));
  });

  it("接受并持久化 creator 模式", async () => {
    mocks.create.mockResolvedValue({ id: "task-creator" });
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decree: "创造自行运转的星海", mode: "creator" }),
    }));

    expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "creator" }),
    }));
  });

  it("拒绝未知世界模式", async () => {
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decree: "创造星海", mode: "absolute" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("拒绝过短神谕", async () => {
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      body: JSON.stringify({ decree: "神" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("在创建任务前验证世界书格式", async () => {
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      body: JSON.stringify({ decree: "创造星海", lorebook: { broken: true } }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("世界书") });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
