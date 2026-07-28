import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseWorldIconTheme } from "@/lib/icons/theme";
import { searchIconCatalog, type IconPickerLibrary } from "@/lib/icons/picker";
import { loadLocalIcon } from "@/lib/icons/svg.server";
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";

export const GET = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const world = await prisma.world.findFirst({
    where: ownedWhere.world(userId, id),
    select: { iconTheme: true },
  });
  if (!world) return NextResponse.json({ error: "世界不存在" }, { status: 404 });
  const url = new URL(request.url);
  const library: IconPickerLibrary = url.searchParams.get("library") === "emblem"
    ? "emblem"
    : "primary";
  const result = searchIconCatalog({
    theme: parseWorldIconTheme(world.iconTheme),
    library,
    query: url.searchParams.get("q") ?? "",
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 24),
  });
  return NextResponse.json({
    ...result,
    items: result.items.map(({ id: iconId, ...item }) => ({
      ...item,
      icon: loadLocalIcon(iconId),
    })),
  });
});
