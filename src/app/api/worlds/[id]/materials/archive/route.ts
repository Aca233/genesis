import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { archiveWorldMaterials } from "@/lib/materials/archive-world";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const world = await prisma.world.findFirst({ where: { id, userId: "local" }, select: { materialArchiveStatus: true } });
  if (!world) return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  if (world.materialArchiveStatus === "completed") return NextResponse.json({ ok: true });
  if (world.materialArchiveStatus === "running") return NextResponse.json({ error: "素材归档正在进行" }, { status: 409 });
  try { await archiveWorldMaterials(id); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
