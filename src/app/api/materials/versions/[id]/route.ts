import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteMaterialVersion } from "@/lib/materials/repository";
import { withAuth } from "@/lib/auth/route";
export const GET = withAuth(async (userId, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params; const version = await prisma.materialVersion.findFirst({ where: { id, card: { userId } }, include: { card: true } });
  return version ? NextResponse.json({ version }) : NextResponse.json({ error: "版本不存在" }, { status: 404 });
});
export const DELETE = withAuth(async (userId, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params; try { await deleteMaterialVersion(userId, id); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }); }
});
