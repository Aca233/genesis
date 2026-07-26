import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MaterialKindSchema } from "@/lib/materials/types";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw ? MaterialKindSchema.safeParse(kindRaw) : null;
  if (kind && !kind.success) return NextResponse.json({ error: "素材类型无效" }, { status: 400 });
  const q = url.searchParams.get("q")?.trim() ?? "";
  const showHidden = url.searchParams.get("showHidden") === "true";
  const favorite = url.searchParams.get("favorite") === "true";
  const where: Prisma.MaterialCardWhereInput = {
    userId: "local", ...(kind?.success ? { kind: kind.data } : {}),
    ...(!showHidden ? { hidden: false } : {}), ...(favorite ? { favorite: true } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { sourceWorldName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const materials = await prisma.materialCard.findMany({
    where,
    // 列表只需卡片标量（含 defaultVersionId）与版本索引；重量级 content JSON 由详情端点按需返回
    include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, name: true, note: true, isInitial: true, createdAt: true } } },
    orderBy: [{ favorite: "desc" }, { lastUsedAt: "desc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json({ materials });
}
