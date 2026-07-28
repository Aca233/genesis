import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseStWorldbook } from "@/lib/lorebook/st-import";
import { MaterialSelectionItemSchema } from "@/lib/materials/types";
import { buildGenesisMaterialSnapshot, snapshotJson } from "@/lib/materials/task-snapshot";
import { WorldModeSchema } from "@/lib/world-mode";
import { withAuth } from "@/lib/auth/route";

const CreateGenesisTaskSchema = z.object({
  mode: WorldModeSchema.default("pantheon"),
  decree: z.string().trim().min(2, "神谕太短").max(2000, "神谕过长"),
  lorebook: z.unknown().optional(),
  lorebookName: z.string().max(255).optional(),
  materialSelections: z.array(MaterialSelectionItemSchema).max(40).default([]),
});

export const POST = withAuth(async (userId, request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "创世请求无效" }, { status: 400 });
  }
  const parsed = CreateGenesisTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "创世请求无效" },
      { status: 400 },
    );
  }

  if (parsed.data.lorebook !== undefined) {
    try {
      parseStWorldbook(parsed.data.lorebook);
    } catch {
      return NextResponse.json(
        { error: "世界书格式无法解析：请提供 SillyTavern worldbook JSON" },
        { status: 400 },
      );
    }
  }

  let materialSelection;
  try { materialSelection = await buildGenesisMaterialSnapshot(parsed.data.materialSelections, userId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }

  const task = await prisma.genesisTask.create({
    data: {
      userId,
      mode: parsed.data.mode,
      decree: parsed.data.decree,
      lorebook: parsed.data.lorebook as Prisma.InputJsonValue | undefined,
      lorebookName: parsed.data.lorebookName,
      materialSelection: snapshotJson(materialSelection),
      completedKeys: [],
    },
    select: { id: true },
  });

  return NextResponse.json({ taskId: task.id }, { status: 202 });
});
