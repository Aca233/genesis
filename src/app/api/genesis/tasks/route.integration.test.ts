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
      lorebook: { entries: [{ key: ["星海"], content: "星海是权威设定" }] },
    }));
    const { taskId } = await response.json() as { taskId: string };

    const stored = await prisma.genesisTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(stored).toMatchObject({
      status: "queued",
      stage: "oracle",
      completedKeys: [],
      lorebookName: "典籍.json",
      worldId: null,
    });
    expect(stored.lorebook).toEqual({ entries: [{ key: ["星海"], content: "星海是权威设定" }] });
  });
});
