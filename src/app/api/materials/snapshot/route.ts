import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createMaterialVersion } from "@/lib/materials/repository";
import { snapshotRuntimeMaterial } from "@/lib/materials/runtime-snapshot";
import { withAuth } from "@/lib/auth/route";

const SnapshotRequestSchema = z.object({
  sourceType: z.enum(["god", "entity", "ability"]),
  sourceId: z.string().min(1),
  versionName: z.string().trim().min(1).max(80),
  note: z.string().max(500).optional(),
  setDefault: z.boolean().default(false),
}).strict();

export const POST = withAuth(async (userId, request: Request) => {
  const parsed = SnapshotRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "请求参数无效" }, { status: 400 });
  try {
    const snapshot = await snapshotRuntimeMaterial({ userId, ...parsed.data });
    const identity = snapshot.cardIdentity;
    let card = await prisma.materialCard.findFirst({
      where: { userId, sourceKind: identity.sourceKind, sourceRef: identity.sourceRef },
      select: { id: true },
    });
    const isNewCard = !card;
    if (!card) {
      card = await prisma.materialCard.create({
        data: {
          userId, kind: identity.kind, name: identity.name, summary: identity.summary,
          sourceWorldId: identity.sourceWorldId, sourceWorldName: identity.sourceWorldName,
          sourceKind: identity.sourceKind, sourceRef: identity.sourceRef,
        },
        select: { id: true },
      });
    }
    const version = await createMaterialVersion(userId, {
      cardId: card.id,
      name: parsed.data.versionName,
      note: parsed.data.note,
      content: snapshot.content,
      dependencies: snapshot.dependencies,
      setDefault: parsed.data.setDefault || isNewCard,
    });
    return NextResponse.json({ cardId: card.id, version }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: /不存在/.test(message) ? 404 : 400 });
  }
});
