import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  upsert: vi.fn(),
  wake: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { genesisTask: { create: mocks.create, upsert: mocks.upsert } },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));
vi.mock("@/lib/genesis/scheduler", () => ({ wakeGenesisScheduler: mocks.wake }));

import { POST } from "./route";

describe("POST /api/genesis/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GENESIS_V2_SHADOW_ENABLED;
    delete process.env.GENESIS_V2_PRIMARY_PERCENT;
    delete process.env.GENESIS_V2_PRIMARY_USER_IDS;
  });

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
      data: expect.objectContaining({
        decree: "创造星海",
        mode: "pantheon",
        completedKeys: [],
        budgetMaxCalls: 32,
        budgetMaxInput: 2_000_000,
        budgetMaxOutput: 192_000,
        jobs: { create: [expect.objectContaining({ nodeKey: "legacy-world-deck" })] },
        outboxEvents: { create: expect.objectContaining({ aggregateVersion: 1 }) },
      }),
    }));
    expect(mocks.wake).toHaveBeenCalledTimes(1);
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


  it("malformed JSON 返回 400 且不创建任务", async () => {
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"decree":',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "创世请求无效" });
    expect(mocks.create).not.toHaveBeenCalled();
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

  it("shadow 开关开启时在同一创建事务冻结预检和五个低优先级节点", async () => {
    process.env.GENESIS_V2_SHADOW_ENABLED = "1";
    mocks.create.mockResolvedValue({ id: "task-shadow" });

    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      body: JSON.stringify({ decree: "创造受潮汐支配的星海" }),
    }));

    expect(response.status).toBe(202);
    const data = mocks.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      shadowEnabled: true,
      shadowStatus: "pending_legacy",
      shadowPreflightHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      shadowBudgetMaxCalls: 5,
    });
    expect(data.jobs.create).toHaveLength(6);
    expect(data.jobs.create.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "shadow:blueprint", priority: -100 }),
      expect.objectContaining({
        nodeKey: "shadow:characters",
        dependencyKeys: ["shadow:pantheon_domain", "shadow:civilizations", "shadow:eras"],
      }),
    ]));
  });

  it("V2 白名单用户创建冻结的主 DAG，且不再创建 legacy 作业", async () => {
    process.env.GENESIS_V2_PRIMARY_USER_IDS = "test-user";
    mocks.create.mockResolvedValue({ id: "task-v2" });

    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      body: JSON.stringify({ decree: "创造受潮汐支配的星海" }),
    }));

    expect(response.status).toBe(202);
    const data = mocks.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      engineVersion: "dag-v2",
      shadowEnabled: false,
      shadowStatus: "disabled",
      budgetMaxCalls: 32,
      budgetMaxInput: 2_000_000,
      budgetMaxOutput: 192_000,
      preflightHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(data.jobs.create).toHaveLength(5);
    expect(data.jobs.create).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "v2:blueprint", engineVersion: "dag-v2" }),
      expect.objectContaining({
        nodeKey: "v2:characters",
        engineVersion: "dag-v2",
        dependencyKeys: ["v2:pantheon_domain", "v2:civilizations", "v2:eras"],
      }),
    ]));
    expect(data.jobs.create).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "legacy-world-deck" }),
    ]));
  });

  it("同一用户重复提交同一幂等键时返回同一任务", async () => {
    mocks.upsert.mockImplementation(async ({ create }: { create: { requestHash: string } }) => ({
      id: "task-stable",
      requestHash: create.requestHash,
    }));
    const request = () => new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "create-20260728-001" },
      body: JSON.stringify({ decree: "创造不会重复的星海" }),
    });

    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await expect(first.json()).resolves.toEqual({ taskId: "task-stable" });
    await expect(second.json()).resolves.toEqual({ taskId: "task-stable" });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    const firstCall = mocks.upsert.mock.calls[0][0];
    expect(firstCall.where).toEqual({
      userId_idempotencyKey: { userId: "test-user", idempotencyKey: "create-20260728-001" },
    });
  });

  it("幂等键复用但请求内容不同返回 409", async () => {
    mocks.upsert.mockResolvedValue({ id: "task-existing", requestHash: "different-hash" });
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "reused-key-001" },
      body: JSON.stringify({ decree: "另一片星海" }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("幂等键") });
  });

  it("请求体超过字节上限时在解析和建任务前拒绝", async () => {
    const response = await POST(new Request("http://localhost/api/genesis/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decree: "创造星海", lorebook: { payload: "界".repeat(400_000) } }),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "INPUT_LIMIT_EXCEEDED" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
