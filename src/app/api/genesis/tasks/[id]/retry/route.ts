import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureGenesisTaskRunning } from "@/lib/genesis/task-runner";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const updated = await prisma.genesisTask.updateMany({
    where: { id, userId: "local", status: "failed" },
    data: {
      status: "queued",
      rawOutput: "",
      error: null,
      leaseToken: null,
      leaseExpiresAt: null,
      // 手动重试给全新的瞬断自愈配额
      attempt: 0,
    },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ error: "任务当前不可重试" }, { status: 409 });
  }
  ensureGenesisTaskRunning(id);
  return NextResponse.json({ ok: true }, { status: 202 });
}
