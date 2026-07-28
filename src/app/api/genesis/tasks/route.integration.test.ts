import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { POST } from "./route";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function request(body: unknown) {
  return new Request("http://localhost/api/genesis/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function idempotentRequest(body: unknown, key: string) {
  return new Request("http://localhost/api/genesis/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

describe("GenesisTask PostgreSQL lifecycle", () => {
  beforeEach(async () => {
    await prisma.genesisTask.deleteMany({ where: { decree: { startsWith: "[integration]" } } });
  });

  afterAll(async () => {
    await prisma.genesisTask.deleteMany({ where: { decree: { startsWith: "[integration]" } } });
    await prisma.$disconnect();
  });

  it("任务输入、阶段和刷新恢复所需状态真实落库", async () => {
    const response = await POST(request({
      decree: "[integration] 创造可恢复世界",
      lorebookName: "典籍.json",
      mode: "creator",
      lorebook: { entries: [{ key: ["星海"], content: "星海是权威设定" }] },
    }));
    const { taskId } = await response.json() as { taskId: string };

    const stored = await prisma.genesisTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(stored).toMatchObject({
      mode: "creator",
      status: "queued",
      stage: "oracle",
      completedKeys: [],
      lorebookName: "典籍.json",
      worldId: null,
    });
    expect(stored.lorebook).toEqual({ entries: [{ key: ["星海"], content: "星海是权威设定" }] });
  });

  it("缺省模式真实落库为 pantheon", async () => {
    const response = await POST(request({ decree: "[integration] 创建默认诸神世界" }));
    expect(response.status).toBe(202);
    const { taskId } = await response.json() as { taskId: string };

    const stored = await prisma.genesisTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(stored.mode).toBe("pantheon");
  });

  it("同一用户与幂等键在 PostgreSQL 中只创建一个任务", async () => {
    const key = `integration-${crypto.randomUUID()}`;
    const body = { decree: "[integration] 创建幂等星海" };
    const first = await POST(idempotentRequest(body, key));
    const second = await POST(idempotentRequest(body, key));
    const firstJson = await first.json() as { taskId: string };
    const secondJson = await second.json() as { taskId: string };

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(secondJson.taskId).toBe(firstJson.taskId);
    await expect(prisma.genesisTask.count({ where: { idempotencyKey: key } })).resolves.toBe(1);
  });
});
