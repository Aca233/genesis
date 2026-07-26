import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { RealityCompareError, loadRealityComparison } from "@/lib/reality/compare";
import { RealityNotFoundError, RealityTreeValidationError } from "@/lib/reality/tree";

const QuerySchema = z.object({
  left: z.string().min(1).max(191),
  right: z.string().min(1).max(191),
});

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/worlds/[id]/realities/compare?left=&right= —— 两界分歧对照（只读）。
 * 无锁、无事务：面板只读，最终一致即可。创世主全知；万神殿观者过滤暗记。
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const query = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return NextResponse.json({ error: "查询参数不合法" }, { status: 400 });
  }
  const world = await prisma.world.findUnique({
    where: { id },
    select: { mode: true },
  });
  if (world === null) {
    return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  }
  try {
    const comparison = await loadRealityComparison(
      prisma,
      id,
      query.data.left,
      query.data.right,
      { omniscient: world.mode === "creator" },
    );
    return NextResponse.json(comparison);
  } catch (error) {
    if (error instanceof RealityCompareError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof RealityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof RealityTreeValidationError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }
}
