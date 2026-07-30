import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toGenesisTaskDto } from "@/lib/genesis/task-runner";
import { withAuth } from "@/lib/auth/route";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (
  userId,
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const task = await prisma.genesisTask.findFirst({
    where: { id, userId },
    select: {
      id: true,
      mode: true,
      status: true,
      stage: true,
      completedKeys: true,
      error: true,
      worldId: true,
      createdAt: true,
      updatedAt: true,
      auditReport: true,
      aggregateVersion: true,
    },
  });
  if (!task) return NextResponse.json({ error: "创世任务不存在" }, { status: 404 });
  return NextResponse.json({ task: toGenesisTaskDto(task) });
});
