import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { setDefaultMaterialVersion, updateMaterialCardIndex } from "@/lib/materials/repository";
import { withAuth } from "@/lib/auth/route";
const PatchSchema = z.object({ favorite: z.boolean().optional(), hidden: z.boolean().optional(), defaultVersionId: z.string().nullable().optional() }).strict();
export const GET = withAuth(async (userId, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const material = await prisma.materialCard.findFirst({ where: { id, userId }, include: { versions: { orderBy: { version: "desc" } } } });
  return material ? NextResponse.json({ material }) : NextResponse.json({ error: "素材不存在" }, { status: 404 });
});
export const PATCH = withAuth(async (userId, request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params; const parsed = PatchSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    if (parsed.data.defaultVersionId) await setDefaultMaterialVersion(userId, id, parsed.data.defaultVersionId);
    const material = await updateMaterialCardIndex(userId, id, { favorite: parsed.data.favorite, hidden: parsed.data.hidden });
    return NextResponse.json({ material });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 }); }
});
export const DELETE = withAuth(async (userId, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const deleted = await prisma.materialCard.deleteMany({ where: { id, userId } });
  return deleted.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "素材不存在" }, { status: 404 });
});
