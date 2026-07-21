import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureGenesisTaskRunning, toGenesisTaskDto } from "@/lib/genesis/task-runner";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = await prisma.genesisTask.findFirst({
    where: { id, userId: "local" },
    select: {
      id: true,
      status: true,
      stage: true,
      completedKeys: true,
      error: true,
      worldId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!task) return NextResponse.json({ error: "创世任务不存在" }, { status: 404 });
  if (task.status === "queued" || task.status === "running" || task.status === "repairing") {
    ensureGenesisTaskRunning(id);
  }
  return NextResponse.json({ task: toGenesisTaskDto(task) });
}
