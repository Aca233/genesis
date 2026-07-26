import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildWorldIconTheme,
  mergeLockedIconAssignments,
  parseWorldIconTheme,
} from "@/lib/icons/theme";

const BodySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsedBody = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "重铸请求无效" }, { status: 400 });
  }

  const world = await prisma.world.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      draftDeck: true,
      themeCard: true,
      styleCard: true,
      cosmology: true,
      fusionAxiom: true,
      iconTheme: true,
      iconThemeRevision: true,
      iconThemeOperationKey: true,
    },
  });
  if (!world) return NextResponse.json({ error: "世界不存在" }, { status: 404 });

  if (world.iconThemeOperationKey === parsedBody.data.idempotencyKey) {
    return NextResponse.json({
      theme: parseWorldIconTheme(world.iconTheme),
      revision: world.iconThemeRevision,
      idempotent: true,
    });
  }
  if (world.iconThemeRevision !== parsedBody.data.expectedRevision) {
    return NextResponse.json(
      { error: "图标主题已更新，请刷新后重试", revision: world.iconThemeRevision },
      { status: 409 },
    );
  }

  const source = world.draftDeck ?? {
    theme: world.themeCard,
    style: world.styleCard,
    cosmology: world.cosmology,
    fusionAxiom: world.fusionAxiom,
  };
  const candidate = mergeLockedIconAssignments(
    buildWorldIconTheme(source),
    world.iconTheme,
  );
  const result = await prisma.world.updateMany({
    where: { id, iconThemeRevision: parsedBody.data.expectedRevision },
    data: {
      iconTheme: candidate as unknown as Prisma.InputJsonValue,
      iconThemeOperationKey: parsedBody.data.idempotencyKey,
      iconThemeRevision: { increment: 1 },
    },
  });
  if (result.count !== 1) {
    return NextResponse.json(
      { error: "图标主题已更新，请刷新后重试" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    theme: candidate,
    revision: world.iconThemeRevision + 1,
    idempotent: false,
    affectsUnlockedNarrativeIcons: world.status !== "draft",
  });
}
