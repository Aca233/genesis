import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePersistedAbility } from "@/lib/abilities/types";
import { projectAbilityForPlayer } from "@/lib/abilities/visibility";

/** GET /api/abilities/[id]/history —— 按能力可见性投影的沿革。 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ability = await prisma.ability.findUnique({ where: { id } });
  if (ability === null) {
    return NextResponse.json({ error: "能力不存在" }, { status: 404 });
  }

  const projected = projectAbilityForPlayer(normalizePersistedAbility(ability));
  if (projected === null) {
    return NextResponse.json({ error: "能力不存在" }, { status: 404 });
  }

  const events = await prisma.abilityEvent.findMany({
    where: { abilityId: id },
    orderBy: { createdAt: "asc" },
  });

  if (projected.visibility === "rumored") {
    return NextResponse.json({
      ability: projected,
      history: events
        .filter((event) => event.type === "revealed")
        .map((event) => ({
          revealedAt: event.createdAt,
          rumorText: projected.rumorText,
        })),
    });
  }

  return NextResponse.json({ ability: projected, history: events });
}
