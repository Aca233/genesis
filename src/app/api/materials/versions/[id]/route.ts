import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteMaterialVersion } from "@/lib/materials/repository";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const version = await prisma.materialVersion.findFirst({ where: { id, card: { userId: "local" } }, include: { card: true } });
  return version ? NextResponse.json({ version }) : NextResponse.json({ error: "版本不存在" }, { status: 404 });
}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; try { await deleteMaterialVersion(id); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
}
