import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  taskFindFirst: vi.fn(),
  outboxFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    genesisTask: { findFirst: mocks.taskFindFirst },
    genesisOutbox: { findMany: mocks.outboxFindMany },
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "task-1" }) };
const completedTask = {
  id: "task-1",
  mode: "pantheon",
  status: "completed",
  stage: "completed",
  completedKeys: ["mode"],
  error: null,
  worldId: "world-1",
  createdAt: new Date("2026-07-28T00:00:00Z"),
  updatedAt: new Date("2026-07-28T00:01:00Z"),
  auditReport: null,
  aggregateVersion: 7,
};

describe("GET /api/genesis/tasks/[id]/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.taskFindFirst.mockResolvedValue(completedTask);
    mocks.outboxFindMany.mockResolvedValue([{ aggregateVersion: 7 }]);
  });

  it("以 aggregateVersion 作为 SSE id，并从 Last-Event-ID 之后重放", async () => {
    const response = await GET(new Request("http://localhost/api/genesis/tasks/task-1/events", {
      headers: { "Last-Event-ID": "5" },
    }), context);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("id: 7\nevent: progress");
    expect(body).toContain("id: 7\nevent: completed");
    expect(mocks.outboxFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskId: "task-1", aggregateVersion: { gt: 5 } },
    }));
  });

  it("连接与断开只读 Task/Outbox，不启动生成 Worker", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await GET(new Request("http://localhost/api/genesis/tasks/task-1/events", {
      signal: controller.signal,
    }), context);
    await response.text();

    expect(mocks.taskFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.outboxFindMany).not.toHaveBeenCalled();
  });

  it("不存在或越权的任务在建流前返回 404", async () => {
    mocks.taskFindFirst.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/genesis/tasks/missing/events"), context);
    expect(response.status).toBe(404);
  });

  it("管理员取消是可关闭 SSE 的明确终态", async () => {
    mocks.taskFindFirst.mockResolvedValue({
      ...completedTask,
      status: "cancelled",
      stage: "laws",
      worldId: null,
      error: "管理员已取消",
      aggregateVersion: 3,
    });
    mocks.outboxFindMany.mockResolvedValue([{ aggregateVersion: 3 }]);
    const response = await GET(new Request("http://localhost/api/genesis/tasks/task-1/events"), context);
    const body = await response.text();
    expect(body).toContain("event: failed");
    expect(body).toContain("管理员已取消");
  });
});
